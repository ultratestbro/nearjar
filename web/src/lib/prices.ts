import "server-only";

const ONE_CLICK = process.env.ONE_CLICK_API_URL ?? "https://1click.chaindefuser.com/v0";

type Token = { assetId: string; decimals: number; symbol: string; price: number };

let cache: { at: number; byId: Map<string, Token> } | null = null;

/** USD prices from 1Click's token list, cached for a minute. */
export async function tokenPrices(): Promise<Map<string, Token>> {
  if (cache && Date.now() - cache.at < 60_000) return cache.byId;
  const res = await fetch(`${ONE_CLICK}/tokens`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`1Click tokens ${res.status}`);
  const list = (await res.json()) as Token[];
  cache = { at: Date.now(), byId: new Map(list.map((t) => [t.assetId, t])) };
  return cache.byId;
}

/** USD cents → integer base units of the token, rounded down. */
export function usdToUnits(usdCents: number, price: number, decimals: number): bigint {
  if (!(price > 0)) throw new Error("no price");
  // work in 1e-6 USD to keep precision for cheap tokens
  const microUsd = BigInt(usdCents) * 10_000n;
  const priceMicro = BigInt(Math.round(price * 1e6));
  return (microUsd * 10n ** BigInt(decimals)) / priceMicro;
}
