import "server-only";

import { SOURCE_ASSETS, type SourceAsset } from "./assets";
import { tokenPrices } from "./prices";

/** A donor's holding of one payable token, in base units, with its USD value when 1Click prices it. */
export interface Balance {
  chain: string;
  symbol: string;
  amount: string;
  usd: number | null;
}

export type BalanceFamily = "evm" | "solana" | "near";

// keyless public endpoints: balances are a convenience, a slow or missing chain just shows no balance
// (RPC_URLS can put a keyed endpoint in front of each, see rpcAt)
const EVM_RPC: Record<string, string> = {
  "eip155:1": "https://ethereum-rpc.publicnode.com",
  "eip155:8453": "https://base-rpc.publicnode.com",
  "eip155:42161": "https://arbitrum-one-rpc.publicnode.com",
  "eip155:10": "https://optimism-rpc.publicnode.com",
  "eip155:56": "https://bsc-rpc.publicnode.com",
  "eip155:137": "https://polygon-bor-rpc.publicnode.com",
  "eip155:100": "https://gnosis-rpc.publicnode.com",
  "eip155:143": "https://rpc.monad.xyz",
  "eip155:43114": "https://avalanche-c-chain-rpc.publicnode.com",
  "eip155:534352": "https://scroll-rpc.publicnode.com",
  "eip155:80094": "https://berachain-rpc.publicnode.com",
  "eip155:9745": "https://rpc.plasma.to",
};
const SOLANA_RPC = () => process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
// donors pay on mainnet whatever network the jar contract runs on
const NEAR_RPC = "https://free.rpc.fastnear.com";

/** Keyed endpoints by CAIP-2 chain ("eip155:8453", "near:mainnet"): RPC_URLS, a JSON object, server-side only. */
function keyedRpc(chain: string): string | undefined {
  try {
    const url = (JSON.parse(process.env.RPC_URLS ?? "{}") as Record<string, unknown>)[chain];
    return typeof url === "string" && url.startsWith("https://") ? url : undefined;
  } catch {
    return undefined;
  }
}

export const ADDRESS: Record<BalanceFamily, RegExp> = {
  evm: /^0x[0-9a-fA-F]{40}$/,
  solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  near: /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$|^[0-9a-f]{64}$/,
};

export async function balancesOf(family: BalanceFamily, address: string): Promise<Balance[]> {
  const raw = family === "evm" ? await evm(address) : family === "solana" ? await solana(address) : await near(address);
  const prices = await tokenPrices().catch(() => null);
  return raw
    .filter((b) => b.amount !== "0")
    .map(({ asset, amount }) => {
      const p = prices?.get(asset.assetId)?.price;
      return {
        chain: asset.chain,
        symbol: asset.symbol,
        amount,
        usd: p ? (Number(amount) / 10 ** asset.decimals) * p : null,
      };
    });
}

type Raw = { asset: SourceAsset; amount: string };

async function rpc(url: string, calls: { method: string; params: unknown }[]): Promise<unknown[]> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // a lone call goes unbatched: some endpoints (fastnear) refuse batches
    body: JSON.stringify(calls.length === 1 ? { jsonrpc: "2.0", id: 0, ...calls[0] } : calls.map((c, id) => ({ jsonrpc: "2.0", id, ...c }))),
    signal: AbortSignal.timeout(6_000),
  });
  if (!res.ok) throw new Error(`rpc ${res.status}`);
  const body = (await res.json()) as { id: number; result?: unknown } | { id: number; result?: unknown }[];
  const out = Array.isArray(body) ? body : [body];
  const byId = new Map(out.map((r) => [r.id, r.result]));
  return calls.map((_, i) => byId.get(i));
}

/** The chain's keyed endpoint when one is set, the public one when it is not or fails. */
async function rpcAt(chain: string, publicUrl: string, calls: { method: string; params: unknown }[]): Promise<unknown[]> {
  const keyed = keyedRpc(chain);
  if (keyed) {
    try {
      return await rpc(keyed, calls);
    } catch {
      // the public node next
    }
  }
  return rpc(publicUrl, calls);
}

async function evm(address: string): Promise<Raw[]> {
  const owner = address.slice(2).toLowerCase().padStart(64, "0");
  const chains = await Promise.all(
    Object.entries(EVM_RPC).map(async ([chain, url]) => {
      const assets = SOURCE_ASSETS.filter((a) => a.chain === chain);
      const results = await rpcAt(
        chain,
        url,
        assets.map((a) =>
          a.contract
            ? { method: "eth_call", params: [{ to: a.contract, data: `0x70a08231${owner}` }, "latest"] }
            : { method: "eth_getBalance", params: [address, "latest"] },
        ),
      ).catch(() => []);
      return assets.map((asset, i) => ({ asset, amount: hexAmount(results[i]) }));
    }),
  );
  return chains.flat();
}

function hexAmount(v: unknown): string {
  return typeof v === "string" && /^0x[0-9a-f]+$/i.test(v) && v !== "0x" ? BigInt(v).toString() : "0";
}

async function solana(address: string): Promise<Raw[]> {
  const assets = SOURCE_ASSETS.filter((a) => a.chain === "solana:mainnet");
  const results = await rpc(
    SOLANA_RPC(),
    assets.map((a) =>
      a.contract
        ? { method: "getTokenAccountsByOwner", params: [address, { mint: a.contract }, { encoding: "jsonParsed" }] }
        : { method: "getBalance", params: [address] },
    ),
  ).catch(() => []);
  return assets.map((asset, i) => {
    const r = results[i] as
      | { value?: number | { account: { data: { parsed: { info: { tokenAmount: { amount: string } } } } } }[] }
      | undefined;
    const v = r?.value;
    const amount =
      typeof v === "number"
        ? BigInt(v)
        : Array.isArray(v)
          ? v.reduce((s, t) => s + BigInt(t.account.data.parsed.info.tokenAmount.amount), 0n)
          : 0n;
    return { asset, amount: amount.toString() };
  });
}

async function near(account: string): Promise<Raw[]> {
  const assets = SOURCE_ASSETS.filter((a) => a.chain === "near:mainnet");
  const args = Buffer.from(JSON.stringify({ account_id: account })).toString("base64");
  return Promise.all(
    assets.map(async (asset) => {
      const [r] = await rpcAt("near:mainnet", NEAR_RPC, [
        asset.contract
          ? { method: "query", params: { request_type: "call_function", finality: "final", account_id: asset.contract, method_name: "ft_balance_of", args_base64: args } }
          : { method: "query", params: { request_type: "view_account", finality: "final", account_id: account } },
      ]).catch(() => [undefined]);
      const v = r as { amount?: string; result?: number[] } | undefined;
      let amount = "0";
      if (v?.amount) amount = v.amount;
      else if (v?.result) {
        const s = JSON.parse(Buffer.from(v.result).toString()) as unknown;
        if (typeof s === "string" && /^\d+$/.test(s)) amount = s;
      }
      return { asset, amount };
    }),
  );
}
