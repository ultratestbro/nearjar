import "server-only";

import { NEAR_RPC, NEARJAR_CONTRACT, view } from "./near";
import { canSpendIntents, governance, isDaoId, memberCount, memberRoles, parsePolicy, type DaoPolicy, type Governance } from "./daoPolicy";

// A DAO's policy changes by proposal, rarely; a minute of staleness is fine for every check here.
const TTL_MS = 60_000;
// A Sputnik DAO can't delete itself (only the factory owner could replace its code), so an
// account seen to exist is trusted for longer; a missing one is asked again within the minute.
const EXISTS_TTL_MS = 60 * 60_000;
// Enough for every DAO the editor and the jar pages look up; random ids can't grow it past this.
const MAX_ENTRIES = 500;
const cache = new Map<string, { at: number; ttl: number; value: Promise<unknown> }>();

function cached<T>(key: string, load: () => Promise<T>, ttlOf: (v: T) => number = () => TTL_MS): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value as Promise<T>;
  if (hit) cache.delete(key);
  // Map keeps insertion order: the first key is the oldest entry
  while (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  const value = load();
  const entry = { at: Date.now(), ttl: TTL_MS, value };
  cache.set(key, entry);
  value.then(
    (v) => {
      entry.ttl = ttlOf(v);
    },
    // a failed lookup is retried next time, never served from the cache
    () => {
      if (cache.get(key) === entry) cache.delete(key);
    },
  );
  return value;
}

/** Test hooks: forget every cached lookup; how many are kept. */
export function clearDaoCache() {
  cache.clear();
}
export const daoCacheSize = () => cache.size;

/**
 * Whether the account exists with a contract on it (its own code or a global contract, which is
 * how the factory deploys new DAOs). Throws when the RPC can't answer, so callers fail closed.
 */
export function daoExists(dao: string): Promise<boolean> {
  return cached(
    `exists:${dao}`,
    async () => {
      const res = await fetch(NEAR_RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "nearjar",
          method: "query",
          params: { request_type: "view_account", finality: "final", account_id: dao },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await res.json()) as {
        result?: { code_hash?: string; global_contract_hash?: string; global_contract_account_id?: string };
        error?: { cause?: { name?: string } };
      };
      if (body.error?.cause?.name === "UNKNOWN_ACCOUNT") return false;
      if (!body.result) throw new Error(`view_account ${dao} failed`);
      const r = body.result;
      return (!!r.code_hash && r.code_hash !== "11111111111111111111111111111111") || !!r.global_contract_hash || !!r.global_contract_account_id;
    },
    (exists) => (exists ? EXISTS_TTL_MS : TTL_MS),
  );
}

/** The DAO's policy via `get_policy`. Throws on any RPC or shape problem (fail closed). */
export function fetchPolicy(dao: string): Promise<DaoPolicy> {
  return cached(`policy:${dao}`, async () => {
    const policy = parsePolicy(await view<unknown>("get_policy", {}, dao));
    if (!policy) throw new Error(`${dao} returned no Sputnik policy`);
    return policy;
  });
}

/**
 * What the deployed NearJar contract says about itself: the intents.near account it trusts, and
 * whether it stores DAO payouts (builds before them have no `version`; such a build would make a
 * DAO-signed jar pay its creator).
 */
export function contractConfig(): Promise<{ intentsId: string; daoPayouts: boolean }> {
  return cached(
    `config:${NEARJAR_CONTRACT}`,
    async () => {
      const c = await view<{ intents_id?: unknown; version?: unknown }>("get_config", {});
      if (typeof c?.intents_id !== "string") throw new Error("get_config returned no intents_id");
      return { intentsId: c.intents_id, daoPayouts: typeof c.version === "string" };
    },
    (c) => (c.daoPayouts ? EXISTS_TTL_MS : TTL_MS),
  );
}

/**
 * Keys registered for the DAO on intents.near. Any key can sign intents that move the DAO's
 * Intents balance without a proposal, so a DAO jar needs none. Throws when it can't be read.
 */
export function intentsKeyCount(dao: string): Promise<number> {
  return cached(`keys:${dao}`, async () => {
    const { intentsId } = await contractConfig();
    const keys = await view<unknown>("public_keys_of", { account_id: dao }, intentsId);
    if (!Array.isArray(keys)) throw new Error(`public_keys_of ${dao} returned no list`);
    return keys.length;
  });
}

const keysProblem = (dao: string) =>
  `${dao} has a key registered on NEAR Intents, so its Intents balance can move without a proposal. DAO jars need a treasury only proposals can spend.`;

