import "server-only";

import { nearIntentsProvider } from "@anywalletkit/protocol-swap2-near-intents";
import { sourceAsset } from "./assets";
import type { Jar } from "./jars";
import { tokenPrices, usdToUnits } from "./prices";

/**
 * near.com keeps funds in the Confidential Intents balance. With a 1Click partner JWT donations are
 * credited there directly; without one they land in the public intents.near balance, which near.com
 * shows as "legacy" until the owner moves it.
 */
export const CONFIDENTIAL_DELIVERY = !!process.env.ONE_CLICK_JWT;

/** Any Wallet Kit's NEAR Intents provider, crediting the jar owner's near.com account. */
export const toNearCom = nearIntentsProvider({
  recipientType: CONFIDENTIAL_DELIVERY ? "CONFIDENTIAL_INTENTS" : "INTENTS",
  ...(process.env.ONE_CLICK_API_URL ? { apiUrl: process.env.ONE_CLICK_API_URL } : {}),
  ...(process.env.ONE_CLICK_JWT ? { jwt: process.env.ONE_CLICK_JWT } : {}),
});

export const MIN_DONATION_CENTS = 100;
export const MAX_DONATION_CENTS = 1_000_000;

export interface DonationQuote {
  dry: boolean;
  amountIn: string; // base units of the source token
  amountInFormatted: string;
  amountOut: string; // base units of the jar's receive asset
  minAmountOut: string;
  feeUsd: number;
  etaSeconds: number;
  depositAddress: string;
  depositMemo: string | null;
  intentId: string;
  validUntilMs: number;
}

export type QuoteResult = { ok: true; quote: DonationQuote } | { ok: false; error: string };

export async function quoteDonation(input: {
  jar: Jar;
  usdCents: number;
  sourceChain: string;
  sourceSymbol: string;
  refundAddress?: string;
  dry: boolean;
}): Promise<QuoteResult> {
  const { jar, usdCents } = input;
  if (jar.status !== "Open") return { ok: false, error: "This jar is closed." };
  if (!Number.isInteger(usdCents) || usdCents < MIN_DONATION_CENTS || usdCents > MAX_DONATION_CENTS) {
    return { ok: false, error: "Amount must be between $1 and $10,000." };
  }
  const src = sourceAsset(input.sourceChain, input.sourceSymbol);
  if (!src) return { ok: false, error: "Unsupported token." };
  if (!input.dry && !input.refundAddress) return { ok: false, error: "A refund address is required." };

  const price = (await tokenPrices()).get(src.assetId)?.price;
  if (!price) return { ok: false, error: `No price for ${src.symbol} right now.` };
  const amountIn = usdToUnits(usdCents, price, src.decimals);

  let refusal = "";
  const q = await toNearCom.getQuote({
    sourceChain: src.chain,
    sourceToken: src.symbol,
    destChain: "near:mainnet",
    destToken: jar.receive_asset,
    destAddress: jar.owner,
    amountIn: amountIn.toString(),
    ...(input.refundAddress ? { refundAddress: input.refundAddress } : {}),
    dry: input.dry,
    onRefusal: (r: string) => {
      refusal = r;
    },
  });
  if (!q) return { ok: false, error: friendly(refusal) };
  return {
    ok: true,
    quote: {
      dry: input.dry,
      amountIn: q.sourceAmount,
      amountInFormatted: formatUnits(BigInt(q.sourceAmount), src.decimals),
      amountOut: q.destAmount,
      minAmountOut: q.minDestAmount,
      feeUsd: q.feeUsd,
      etaSeconds: q.etaSeconds,
      depositAddress: q.depositAddress,
      depositMemo: q.depositMemo ?? null,
      intentId: q.intentId,
      validUntilMs: q.validUntilMs,
    },
  };
}

function friendly(refusal: string): string {
  if (/refundTo is not valid/i.test(refusal)) return "That refund address doesn't look right for this network.";
  if (/1Click 5\d\d|network error|threw/i.test(refusal)) return "NEAR Intents is not answering right now. Try again in a minute.";
  if (/does not list|paused/i.test(refusal)) return "This token can't be routed right now.";
  if (/no liquidity|amount is too low|too small/i.test(refusal)) return "No route for this amount. Try a larger one.";
  return "No route right now.";
}

export function formatUnits(v: bigint, decimals: number, maxFrac = 6): string {
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}
