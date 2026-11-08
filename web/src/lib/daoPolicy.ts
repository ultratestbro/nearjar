// Sputnik DAO treasuries as jar payouts: reading a DAO id people paste and a DAO's policy
// (`get_policy`). Pure functions, shared by the editor, the API routes and the tests.

export const DAO_FACTORY = "sputnik-dao.near";
const SUFFIX = `.${DAO_FACTORY}`;

// one label of a NEAR account id: lowercase letters and digits, single - or _ between them
const LABEL = /^([a-z\d]+[-_])*[a-z\d]+$/;

/**
 * Exactly `<label>.sputnik-dao.near`, as the contract accepts it. Only the factory can create its
 * sub-accounts and it creates nothing but DAOs, so the suffix plus a working `get_policy` prove a
 * Sputnik DAO. No case folding: this checks ids that come signed.
 */
export function isDaoId(id: unknown): id is string {
  if (typeof id !== "string" || id.length > 64 || !id.endsWith(SUFFIX)) return false;
  return LABEL.test(id.slice(0, -SUFFIX.length));
}

/**
 * What people paste → the DAO id, or null. Takes a bare name (`shitzu`), the full id in any case,
 * or a Trezu link (`https://trezu.app/shitzu.sputnik-dao.near/payments`).
 */
export function parseDaoId(input: unknown): string | null {
  let s = String(input ?? "").trim().toLowerCase();
  const link = /^(?:https?:\/\/)?(?:www\.)?trezu\.app\/([^/?#\s]+)(?:[/?#]\S*)?$/.exec(s);
  if (link) {
    try {
      s = decodeURIComponent(link[1]!);
    } catch {
      return null;
    }
  }
  if (!s.includes(".")) s += SUFFIX;
  return isDaoId(s) ? s : null;
}

export const trezuUrl = (dao: string) => `https://trezu.app/${dao}`;

/** "shitzu.sputnik-dao.near" → "shitzu", for headings; the full id is shown next to it. */
export const daoLabel = (dao: string) => (dao.endsWith(SUFFIX) ? dao.slice(0, -SUFFIX.length) : dao);

/**
 * How a role votes on one proposal kind (Sputnik `VotePolicy`). Only role-weighted votes are
 * sized here; a token-weighted one is kept as `token` and never counted as a known threshold.
 */
export type VoteRule =
  | { weight: "role"; quorum: bigint; threshold: { weight: bigint } | { ratio: [bigint, bigint] } }
  | { weight: "token" };

/** The part of Sputnik's `get_policy` that NearJar reads. */
export interface DaoRole {
  name: string;
  /** `"Everyone"`, `{ Group: [account…] }` or `{ Member: "<min token weight>" }`. */
  kind: unknown;
  permissions: string[];
  /** Per proposal kind (`call`, `policy`…); a malformed entry is null, i.e. unknown. */
  votePolicy: Record<string, VoteRule | null>;
}

export interface DaoPolicy {
  roles: DaoRole[];
  /** Used for kinds a role has no rule for; null when missing or malformed. */
  defaultVotePolicy: VoteRule | null;
}

const U128 = /^\d{1,39}$/;

function parseVoteRule(raw: unknown): VoteRule | null {
  const v = raw as { weight_kind?: unknown; quorum?: unknown; threshold?: unknown } | null;
  if (!v || typeof v !== "object") return null;
  if (v.weight_kind === "TokenWeight") return { weight: "token" };
  if (v.weight_kind !== "RoleWeight" || typeof v.quorum !== "string" || !U128.test(v.quorum)) return null;
  const t = v.threshold;
  // WeightOrRatio is untagged: "3" is a weight, [1, 2] a ratio (u64 / non-zero u64)
  if (typeof t === "string" && U128.test(t)) return { weight: "role", quorum: BigInt(v.quorum), threshold: { weight: BigInt(t) } };
  if (Array.isArray(t) && t.length === 2 && t.every((x) => Number.isSafeInteger(x) && x >= 0) && t[1] > 0)
    return { weight: "role", quorum: BigInt(v.quorum), threshold: { ratio: [BigInt(t[0]), BigInt(t[1])] } };
  return null;
}

/** Untrusted `get_policy` output → the roles, or null when it isn't a Sputnik policy. */
export function parsePolicy(raw: unknown): DaoPolicy | null {
  const p = raw as { roles?: unknown; default_vote_policy?: unknown } | null;
  const roles = p?.roles;
  if (!Array.isArray(roles)) return null;
  const out: DaoRole[] = [];
  for (const r of roles as Record<string, unknown>[]) {
    if (!r || typeof r.name !== "string" || !Array.isArray(r.permissions) || r.permissions.some((p) => typeof p !== "string")) return null;
    const vp = r.vote_policy && typeof r.vote_policy === "object" ? (r.vote_policy as Record<string, unknown>) : {};
    const votePolicy = Object.fromEntries(Object.entries(vp).map(([kind, rule]) => [kind, parseVoteRule(rule)]));
    out.push({ name: r.name, kind: r.kind, permissions: r.permissions as string[], votePolicy });
  }
  return { roles: out, defaultVotePolicy: parseVoteRule(p?.default_vote_policy) };
}

const groupOf = (r: DaoRole): string[] | null => {
  const g = (r.kind as { Group?: unknown } | null)?.Group;
  return Array.isArray(g) ? g.filter((a): a is string => typeof a === "string") : null;
};

/**
 * Roles that list the account by name and grant something. `Everyone` never makes a member (in
 * many DAOs it lets anyone file a transfer request), and token-weighted `Member` roles are not
 * supported yet.
 */
export function memberRoles(policy: DaoPolicy, accountId: string): string[] {
  const id = accountId.trim().toLowerCase();
  return policy.roles.filter((r) => r.permissions.length > 0 && groupOf(r)?.includes(id)).map((r) => r.name);
}

export function membership(policy: DaoPolicy, accountId: string): boolean {
  return memberRoles(policy, accountId).length > 0;
}

/** Distinct accounts across the roles that grant something. */
export function memberCount(policy: DaoPolicy): number {
  return new Set(policy.roles.filter((r) => r.permissions.length > 0).flatMap((r) => groupOf(r) ?? [])).size;
}

/** Sputnik's permission check: `<kind>:<action>` with `*` on either side. */
function allows(permissions: string[], kind: string, action: string): boolean {
  return permissions.some((p) => p === `${kind}:${action}` || p === `${kind}:*` || p === `*:${action}` || p === "*:*");
}

const min = (a: bigint, b: bigint) => (a < b ? a : b);
const max = (a: bigint, b: bigint) => (a > b ? a : b);

/** Approvals a proposal of `kind` needs from one role, as Sputnik's `proposal_status` counts them. */
export interface Approval {
  role: string;
  /** Votes that pass it (at least 1: somebody has to vote). */
  approvals: number;
  /** The role's member count. */
  of: number;
}

/**
 * The cheapest way to pass a proposal of `kind`: the fewest approvals over the roles that may
 * approve it. Sputnik skips `Everyone` when it counts votes, so that role never approves. A Group
 * role with role-weighted votes needs max(quorum, threshold of its size); one whose rule can't be
 * reached (an empty group, a quorum above its size) can't approve. `unknown` is set when some role
 * approves in a way this can't size (token-weighted votes, a Member role, a malformed rule), so
 * the true minimum may be lower than `best`.
 */
export function approvalsFor(policy: DaoPolicy, kind: string): { best: Approval | null; unknown: boolean } {
  let best: Approval | null = null;
  let unknown = false;
  for (const r of policy.roles) {
    if (r.kind === "Everyone" || !allows(r.permissions, kind, "VoteApprove")) continue;
    const group = groupOf(r);
    const rule = Object.hasOwn(r.votePolicy, kind) ? r.votePolicy[kind]! : policy.defaultVotePolicy;
    if (!group || !rule || rule.weight !== "role") {
      unknown = true;
      continue;
    }
    const size = BigInt(group.length);
    const t = rule.threshold;
    // WeightOrRatio::to_weight, then the quorum floor
    const weight = min("weight" in t ? t.weight : (t.ratio[0] * size) / t.ratio[1] + 1n, size);
    const need = max(rule.quorum, weight);
    if (size === 0n || need > size) continue;
    const approvals = Number(max(need, 1n));
    if (!best || approvals < best.approvals) best = { role: r.name, approvals, of: group.length };
  }
  return { best, unknown };
}

/**
 * Proposal kinds that move the treasury's NEAR Intents funds (`call`) or can hand someone that
 * power: changing the policy or roles, swapping the DAO's code, the vote token or factory info.
 */
const CONTROL_KINDS = [
  "call",
  "policy",
  "policy_add_or_update_role",
  "policy_remove_role",
  "policy_update_default_vote_policy",
  "policy_update_parameters",
  "add_member_to_role",
  "remove_member_from_role",
  "upgrade_self",
  "upgrade_remote",
  "set_vote_token",
  "factory_info_update",
];

/** Who decides over a DAO treasury, as the jar page and the editor show it. */
export interface Governance {
  /** Distinct accounts listed in roles that grant something. */
  members: number;
  /** What a FunctionCall proposal (spending Intents funds) needs, or null when nothing can pass one. */
  spend: Approval | null;
  /**
   * Why "no single member can move them" would be false, or null when it holds: one approval
   * spends (`spend`), or changes the policy, roles or code so it could (`rules`), or some vote is
   * token-weighted and can't be sized here (`unsized`).
   */
  solo: "spend" | "rules" | "unsized" | null;
}

export function governance(policy: DaoPolicy): Governance {
  const spend = approvalsFor(policy, "call");
  let solo: Governance["solo"] = null;
  for (const kind of CONTROL_KINDS) {
    const a = approvalsFor(policy, kind);
    if (a.best && a.best.approvals <= 1) solo = kind === "call" ? "spend" : solo === "spend" ? solo : "rules";
    else if (a.unknown) solo ??= "unsized";
  }
  return { members: memberCount(policy), spend: spend.best, solo };
}

/** The warning to show next to a DAO when one account could act alone, or null. */
export function soloText(g: Governance): string | null {
  if (g.solo === "spend") return "One member can approve spending alone";
  if (g.solo === "rules") return "One member can change its rules alone";
  if (g.solo === "unsized") return "Some of its votes are token-weighted, so one big holder may act alone";
  return null;
}

/**
 * Donations land in the DAO's NEAR Intents balance, and only a FunctionCall proposal on
 * intents.near (`mt_transfer`, `ft_withdraw`) moves it; a Transfer proposal can't. So the account
 * must be able to file a `call` proposal, and some Group role must be able to pass one.
 */
export function canSpendIntents(policy: DaoPolicy, accountId: string): boolean {
  const id = accountId.trim().toLowerCase();
  // Sputnik grants a member the union of every role that matches them, Everyone included
  const own = policy.roles.filter((r) => r.kind === "Everyone" || groupOf(r)?.includes(id)).flatMap((r) => r.permissions);
  if (!membership(policy, id) || !allows(own, "call", "AddProposal")) return false;
  return approvalsFor(policy, "call").best !== null;
}

/** "Spending needs 3 of the 9 members of “council”", for the jar page and the editor. */
export function spendText(g: Governance): string {
  if (!g.spend) return "Nothing in its policy can approve spending";
  const { approvals, of, role } = g.spend;
  return of === 1 ? `Spending needs the one member of “${role}”` : `Spending needs ${approvals} of the ${of} members of “${role}”`;
}

/** "Spending: 3 of 9 approvals", the jar page's one-line form of spendText (the full sentence goes in its tooltip). */
export function spendShort(g: Governance): string {
  if (!g.spend) return "No spending rule";
  const { approvals, of } = g.spend;
  return of === 1 ? "Spending: 1 approval" : `Spending: ${approvals} of ${of} approvals`;
}

// ---------- the DAO's calls to NearJar ----------

/** Gas both DAO calls attach: they only flip a flag, 30 Tgas is plenty. */
export const DAO_CALL_GAS = "30000000000000";

/**
 * A Trezu Request Template (Settings → Developer → Custom Requests): one reusable form that files
 * the FunctionCall proposal. `uint` fields stay JSON strings, which is what the contract's ids take.
 */
export function trezuTemplate(contract: string, method: "endorse_jar" | "dao_close_jar", jarId: string, revision: string): string {
  const endorse = method === "endorse_jar";
  const fields = [
    { name: "jar_id", label: "Jar id", type: "uint", required: true, default: jarId },
    ...(endorse
      ? [{ name: "revision", label: "Revision", type: "uint", required: true, default: revision, help: "The jar's revision the members review, shown in the NearJar studio" }]
      : []),
  ];
  return JSON.stringify(
    {
      version: 1,
      id: endorse ? "nearjar-endorse" : "nearjar-close",
      title: endorse ? "Endorse a NearJar jar" : "Close a NearJar jar",
      binding: { receiver_id: contract, method_name: method, deposit: "0", gas: DAO_CALL_GAS },
      fields,
      args: endorse ? { jar_id: "{{jar_id}}", revision: "{{revision}}" } : { jar_id: "{{jar_id}}" },
      summary: endorse ? "Endorse NearJar jar #{{jar_id}} (revision {{revision}})" : "Close NearJar jar #{{jar_id}}",
    },
    null,
    2,
  );
}

/** `add_proposal` arguments for near-cli: Sputnik takes the call's args base64-encoded. */
export function addProposalArgs(contract: string, method: string, args: string, description: string): string {
  return JSON.stringify({
    proposal: {
      description,
      kind: { FunctionCall: { receiver_id: contract, actions: [{ method_name: method, args: btoa(args), deposit: "0", gas: DAO_CALL_GAS }] } },
    },
  });
}
