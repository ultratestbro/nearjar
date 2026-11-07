import "server-only";

import { randomUUID } from "node:crypto";
import { sourceAsset } from "./assets";
import { db, type DonationRow } from "./db";
import { getJar, type Jar } from "./jars";
import { relayCall } from "./near";
import { payoutOf, quoteDonation, toNearCom } from "./quote";

const ONE_CLICK = process.env.ONE_CLICK_API_URL ?? "https://1click.chaindefuser.com/v0";
const TERMINAL = new Set(["delivered", "refunded", "failed", "expired"]);

export type CreateResult =
  | { ok: true; donation: PublicDonation; pay: PayInstruction }
  | { ok: false; error: string };

/** What the donor's wallet must send: an exact amount to a one-time 1Click deposit address. */
export interface PayInstruction {
  chain: string;
  symbol: string;
  contract: string | null; // token contract / mint / jetton master; null = native
  decimals: number;
  amount: string; // base units
  to: string;
  memo: string | null;
  validUntilMs: number;
}

export async function createDonation(input: {
  jar: Jar;
  method: DonationRow["method"];
  usdCents: number;
  sourceChain: string;
  sourceSymbol: string;
  refundAddress: string;
  name?: string;
  message?: string;
}): Promise<CreateResult> {
  const src = sourceAsset(input.sourceChain, input.sourceSymbol);
  if (!src) return { ok: false, error: "Unsupported token." };
  if (!input.refundAddress || input.refundAddress.length > 128) return { ok: false, error: "A refund address is required." };
  const name = clean(input.name, 40);
  const message = clean(input.message, 280);

  const q = await quoteDonation({
    jar: input.jar,
    usdCents: input.usdCents,
    sourceChain: input.sourceChain,
    sourceSymbol: input.sourceSymbol,
    refundAddress: input.refundAddress,
    dry: false,
  });
  if (!q.ok) return q;
  if (!q.quote.depositAddress) return { ok: false, error: "No deposit address came back." };

  const now = Date.now();
  const row: DonationRow = {
    id: randomUUID(),
    jar_id: input.jar.id,
    method: input.method,
    source_chain: src.chain,
    source_symbol: src.symbol,
    amount_in: q.quote.amountIn,
    usd_cents: input.usdCents,
    receive_asset: input.jar.receive_asset,
    deposit_address: q.quote.depositAddress,
    deposit_memo: q.quote.depositMemo,
    intent_id: q.quote.intentId,
    refund_address: input.refundAddress,
    source_tx: null,
    status: "awaiting_deposit",
    amount_out: null,
    delivered_usd_cents: null,
    delivery_tx: null,
    recorded_tx: null,
    donor_name: name,
    message,
    hidden: 0,
    valid_until: q.quote.validUntilMs,
    created_at: now,
    updated_at: now,
  };
  const c = await db();
  await c.execute({
    sql: `INSERT INTO donations (id, jar_id, method, source_chain, source_symbol, amount_in, usd_cents, receive_asset,
      deposit_address, deposit_memo, intent_id, refund_address, status, donor_name, message, valid_until, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [row.id, row.jar_id, row.method, row.source_chain, row.source_symbol, row.amount_in, row.usd_cents, row.receive_asset,
      row.deposit_address, row.deposit_memo, row.intent_id, row.refund_address, row.status, row.donor_name, row.message,
      row.valid_until, row.created_at, row.updated_at],
  });
  return {
    ok: true,
    donation: toPublic(row),
    pay: {
      chain: src.chain,
      symbol: src.symbol,
      contract: src.contract,
      decimals: src.decimals,
      amount: row.amount_in,
      to: row.deposit_address,
      memo: row.deposit_memo,
      validUntilMs: row.valid_until,
    },
  };
}

export async function getDonation(id: string): Promise<DonationRow | null> {
  const r = await (await db()).execute({ sql: "SELECT * FROM donations WHERE id = ?", args: [id] });
  return (r.rows[0] as unknown as DonationRow) ?? null;
}

/** The donor reports the source tx; 1Click is told so it credits the deposit faster. */
export async function markSubmitted(id: string, txHash: string): Promise<void> {
  const d = await getDonation(id);
  if (!d || d.source_tx) return;
  await (await db()).execute({
    sql: "UPDATE donations SET source_tx = ?, updated_at = ? WHERE id = ? AND source_tx IS NULL",
    args: [txHash, Date.now(), id],
  });
  await toNearCom.notifyDeposit?.(d.intent_id, txHash).catch(() => {});
}

/**
 * Refreshes a donation from 1Click. On delivery the relayer writes the receipt into the NearJar
 * contract once (source_id = deposit address, which the contract keeps unique).
 */
export async function refreshDonation(id: string): Promise<DonationRow | null> {
  let d = await getDonation(id);
  if (!d) return null;
  if (TERMINAL.has(d.status)) {
    if (d.status === "delivered" && !d.recorded_tx) await recordOnChain(d, await fetchStatus(d));
    return getDonation(id);
  }

  const s = await fetchStatus(d);
  let status: DonationRow["status"] = d.status;
  if (s.status === "SUCCESS") status = "delivered";
  else if (s.status === "REFUNDED") status = "refunded";
  else if (s.status === "FAILED") status = "failed";
  else if (s.status === "PROCESSING" || s.status === "KNOWN_DEPOSIT_TX" || s.status === "INCOMPLETE_DEPOSIT") status = "processing";
  // 1Click keeps a deposit address open for the quote's 60-minute deadline (the SDK asks for 60)
  else if (s.status === "PENDING_DEPOSIT" && Date.now() > d.created_at + 75 * 60_000 && !d.source_tx) status = "expired";

  await (await db()).execute({
    sql: `UPDATE donations SET status = ?, amount_out = COALESCE(?, amount_out), delivered_usd_cents = COALESCE(?, delivered_usd_cents),
      delivery_tx = COALESCE(?, delivery_tx), source_tx = COALESCE(source_tx, ?), updated_at = ? WHERE id = ?`,
    args: [status, s.amountOut, s.deliveredUsdCents, s.deliveryTx, s.sourceTx, Date.now(), id],
  });
  d = await getDonation(id);
  if (d && d.status === "delivered" && !d.recorded_tx) await recordOnChain(d, s);
  return getDonation(id);
}

/**
 * Refreshes a jar's open donations (and delivered ones not yet in the contract), so the total
 * moves even when the donor closed the status screen. Returns how many changed.
 */
export async function refreshPending(jarId: string): Promise<number> {
  const r = await (await db()).execute({
    sql: `SELECT id, status, recorded_tx FROM donations WHERE jar_id = ? AND created_at > ?
      AND (status IN ('awaiting_deposit', 'processing') OR (status = 'delivered' AND recorded_tx IS NULL))
      ORDER BY created_at DESC LIMIT 5`,
    args: [jarId, Date.now() - 2 * 86_400_000],
  });
  const changed = await Promise.all(
    r.rows.map(async (row) => {
      const d = await refreshDonation(String(row.id)).catch(() => null);
      return !!d && (d.status !== row.status || d.recorded_tx !== row.recorded_tx);
    }),
  );
  return changed.filter(Boolean).length;
}

/**
 * Why 1Click's word on this deposit can't go on chain as the jar's donation, or null when it can:
 * a finished swap, credited to the account the contract pays for this jar (its DAO treasury over
 * public NEAR Intents, or the owner's near.com balance). The database row only says which deposit
 * address to ask about; its status and amounts are never what gets recorded.
 */
export function receiptRefusal(jar: Pick<Jar, "owner" | "payout">, s: Status): string | null {
  if (s.status !== "SUCCESS") return "not delivered";
  const payout = payoutOf(jar);
  if (s.recipient !== payout.account) return "delivered to another account";
  const types = payout.dao ? ["INTENTS"] : ["INTENTS", "CONFIDENTIAL_INTENTS"];
  if (!s.recipientType || !types.includes(s.recipientType)) return "delivered the wrong way";
  if (!s.amountOut || !s.destinationAsset || (s.deliveredUsdCents ?? s.quotedUsdCents) === null) return "no amounts";
  return null;
}

async function recordOnChain(d: DonationRow, s: Status): Promise<void> {
  if (d.jar_id === "demo") return; // the developer's support jar is not in the contract
  const jar = await getJar(d.jar_id).catch(() => null);
  if (!jar || receiptRefusal(jar, s)) return;
  // Claim the write first: two status polls must not both relay it.
  const claim = await (await db()).execute({
    sql: "UPDATE donations SET recorded_tx = 'pending', updated_at = ? WHERE id = ? AND recorded_tx IS NULL",
    args: [Date.now(), d.id],
  });
  if (claim.rowsAffected !== 1) return;
  const res = await relayCall<string>(
    "record_donation",
    {
      jar_id: d.jar_id,
      donation: {
        source_id: d.deposit_address + (d.deposit_memo ? `#${d.deposit_memo}` : ""),
        method: d.method,
        usd_cents: String(s.deliveredUsdCents ?? s.quotedUsdCents),
        asset: s.destinationAsset,
        amount: s.amountOut,
        delivery_tx: s.deliveryTx ?? s.sourceTx ?? d.delivery_tx ?? "unknown",
      },
    },
    30,
  );
  const tx = res.ok ? res.txHash : /already recorded/.test(res.error) ? "already-recorded" : null;
  // on a real failure release the claim so the next poll retries
  await (await db()).execute({
    sql: "UPDATE donations SET recorded_tx = ?, updated_at = ? WHERE id = ? AND recorded_tx = 'pending'",
    args: [tx, Date.now(), d.id],
  });
}

