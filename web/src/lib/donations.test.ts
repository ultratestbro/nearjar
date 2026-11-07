// The relayer writes a donation receipt into the contract only for what 1Click confirms: a
// finished swap credited to the account the contract pays for that jar. A row edited in the
// database (status, amounts, jar) records nothing.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Jar } from "./jars";

vi.stubEnv("TURSO_DATABASE_URL", ":memory:");
vi.mock("./near", async (orig) => ({ ...(await orig<typeof import("./near")>()), relayCall: vi.fn() }));
const { db } = await import("./db");
const { relayCall } = await import("./near");
const { receiptRefusal, refreshDonation } = await import("./donations");
const relayed = vi.mocked(relayCall);

const DAO = "shitzu.sputnik-dao.near";
const OWNER = "0x63428e70a8016d10e8e2f7da440c898063afa299";
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const jar = (id: string, payout: string | null): Jar => ({
  id, owner: OWNER, payout, endorsed: false, revision: "0", slug: null, page: null, title: "t", description: "", image_url: null,
  goal_usd_cents: null, ends_at: null, receive_asset: USDC, status: "Open", created_at: "0", raised_usd_cents: "0", donations_count: "0",
});

/** 1Click's /status answer for a deposit, as the OpenAPI spec shapes it. */
const status = (over: { status?: string; recipient?: string; recipientType?: string; amountOutUsd?: string } = {}) => ({
  status: over.status ?? "SUCCESS",
  quoteResponse: {
    quoteRequest: { recipient: over.recipient ?? DAO, recipientType: over.recipientType ?? "INTENTS", destinationAsset: USDC },
    quote: { amountOutUsd: "4.99" },
  },
  swapDetails: { amountOut: "4990000", amountOutUsd: over.amountOutUsd ?? "4.99", nearTxHashes: ["DeliveryTx111"], originChainTxHashes: ["SourceTx111"] },
});

let jars: Record<string, Jar>;
let oneClick: Record<string, ReturnType<typeof status>>;

beforeAll(async () => {
  await db();
});
beforeEach(() => {
  jars = { "1": jar("1", DAO), "2": jar("2", null) };
  oneClick = {};
  relayed.mockReset();
  relayed.mockResolvedValue({ ok: true, value: "0", txHash: "RecordTx" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith("/status")) {
        const s = oneClick[u.searchParams.get("depositAddress") ?? ""];
        return s ? Response.json(s) : new Response("not found", { status: 404 });
      }
      const p = JSON.parse(String(init?.body)).params;
      const args = JSON.parse(Buffer.from(p.args_base64, "base64").toString());
      if (p.method_name !== "get_jar") throw new Error(`unexpected ${p.method_name}`);
      return Response.json({ result: { result: [...Buffer.from(JSON.stringify(jars[args.jar_id] ?? null))] } });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

let n = 0;
/** A donation row; `status` and amounts are whatever the database says. */
async function row(jarId: string, dbStatus: string, deposit = `dep-${++n}`): Promise<string> {
  const id = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  await (await db()).execute({
    sql: `INSERT INTO donations (id, jar_id, method, source_chain, source_symbol, amount_in, usd_cents, receive_asset, deposit_address,
      intent_id, refund_address, status, delivered_usd_cents, valid_until, created_at, updated_at)
      VALUES (?, ?, 'Wallet', 'solana:mainnet', 'USDC', '5000000', 500, ?, ?, 'intent', 'refund', ?, 900000, 0, ?, ?)`,
    args: [id, jarId, USDC, deposit, dbStatus, Date.now(), Date.now()],
  });
  return id;
}

describe("receiptRefusal", () => {
  const s = (over: Parameters<typeof status>[0] = {}) => {
    const x = status(over);
    return {
      status: x.status,
      amountOut: x.swapDetails.amountOut,
      deliveredUsdCents: 499,
      deliveryTx: "t",
      sourceTx: "s",
      recipient: x.quoteResponse.quoteRequest.recipient,
      recipientType: x.quoteResponse.quoteRequest.recipientType,
      destinationAsset: USDC,
      quotedUsdCents: 499,
    };
  };
  it("a finished swap to the jar's DAO over public Intents", () => expect(receiptRefusal(jar("1", DAO), s())).toBeNull());
  it("a plain jar's owner, public or confidential", () => {
    expect(receiptRefusal(jar("2", null), s({ recipient: OWNER }))).toBeNull();
    expect(receiptRefusal(jar("2", null), s({ recipient: OWNER, recipientType: "CONFIDENTIAL_INTENTS" }))).toBeNull();
  });
  it.each([
    ["not finished", jar("1", DAO), s({ status: "PROCESSING" })],
    ["paid someone else", jar("1", DAO), s({ recipient: "evil.near" })],
    ["paid the creator of a DAO jar", jar("1", DAO), s({ recipient: OWNER })],
    ["a confidential credit the DAO can't see", jar("1", DAO), s({ recipientType: "CONFIDENTIAL_INTENTS" })],
    ["withdrawn to a chain", jar("2", null), s({ recipient: OWNER, recipientType: "DESTINATION_CHAIN" })],
  ])("refuses: %s", (_name, j, st) => expect(receiptRefusal(j, st)).not.toBeNull());
});

describe("recording a delivered donation", () => {
  it("records what 1Click confirms, not what the row says", async () => {
    const id = await row("1", "delivered", "dep-ok");
    oneClick["dep-ok"] = status();
    await refreshDonation(id);
    expect(relayed).toHaveBeenCalledOnce();
    const [method, args] = relayed.mock.calls[0]!;
    expect(method).toBe("record_donation");
    // the row claims $9,000; 1Click delivered $4.99
    expect(args).toMatchObject({ jar_id: "1", donation: { source_id: "dep-ok", usd_cents: "499", amount: "4990000", asset: USDC, delivery_tx: "DeliveryTx111" } });
  });

  it("a row marked delivered that 1Click doesn't confirm records nothing", async () => {
    const id = await row("1", "delivered", "dep-fake");
    oneClick["dep-fake"] = status({ status: "PENDING_DEPOSIT" });
    await refreshDonation(id);
    const unknown = await row("1", "delivered", "dep-unknown");
    await refreshDonation(unknown);
    expect(relayed).not.toHaveBeenCalled();
  });

  it("a real delivery moved to another jar in the database records nothing", async () => {
    // 1Click credited jar 2's owner; the row was edited to say jar 1 (the DAO jar)
    const id = await row("1", "delivered", "dep-moved");
    oneClick["dep-moved"] = status({ recipient: OWNER });
    await refreshDonation(id);
    expect(relayed).not.toHaveBeenCalled();
  });

  it("a donation in flight is recorded once 1Click says it landed", async () => {
    const id = await row("2", "processing", "dep-live");
    oneClick["dep-live"] = status({ recipient: OWNER, recipientType: "CONFIDENTIAL_INTENTS" });
    const d = await refreshDonation(id);
    expect(d?.status).toBe("delivered");
    expect(d?.recorded_tx).toBe("RecordTx");
    expect(relayed).toHaveBeenCalledOnce();
  });

  it("when the jar can't be read, nothing is recorded (and it's retried later)", async () => {
    const id = await row("3", "delivered", "dep-nojar");
    oneClick["dep-nojar"] = status();
    const d = await refreshDonation(id);
    expect(relayed).not.toHaveBeenCalled();
    expect(d?.recorded_tx).toBeNull();
  });
});
