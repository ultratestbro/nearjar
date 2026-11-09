// The DAO payout gates of /api/jars/prepare, /api/jars (relay) and /api/dao, against a fake NEAR
// RPC built from recorded get_policy answers. The relayer itself is mocked: a refusal must never
// reach it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import shitzu from "@/lib/__fixtures__/policy-shitzu.json";
import { clearDaoCache } from "@/lib/dao";
import { envelope, type JarInput } from "@/lib/jarActions";
import { relayCall } from "@/lib/near";
import { GET as daoCheck } from "../dao/route";
import { POST as prepare } from "./prepare/route";
import { POST as relay } from "./route";

vi.mock("@/lib/near", async (orig) => ({ ...(await orig<typeof import("@/lib/near")>()), relayCall: vi.fn() }));
const relayed = vi.mocked(relayCall);

const DAO = "shitzu.sputnik-dao.near";
const MEMBER = "sealteam666.near";
const OUTSIDER = "random-outsider.near";
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const onChainJar = (id: string, payout: string | null, owner = MEMBER, slug: string | null = null) => ({
  id, owner, payout, endorsed: false, revision: "0", slug, page: null, title: "t", description: "", image_url: null, goal_usd_cents: null,
  ends_at: null, receive_asset: USDC, status: "Open", created_at: "0", raised_usd_cents: "0", donations_count: "0",
});

interface Chain {
  accounts: string[];
  policies: Record<string, unknown>;
  jars: Record<string, ReturnType<typeof onChainJar>>;
  /** intents.near keys per account */
  keys: Record<string, string[]>;
  /** nearjar.near get_config */
  config: Record<string, unknown>;
  down: boolean;
}
let chain: Chain;

/** A NEAR RPC that knows a few accounts, DAO policies, intents keys and jars; `down` makes every call fail. */
function fakeRpc() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string | URL, init?: RequestInit) => {
      if (chain.down) throw new TypeError("fetch failed");
      const p = JSON.parse(String(init?.body)).params;
      if (p.request_type === "view_account") {
        if (!chain.accounts.includes(p.account_id)) return Response.json({ error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_ACCOUNT" } } });
        return Response.json({ result: { code_hash: "4zSoHkLjJWZm34Psd4Eq2WUXHELt6LxtKmUXpsZWAECp" } });
      }
      const args = JSON.parse(Buffer.from(p.args_base64, "base64").toString());
      const out =
        p.method_name === "get_policy"
          ? chain.policies[p.account_id]
          : p.method_name === "get_jar"
            ? (chain.jars[args.jar_id] ?? null)
            : p.method_name === "get_jar_by_slug"
              ? (Object.values(chain.jars).find((j) => j.slug === args.slug) ?? null)
              : p.method_name === "get_config" && p.account_id === "nearjar.near"
                ? chain.config
                : p.method_name === "public_keys_of" && p.account_id === "intents.near"
                  ? (chain.keys[args.account_id] ?? [])
                  : undefined;
      if (out === undefined) return Response.json({ error: { name: "HANDLER_ERROR", cause: { name: "NO_CONTRACT_CODE" } } });
      return Response.json({ result: { result: [...Buffer.from(JSON.stringify(out))] } });
    }),
  );
}

beforeEach(() => {
  chain = {
    accounts: [DAO],
    policies: { [DAO]: shitzu },
    jars: {},
    keys: {},
    config: { owner_id: "nearjar.near", intents_id: "intents.near", jars_count: "0", version: "0.2.0" },
    down: false,
  };
  clearDaoCache();
  fakeRpc();
  relayed.mockReset();
  relayed.mockResolvedValue({ ok: true, value: "5", txHash: "tx1" });
});
afterEach(() => vi.unstubAllGlobals());

const post = (body: unknown, ip = String(Math.random())) =>
  new Request("http://localhost/api", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) });
const FIELDS = { title: "Community fund", description: "", goal_usd: "1500", receive_asset: USDC };