export interface DaoCheck {
  dao: string;
  exists: boolean;
  members: number;
  roles: string[];
  /** The roles that list the account. */
  accountRoles: string[];
  isMember: boolean;
  canSpendIntents: boolean;
  /** Who decides over the treasury; null when the DAO doesn't exist. */
  governance: Governance | null;
  /** Keys registered for the DAO on intents.near (must be 0). */
  intentsKeys: number;
  /** Why this DAO can't take this account's jar, or null when it can. */
  problem: string | null;
}

export type DaoCheckResult = { ok: true; check: DaoCheck } | { ok: false; error: string; status: number };

const unreachable = { ok: false as const, error: "Could not reach NEAR to check the DAO. Try again in a minute.", status: 503 };

/**
 * Everything the editor shows and the API enforces before a jar may pay out to `dao`: the
 * contract stores DAO payouts, the DAO exists, its policy reads, the signer is in one of its
 * roles, the DAO can spend what lands in its NEAR Intents balance, and no key can spend it
 * without a proposal. RPC trouble is an error, never a pass.
 */
export async function checkDao(dao: string, account: string | null): Promise<DaoCheckResult> {
  if (!isDaoId(dao)) return { ok: false, error: "That isn't a Sputnik DAO: use name.sputnik-dao.near or a trezu.app link.", status: 400 };
  let exists: boolean;
  let daoPayouts: boolean;
  try {
    [exists, { daoPayouts }] = await Promise.all([daoExists(dao), contractConfig()]);
  } catch {
    return unreachable;
  }
  const base = { dao, exists, members: 0, roles: [], accountRoles: [], isMember: false, canSpendIntents: false, governance: null, intentsKeys: 0 };
  if (!daoPayouts) return { ok: true, check: { ...base, problem: "The NearJar contract doesn't take DAO payouts yet." } };
  if (!exists) return { ok: true, check: { ...base, problem: `${dao} doesn't exist.` } };

  let policy: DaoPolicy;
  let intentsKeys: number;
  try {
    [policy, intentsKeys] = await Promise.all([fetchPolicy(dao), intentsKeyCount(dao)]);
  } catch {
    return { ok: false, error: `Could not read the policy of ${dao} right now. Try again in a minute.`, status: 502 };
  }
  const accountRoles = account ? memberRoles(policy, account) : [];
  const isMember = accountRoles.length > 0;
  const spend = !!account && canSpendIntents(policy, account);
  const problem = !account
    ? "Connect the wallet that is a member of the DAO."
    : !isMember
      ? `${account} isn't a member of ${dao}. Sign in with the wallet listed in the DAO's roles.`
      : !spend
        ? `${dao} couldn't spend these donations: your role needs to file FunctionCall requests (call:AddProposal) and a group role must be able to approve them (call:VoteApprove).`
        : intentsKeys > 0
          ? keysProblem(dao)
          : null;
  return {
    ok: true,
    check: {
      ...base,
      members: memberCount(policy),
      roles: policy.roles.map((r) => r.name),
      accountRoles,
      isMember,
      canSpendIntents: spend,
      governance: governance(policy),
      intentsKeys,
      problem,
    },
  };
}

/** For the API: the refusal (message + HTTP status) when `signer` may not make a jar paying `dao`. */
export async function daoPayoutRefusal(dao: string, signer: string): Promise<{ error: string; status: number } | null> {
  const r = await checkDao(dao, signer);
  if (!r.ok) return { error: r.error, status: r.status };
  return r.check.problem ? { error: r.check.problem, status: r.check.exists ? 403 : 422 } : null;
}

/**
 * Before every quote to a DAO jar: why donations can't go to `dao` now, or null. 1Click credits
 * any intents id, even a name nobody has created yet (whoever creates it later gets the money),
 * and a key registered since the jar was made could spend it alone. Any lookup failure refuses.
 */
export async function daoTreasuryRefusal(dao: string): Promise<string | null> {
  if (!isDaoId(dao)) return "This jar's DAO payout isn't a Sputnik DAO.";
  let exists: boolean;
  let keys: number;
  try {
    [exists, keys] = await Promise.all([daoExists(dao), intentsKeyCount(dao)]);
  } catch {
    return "Could not check the jar's DAO treasury right now. Try again in a minute.";
  }
  if (!exists) return "This jar's DAO treasury doesn't exist.";
  if (keys > 0) return "This jar's DAO treasury can be spent with a key, not only by proposal, so NearJar doesn't send donations to it.";
  return null;
}

/** For the jar page: who decides over the treasury, and whether a key could spend it alone. */
export async function daoGovernance(dao: string): Promise<{ governance: Governance; intentsKeys: number }> {
  const [policy, intentsKeys] = await Promise.all([fetchPolicy(dao), intentsKeyCount(dao)]);
  return { governance: governance(policy), intentsKeys };
}
