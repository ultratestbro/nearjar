import { CC_SOURCE_CHAINS } from "@anywalletkit/swap2-assets";

/** What a jar owner can receive into their near.com balance (intents.near token ids). */
export const RECEIVE_ASSETS = [
  { id: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", symbol: "USDC", decimals: 6 },
  { id: "nep141:usdt.tether-token.near", symbol: "USDT", decimals: 6 },
  { id: "nep141:wrap.near", symbol: "NEAR", decimals: 24 },
  { id: "nep141:btc.omft.near", symbol: "BTC", decimals: 8 },
  { id: "nep141:eth.omft.near", symbol: "ETH", decimals: 18 },
] as const;

export type ReceiveAsset = (typeof RECEIVE_ASSETS)[number];

export function receiveAsset(id: string): ReceiveAsset | undefined {
  return RECEIVE_ASSETS.find((a) => a.id === id);
}

export interface SourceAsset {
  chain: string; // caip2
  chainLabel: string;
  chainIcon: string;
  symbol: string;
  assetId: string; // 1Click / intents.near id
  contract: string | null; // token contract / mint / jetton master; null = native
  decimals: number;
  icon: string;
}

/** Every chain/token a donor can pay with: the SDK catalog entries 1Click lists. */
export const SOURCE_ASSETS: SourceAsset[] = CC_SOURCE_CHAINS.flatMap((c) =>
  c.assets
    .filter((a) => a.assetId)
    .map((a) => ({
      chain: c.caip2,
      chainLabel: c.label,
      chainIcon: c.icon ?? "",
      symbol: a.symbol,
      assetId: a.assetId,
      contract: a.contract ?? null,
      decimals: a.decimals,
      icon: a.icon ?? c.icon ?? "",
    })),
);

export function sourceAsset(chain: string, symbol: string): SourceAsset | undefined {
  return SOURCE_ASSETS.find((a) => a.chain === chain && a.symbol === symbol);
}

/** Logo for an intents token id, taken from the SDK catalog entry that carries it. */
export function assetIcon(assetId: string): string {
  return SOURCE_ASSETS.find((a) => a.assetId === assetId)?.icon ?? "";
}
