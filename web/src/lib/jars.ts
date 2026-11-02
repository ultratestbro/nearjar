import "server-only";

export interface Jar {
  id: string;
  owner: string; // near.com (intents.near) account
  title: string;
  description: string;
  image_url: string | null;
  goal_usd_cents: string | null;
  ends_at: string | null;
  receive_asset: string;
  status: "Open" | "Closed";
  created_at: string;
  raised_usd_cents: string;
  donations_count: string;
}

export const NEARJAR_CONTRACT = process.env.NEARJAR_CONTRACT ?? "nearjar.near";
const RPC = process.env.NEAR_RPC_URL ?? "https://rpc.mainnet.near.org";

async function view<T>(contract: string, method: string, args: unknown): Promise<T> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "nearjar",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
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

/**
 * Until the contract is deployed, NEARJAR_DEMO_OWNER serves one demo jar (id "demo") paying
 * that near.com account, so the donor flow can be tried end to end.
 */
function demoJar(): Jar | null {
  const owner = process.env.NEARJAR_DEMO_OWNER;
  if (!owner) return null;
  return {
    id: "demo",
    owner,
    title: "NearJar demo jar",
    description: "A demo jar. Donations land in this near.com account.",
    image_url: null,
    goal_usd_cents: "10000",
    ends_at: null,
    receive_asset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    status: "Open",
    created_at: "0",
    raised_usd_cents: "0",
    donations_count: "0",
  };
}

export async function getJar(id: string): Promise<Jar | null> {
  if (id === "demo") return demoJar();
  if (!/^\d{1,19}$/.test(id)) return null;
  return view<Jar | null>(NEARJAR_CONTRACT, "get_jar", { jar_id: id });
}
