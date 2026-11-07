import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sourceAsset } from "./assets";
import { clearDaoCache } from "./dao";
import type { Jar } from "./jars";
import { payoutAccount, payoutOf, quoteDonation } from "./quote";

const SOL_USDC = sourceAsset("solana:mainnet", "USDC")!;
vi.mock("./prices", async (orig) => ({
  ...(await orig<typeof import("./prices")>()),
  tokenPrices: async () => new Map([[SOL_USDC.assetId, { assetId: SOL_USDC.assetId, decimals: 6, symbol: "USDC", price: 1 }]]),
}));

const DAO = "shitzu.sputnik-dao.near";
const OWNER = "0x63428e70a8016d10e8e2f7da440c898063afa299";
const jar = (payout: string | null): Jar => ({
  id: "3",
  owner: OWNER,
  payout,
  endorsed: false,
  revision: "0",
  slug: null,
  page: null,
  title: "t",
  description: "",
  image_url: null,
  goal_usd_cents: null,
  ends_at: null,
  receive_asset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  status: "Open",
  created_at: "0",
  raised_usd_cents: "0",
  donations_count: "0",
});

/**
 * NEAR RPC and 1Click in one fake: which accounts exist, which hold intents.near keys, and every
 * 1Click quote request seen.
 */
function fakeNetwork({ accounts = [DAO], keys = {} as Record<string, string[]>, rpcDown = false } = {}) {
  const quotes: Record<string, unknown>[] = [];
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/quote")) {
      quotes.push(JSON.parse(String(init?.body)));
      return Response.json({ quote: { depositAddress: "", amountOut: "4990000", minAmountOut: "4900000", amountInUsd: "5", amountOutUsd: "4.99", timeEstimate: 20 } });
    }
    if (rpcDown) throw new TypeError("fetch failed");
    const p = JSON.parse(String(init?.body)).params;
    if (p.request_type === "view_account") {
      if (!accounts.includes(p.account_id)) return Response.json({ error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_ACCOUNT" } } });
      return Response.json({ result: { code_hash: "11111111111111111111111111111111", global_contract_hash: "DtHZA1mUmGYeScEaUoUZYQGGFHSMpnjMCvkr5U9hJXuF" } });
    }
    const args = JSON.parse(Buffer.from(p.args_base64, "base64").toString());
    const out =
      p.method_name === "get_config"
        ? { intents_id: "intents.near", version: "0.2.0" }
        : p.method_name === "public_keys_of" && p.account_id === "intents.near"
          ? (keys[args.account_id] ?? [])
          : undefined;
    if (out === undefined) throw new Error(`unexpected request ${u} ${p.method_name}`);
    return Response.json({ result: { result: [...Buffer.from(JSON.stringify(out))] } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { quotes, fetchMock };
}

const donate = (j: Jar) => quoteDonation({ jar: j, usdCents: 500, sourceChain: "solana:mainnet", sourceSymbol: "USDC", dry: true });

beforeEach(() => clearDaoCache());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("payoutOf", () => {
  it("a DAO jar pays its treasury's public intents balance", () => {
    expect(payoutOf(jar(DAO))).toEqual({ account: DAO, recipientType: "INTENTS", dao: true });
    expect(payoutAccount(jar(DAO))).toBe(DAO);
  });

  it("a plain jar pays its owner", () => {
    expect(payoutOf(jar(null))).toEqual({ account: OWNER, recipientType: "INTENTS", dao: false });
    expect(payoutAccount(jar(null))).toBe(OWNER);
  });

  it("with a partner JWT the owner gets a confidential credit, the DAO still a public one", async () => {
    vi.stubEnv("ONE_CLICK_JWT", "test-jwt");
    vi.resetModules();
    const q = await import("./quote");
    expect(q.payoutOf(jar(null)).recipientType).toBe("CONFIDENTIAL_INTENTS");
    expect(q.payoutOf(jar(DAO)).recipientType).toBe("INTENTS");
  });
});

describe("quoteDonation", () => {
  it("quotes a DAO jar to the DAO with recipientType INTENTS", async () => {
    const { quotes } = fakeNetwork();
    const r = await donate(jar(DAO));
    expect(r.ok).toBe(true);
    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({ recipient: DAO, recipientType: "INTENTS", dry: true });
  });

  it("quotes a plain jar to the owner", async () => {
    const { quotes } = fakeNetwork();
    expect((await donate(jar(null))).ok).toBe(true);
    expect(quotes[0]).toMatchObject({ recipient: OWNER, recipientType: "INTENTS" });
  });

  it("refuses before 1Click when the DAO doesn't exist (1Click would credit it anyway)", async () => {
    const { quotes } = fakeNetwork({ accounts: [] });
    expect(await donate(jar(DAO))).toEqual({ ok: false, error: "This jar's DAO treasury doesn't exist." });
    expect(quotes).toHaveLength(0);
  });

  it("refuses when NEAR can't be asked (fail closed)", async () => {
    const { quotes } = fakeNetwork({ rpcDown: true });
    const r = await donate(jar(DAO));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/Could not check the jar's DAO treasury/);
    expect(quotes).toHaveLength(0);
  });

  it("refuses a DAO whose Intents balance a key can spend without a proposal", async () => {
    const { quotes } = fakeNetwork({ keys: { [DAO]: ["ed25519:5a8xWYm8UjEGCAs3MQhWVuGuJ3Ko2DJ6VM2xjWrHXBkx"] } });
    const r = await donate(jar(DAO));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/spent with a key/);
    expect(quotes).toHaveLength(0);
  });

  it("refuses a payout that isn't a DAO id", async () => {
    const { quotes } = fakeNetwork({ accounts: ["evil.near"] });
    expect((await donate(jar("evil.near"))).ok).toBe(false);
    expect(quotes).toHaveLength(0);
  });

  it("with a partner JWT a DAO quote still asks for INTENTS", async () => {
    vi.stubEnv("ONE_CLICK_JWT", "test-jwt");
    vi.resetModules();
    const q = await import("./quote");
    const { quotes, fetchMock } = fakeNetwork();
    await q.quoteDonation({ jar: jar(DAO), usdCents: 500, sourceChain: "solana:mainnet", sourceSymbol: "USDC", dry: true });
    expect(quotes[0]).toMatchObject({ recipient: DAO, recipientType: "INTENTS" });
    const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/quote"))!;
    expect(JSON.stringify(call[1]?.headers)).toContain("test-jwt");
  });
});