describe("POST /api/jars/prepare", () => {
  it("signs a member's DAO jar with the payout in the text", async () => {
    const res = await prepare(post({ signerId: MEMBER, action: "create_jar", jar: { ...FIELDS, payout: "https://trezu.app/shitzu.sputnik-dao.near" } }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.payout).toBe(DAO);
    expect(JSON.parse(body.message).jar.payout).toBe(DAO);
  });

  it("refuses an outsider", async () => {
    const res = await prepare(post({ signerId: OUTSIDER, action: "create_jar", jar: { ...FIELDS, payout: "shitzu" } }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false });
    expect(body.error).toMatch(/isn't a member of shitzu\.sputnik-dao\.near/);
    expect(body.message).toBeUndefined();
  });

  it("refuses a DAO that doesn't exist", async () => {
    const res = await prepare(post({ signerId: MEMBER, action: "create_jar", jar: { ...FIELDS, payout: "nearjar-nonexistent-zz9" } }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/doesn't exist/);
  });

  it.each(["x.sputnik-dao.near.evil.near", "evil.near", "sputnik-dao.near", "a.b.sputnik-dao.near"])("refuses the look-alike %s", async (payout) => {
    const res = await prepare(post({ signerId: MEMBER, action: "create_jar", jar: { ...FIELDS, payout } }));
    expect(res.status).toBe(400);
  });

  it("refuses a DAO that couldn't spend Intents funds", async () => {
    chain.policies[DAO] = { roles: [{ name: "council", kind: { Group: [MEMBER] }, permissions: ["transfer:AddProposal", "*:VoteApprove"] }] };
    const res = await prepare(post({ signerId: MEMBER, action: "create_jar", jar: { ...FIELDS, payout: DAO } }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/call:AddProposal/);
  });

  it("fails closed when NEAR doesn't answer", async () => {
    chain.down = true;
    const res = await prepare(post({ signerId: MEMBER, action: "create_jar", jar: { ...FIELDS, payout: DAO } }));
    expect(res.status).toBe(503);
  });

  it("an update signs the on-chain payout, whatever the client sends", async () => {
    chain.jars["7"] = onChainJar("7", DAO);
    chain.jars["8"] = onChainJar("8", null);
    const keep = await (await prepare(post({ signerId: MEMBER, action: "update_jar", jarId: "7", jar: { ...FIELDS, payout: "other.sputnik-dao.near" } }))).json();
    expect(JSON.parse(keep.message).jar.payout).toBe(DAO);
    const plain = await (await prepare(post({ signerId: MEMBER, action: "update_jar", jarId: "8", jar: { ...FIELDS, payout: DAO } }))).json();
    expect(JSON.parse(plain.message).jar).not.toHaveProperty("payout");
  });

  it("refuses a DAO whose Intents balance a key can spend alone", async () => {
    chain.keys[DAO] = ["ed25519:5a8xWYm8UjEGCAs3MQhWVuGuJ3Ko2DJ6VM2xjWrHXBkx"];
    const res = await prepare(post({ signerId: MEMBER, action: "create_jar", jar: { ...FIELDS, payout: DAO } }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/key registered on NEAR Intents/);
  });

  it("refuses DAO jars while the deployed contract can't store them (it would pay the signer)", async () => {
    chain.config = { owner_id: "nearjar.near", intents_id: "intents.near", jars_count: "0" };
    const res = await prepare(post({ signerId: MEMBER, action: "create_jar", jar: { ...FIELDS, payout: DAO } }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/doesn't take DAO payouts yet/);
  });

  it("signs the short link as a jar field once the contract says it's free", async () => {
    const body = await (await prepare(post({ signerId: MEMBER, action: "create_jar", jar: { ...FIELDS, page: { slug: "community-fund" } } }))).json();
    expect(JSON.parse(body.message).jar).toMatchObject({ slug: "community-fund", page: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) });
  });

  it("refuses a short link another jar holds on chain, before anyone signs", async () => {
    chain.jars["3"] = onChainJar("3", null, OUTSIDER, "community-fund");
    const res = await prepare(post({ signerId: MEMBER, action: "create_jar", jar: { ...FIELDS, page: { slug: "community-fund" } } }));
    expect(res.status).toBe(409);
    // the jar's own link is fine on an update
    chain.jars["3"] = onChainJar("3", null, MEMBER, "community-fund");
    const own = await prepare(post({ signerId: MEMBER, action: "update_jar", jarId: "3", jar: { ...FIELDS, page: { slug: "community-fund" } } }));
    expect(own.status).toBe(200);
  });

  it.each(["support", "demo"])("refuses the site's own link %s", async (slug) => {
    const res = await prepare(post({ signerId: MEMBER, action: "create_jar", jar: { ...FIELDS, page: { slug } } }));
    expect(res.status).toBe(400);
  });

  it("an update fails closed when the jar can't be read", async () => {
    chain.down = true;
    const res = await prepare(post({ signerId: MEMBER, action: "update_jar", jarId: "7", jar: FIELDS }));
    expect(res.status).toBe(502);
  });
});

describe("POST /api/jars (relay)", () => {
  const jarInput: JarInput = { title: "Community fund", description: "", image_url: null, goal_usd_cents: null, ends_at: null, receive_asset: USDC, slug: null, page_hash: null };
  /** What a wallet sends back: here the raw_ed25519 shape; the contract checks the signature, not this route. */
  const signed = (signer: string, action: Parameters<typeof envelope>[1]) => ({
    standard: "raw_ed25519",
    payload: envelope(signer, action).message,
    public_key: "ed25519:x",
    signature: "ed25519:y",
  });
  const createDao = (signer: string, payout: string) => ({ signed: signed(signer, { action: "create_jar", jar: jarInput, payout }) });

  it("relays a member's DAO jar and checks the contract kept the payout", async () => {
    chain.jars["5"] = onChainJar("5", DAO);
    const res = await relay(post(createDao(MEMBER, DAO)));
    expect(await res.json()).toMatchObject({ ok: true, jarId: "5" });
    expect(relayed).toHaveBeenCalledOnce();
  });

  it("says so when the contract dropped the payout", async () => {
    chain.jars["5"] = onChainJar("5", null);
    const res = await relay(post(createDao(MEMBER, DAO)));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/without the DAO payout/);
  });

  it.each(["demo", "Support"])("never submits a signed short link the site keeps for itself: %s", async (slug) => {
    const res = await relay(post({ signed: signed(MEMBER, { action: "create_jar", jar: { ...jarInput, slug }, payout: null }) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("That short link is reserved.");
    expect(relayed).not.toHaveBeenCalled();
  });

  it("refuses an outsider before the relayer pays (prepare skipped)", async () => {
    const res = await relay(post(createDao(OUTSIDER, DAO)));
    expect(res.status).toBe(403);
    expect(relayed).not.toHaveBeenCalled();
  });

  it("refuses a DAO that doesn't exist", async () => {
    const res = await relay(post(createDao(MEMBER, "ghost.sputnik-dao.near")));
    expect(res.status).toBe(422);
    expect(relayed).not.toHaveBeenCalled();
  });

  it.each(["Shitzu.sputnik-dao.near", "shitzu", "x.sputnik-dao.near.evil.near", "sputnik-dao.near"])("refuses a signed payout that isn't exact: %s", async (payout) => {
    chain.accounts.push(payout);
    const res = await relay(post(createDao(MEMBER, payout)));
    expect(res.status).toBe(400);
    expect(relayed).not.toHaveBeenCalled();
  });

  it("refuses a DAO with an intents.near key (prepare skipped)", async () => {
    chain.keys[DAO] = ["ed25519:5a8xWYm8UjEGCAs3MQhWVuGuJ3Ko2DJ6VM2xjWrHXBkx"];
    const res = await relay(post(createDao(MEMBER, DAO)));
    expect(res.status).toBe(403);
    expect(relayed).not.toHaveBeenCalled();
  });

  it("refuses when NEAR can't be asked", async () => {
    chain.down = true;
    const res = await relay(post(createDao(MEMBER, DAO)));
    expect(res.status).toBe(503);
    expect(relayed).not.toHaveBeenCalled();
  });

  it("relays a plain jar without asking any DAO", async () => {
    const res = await relay(post({ signed: signed(OUTSIDER, { action: "create_jar", jar: jarInput, payout: null }) }));
    expect(await res.json()).toMatchObject({ ok: true });
    expect(relayed).toHaveBeenCalledOnce();
  });

  it.each([
    ["switch a DAO jar to the owner", DAO, null],
    ["move a DAO jar to another DAO", DAO, "other.sputnik-dao.near"],
    ["give a plain jar a DAO", null, DAO],
  ])("an update can't %s", async (_name, stored, signedPayout) => {
    chain.jars["7"] = onChainJar("7", stored);
    const res = await relay(post({ signed: signed(MEMBER, { action: "update_jar", jar_id: "7", jar: jarInput, payout: signedPayout }) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/payout can't change/);
    expect(relayed).not.toHaveBeenCalled();
  });

  it("an update that repeats the payout goes through", async () => {
    chain.jars["7"] = onChainJar("7", DAO);
    const res = await relay(post({ signed: signed(MEMBER, { action: "update_jar", jar_id: "7", jar: jarInput, payout: DAO }) }));
    expect(res.status).toBe(200);
    expect(relayed).toHaveBeenCalledOnce();
  });

  it("checks NEP-413 and TON Connect messages too", async () => {
    const nep = envelope(OUTSIDER, { action: "create_jar", jar: jarInput, payout: DAO }, { nep413: true });
    const r1 = await relay(post({ signed: { standard: "nep413", payload: { message: nep.message, nonce: nep.nonce, recipient: "nearjar.near" }, public_key: "ed25519:x", signature: "ed25519:y" } }));
    expect(r1.status).toBe(403);
    const ton = envelope(OUTSIDER, { action: "create_jar", jar: jarInput, payout: DAO });
    const r2 = await relay(post({ signed: { standard: "ton_connect", address: "0:a", domain: "nearjar.xyz", timestamp: 1, payload: { type: "text", text: ton.message }, public_key: "ed25519:x", signature: "ed25519:y" } }));
    expect(r2.status).toBe(403);
    expect(relayed).not.toHaveBeenCalled();
  });

  it("refuses a message it can't read", async () => {
    const res = await relay(post({ signed: { standard: "erc191", payload: "not json", signature: "secp256k1:x" } }));
    expect(res.status).toBe(400);
    expect(relayed).not.toHaveBeenCalled();
  });
});

describe("GET /api/dao", () => {
  const get = (q: string, ip = String(Math.random())) => daoCheck(new Request(`http://localhost/api/dao?${q}`, { headers: { "x-forwarded-for": ip } }));

  it("answers the editor with the DAO's approval rule and keys", async () => {
    const body = await (await get(`id=shitzu&account=${MEMBER}`)).json();
    expect(body).toMatchObject({
      ok: true,
      dao: DAO,
      exists: true,
      isMember: true,
      canSpendIntents: true,
      intentsKeys: 0,
      governance: { members: 9, spend: { role: "council", approvals: 3, of: 9 }, solo: null },
      problem: null,
      trezuUrl: `https://trezu.app/${DAO}`,
    });
  });

  it("is throttled per address", async () => {
    for (let i = 0; i < 60; i++) expect((await get("id=x.near.evil", "1.2.3.4")).status).toBe(400);
    expect((await get(`id=shitzu&account=${MEMBER}`, "1.2.3.4")).status).toBe(429);
    expect((await get(`id=shitzu&account=${MEMBER}`, "5.6.7.8")).status).toBe(200);
  });
});