export interface Status {
  status: string;
  amountOut: string | null;
  deliveredUsdCents: number | null;
  deliveryTx: string | null;
  sourceTx: string | null;
  /** From the quote 1Click signed for this deposit address: who it credits, how, and in what. */
  recipient: string | null;
  recipientType: string | null;
  destinationAsset: string | null;
  quotedUsdCents: number | null;
}

const UNKNOWN: Status = {
  status: "UNKNOWN",
  amountOut: null,
  deliveredUsdCents: null,
  deliveryTx: null,
  sourceTx: null,
  recipient: null,
  recipientType: null,
  destinationAsset: null,
  quotedUsdCents: null,
};

const cents = (usd: unknown): number | null => {
  const n = typeof usd === "string" && usd ? Math.round(Number(usd) * 100) : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

async function fetchStatus(d: DonationRow): Promise<Status> {
  const q = new URLSearchParams({ depositAddress: d.deposit_address });
  if (d.deposit_memo) q.set("depositMemo", d.deposit_memo);
  try {
    const res = await fetch(`${ONE_CLICK}/status?${q}`, {
      headers: process.env.ONE_CLICK_JWT ? { authorization: `Bearer ${process.env.ONE_CLICK_JWT}` } : {},
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return UNKNOWN;
    const s = (await res.json()) as {
      status?: string;
      quoteResponse?: {
        quoteRequest?: { recipient?: unknown; recipientType?: unknown; destinationAsset?: unknown };
        quote?: { amountOutUsd?: unknown };
      };
      swapDetails?: {
        amountOut?: string;
        amountOutUsd?: string;
        nearTxHashes?: unknown[];
        destinationChainTxHashes?: unknown[];
        originChainTxHashes?: unknown[];
      };
    };
    const sd = s.swapDetails ?? {};
    const req = s.quoteResponse?.quoteRequest ?? {};
    return {
      status: s.status ?? "UNKNOWN",
      amountOut: str(sd.amountOut),
      deliveredUsdCents: cents(sd.amountOutUsd),
      // credited inside intents.near: the NEAR tx is the delivery
      deliveryTx: hashOf(sd.nearTxHashes?.at(-1)) ?? hashOf(sd.destinationChainTxHashes?.[0]),
      sourceTx: hashOf(sd.originChainTxHashes?.[0]),
      recipient: str(req.recipient),
      recipientType: str(req.recipientType),
      destinationAsset: str(req.destinationAsset),
      quotedUsdCents: cents(s.quoteResponse?.quote?.amountOutUsd),
    };
  } catch {
    return UNKNOWN;
  }
}

function hashOf(e: unknown): string | null {
  if (typeof e === "string") return e;
  const h = (e as { hash?: unknown } | undefined)?.hash;
  return typeof h === "string" ? h : null;
}

/** A delivered donation as the jar page lists it (names and messages are donor-supplied text). */
export interface FeedItem {
  id: string;
  name: string | null;
  message: string | null;
  usdCents: number;
  sourceChain: string;
  sourceSymbol: string;
  at: number;
}

/** Per-jar activity for the creator studio: daily USD for the last `days` days and the networks used. */
export interface JarActivity {
  daily: number[]; // USD cents per day, oldest first
  supporters: number;
}

export async function studioActivity(jarIds: string[], days = 14): Promise<{ jars: Record<string, JarActivity>; networks: string[] }> {
  const jars: Record<string, JarActivity> = {};
  for (const id of jarIds) jars[id] = { daily: Array(days).fill(0), supporters: 0 };
  if (jarIds.length === 0) return { jars, networks: [] };
  const since = Date.now() - days * 86_400_000;
  const marks = jarIds.map(() => "?").join(",");
  const c = await db();
  const rows = await c.execute({
    sql: `SELECT jar_id, COALESCE(delivered_usd_cents, usd_cents) AS usd, updated_at FROM donations
      WHERE status = 'delivered' AND jar_id IN (${marks}) AND updated_at >= ?`,
    args: [...jarIds, since],
  });
  for (const r of rows.rows) {
    const day = Math.min(days - 1, Math.floor((Number(r.updated_at) - since) / 86_400_000));
    const j = jars[String(r.jar_id)];
    if (j) j.daily[day] = (j.daily[day] ?? 0) + Number(r.usd);
  }
  const counts = await c.execute({
    sql: `SELECT jar_id, COUNT(*) AS n FROM donations WHERE status = 'delivered' AND jar_id IN (${marks}) GROUP BY jar_id`,
    args: jarIds,
  });
  for (const r of counts.rows) {
    const j = jars[String(r.jar_id)];
    if (j) j.supporters = Number(r.n);
  }
  const nets = await c.execute({
    sql: `SELECT DISTINCT source_chain FROM donations WHERE status = 'delivered' AND jar_id IN (${marks})`,
    args: jarIds,
  });
  return { jars, networks: nets.rows.map((r) => String(r.source_chain)) };
}

/** Delivered donations of these jars for the accountant's CSV (no refund addresses). */
export async function deliveredFor(jarIds: string[]): Promise<DonationRow[]> {
  if (jarIds.length === 0) return [];
  const r = await (await db()).execute({
    sql: `SELECT * FROM donations WHERE status = 'delivered' AND jar_id IN (${jarIds.map(() => "?").join(",")}) ORDER BY updated_at`,
    args: jarIds,
  });
  return r.rows as unknown as DonationRow[];
}

export async function jarFeed(jarId: string, limit = 20): Promise<FeedItem[]> {
  const r = await (await db()).execute({
    sql: `SELECT id, donor_name, message, COALESCE(delivered_usd_cents, usd_cents) AS usd, source_chain, source_symbol, updated_at
      FROM donations WHERE jar_id = ? AND status = 'delivered' AND hidden = 0 ORDER BY updated_at DESC LIMIT ?`,
    args: [jarId, limit],
  });
  return r.rows.map((x) => ({
    id: String(x.id),
    name: (x.donor_name as string | null) ?? null,
    message: (x.message as string | null) ?? null,
    usdCents: Number(x.usd),
    sourceChain: String(x.source_chain),
    sourceSymbol: String(x.source_symbol),
    at: Number(x.updated_at),
  }));
}

/** Latest delivered donations across the owner's jars, for the studio home. */
export async function recentFor(jarIds: string[], limit = 8): Promise<(FeedItem & { jarId: string })[]> {
  if (jarIds.length === 0) return [];
  const r = await (await db()).execute({
    sql: `SELECT id, jar_id, donor_name, message, COALESCE(delivered_usd_cents, usd_cents) AS usd, source_chain, source_symbol, updated_at
      FROM donations WHERE status = 'delivered' AND jar_id IN (${jarIds.map(() => "?").join(",")}) ORDER BY updated_at DESC LIMIT ?`,
    args: [...jarIds, limit],
  });
  return r.rows.map((x) => ({
    id: String(x.id),
    jarId: String(x.jar_id),
    name: (x.donor_name as string | null) ?? null,
    message: (x.message as string | null) ?? null,
    usdCents: Number(x.usd),
    sourceChain: String(x.source_chain),
    sourceSymbol: String(x.source_symbol),
    at: Number(x.updated_at),
  }));
}

export interface PublicDonation {
  id: string;
  jarId: string;
  status: DonationRow["status"];
  sourceChain: string;
  sourceSymbol: string;
  amountIn: string;
  usdCents: number;
  amountOut: string | null;
  depositAddress: string;
  sourceTx: string | null;
  deliveryTx: string | null;
  recordedTx: string | null;
}

export function toPublic(d: DonationRow): PublicDonation {
  return {
    id: d.id,
    jarId: d.jar_id,
    status: d.status,
    sourceChain: d.source_chain,
    sourceSymbol: d.source_symbol,
    amountIn: d.amount_in,
    usdCents: d.usd_cents,
    amountOut: d.amount_out,
    depositAddress: d.deposit_address,
    sourceTx: d.source_tx,
    deliveryTx: d.delivery_tx,
    recordedTx: d.recorded_tx === "pending" ? null : d.recorded_tx,
  };
}

function clean(v: string | undefined, max: number): string | null {
  const s = (v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return s ? [...s].slice(0, max).join("") : null;
}
