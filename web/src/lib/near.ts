import "server-only";

import { Account, getTransactionLastResult, type KeyPairString } from "near-api-js-v7";

export const NEARJAR_CONTRACT = process.env.NEARJAR_CONTRACT ?? "nearjar.near";
export const NEAR_NETWORK = process.env.NEARJAR_NETWORK === "testnet" ? "testnet" : "mainnet";
export const NEAR_RPC = process.env.NEAR_RPC_URL ?? `https://rpc.${NEAR_NETWORK}.near.org`;

export async function view<T>(method: string, args: unknown, contract = NEARJAR_CONTRACT): Promise<T> {
  const res = await fetch(NEAR_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "nearjar",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "optimistic",
        account_id: contract,
        method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json()) as { result?: { result: number[] }; error?: unknown };
  if (!body.result) throw new Error(`view ${method} failed: ${JSON.stringify(body.error).slice(0, 200)}`);
  return JSON.parse(Buffer.from(body.result.result).toString()) as T;
}

let relayer: Account | null = null;

function relayerAccount(): Account {
  if (relayer) return relayer;
  const id = process.env.RELAYER_ACCOUNT_ID;
  const key = process.env.RELAYER_PRIVATE_KEY;
  if (!id || !key) throw new Error("relayer is not configured");
  relayer = new Account(id, NEAR_RPC, key as KeyPairString);
  return relayer;
}

export type RelayResult<T> = { ok: true; value: T; txHash: string } | { ok: false; error: string; txHash?: string };

/**
 * The relayer calls NearJar and waits until every receipt ran, so a cross-contract
 * callback's return value (e.g. the new jar id) comes back as the result.
 */
export async function relayCall<T>(methodName: string, args: object, gasTera: number): Promise<RelayResult<T>> {
  let outcome;
  try {
    outcome = await relayerAccount().callFunctionRaw({
      contractId: NEARJAR_CONTRACT,
      methodName,
      args,
      gas: BigInt(gasTera) * 10n ** 12n,
      waitUntil: "EXECUTED_OPTIMISTIC",
    });
  } catch (e) {
    return { ok: false, error: panicMessage(e) };
  }
  const txHash = outcome.transaction?.hash ?? outcome.transaction_outcome?.id ?? "";
  const failure = findFailure(outcome);
  if (failure) return { ok: false, error: failure, txHash };
  return { ok: true, value: getTransactionLastResult(outcome) as T, txHash };
}

/** First failed receipt's panic text, if any receipt in the tree failed. */
function findFailure(outcome: unknown): string | null {
  const o = outcome as {
    status?: unknown;
    receipts_outcome?: { outcome: { status: unknown } }[];
  };
  for (const r of o.receipts_outcome ?? []) {
    const status = r.outcome.status as { Failure?: unknown };
    if (status && typeof status === "object" && "Failure" in status) return panicMessage(status.Failure);
  }
  const top = o.status as { Failure?: unknown } | undefined;
  if (top && typeof top === "object" && "Failure" in top) return panicMessage(top.Failure);
  return null;
}

function panicMessage(e: unknown): string {
  const text = e instanceof Error ? e.message : JSON.stringify(e);
  const m = /Smart contract panicked: ([^"\\]+)/.exec(text) ?? /panic_msg[":\s\\]+([^"\\]+)/.exec(text);
  return (m?.[1] ?? text).slice(0, 200);
}
