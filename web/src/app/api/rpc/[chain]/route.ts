/**
 * Read-mostly JSON-RPC proxy for donor wallets in the browser: keeps provider keys server-side and
 * allows only the methods the transfer builders need. Wallets broadcast transactions themselves.
 */
const UPSTREAM: Record<string, { url: () => string | undefined; methods: Set<string> }> = {
  solana: {
    url: () => process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com",
    methods: new Set([
      "getLatestBlockhash", "getAccountInfo", "getMultipleAccounts", "getBalance", "getTokenAccountBalance",
      "getMinimumBalanceForRentExemption", "simulateTransaction", "getFeeForMessage", "getRecentPrioritizationFees",
      "getSignatureStatuses", "getEpochInfo", "getSlot",
    ]),
  },
};

export async function POST(request: Request, ctx: RouteContext<"/api/rpc/[chain]">) {
  const { chain } = await ctx.params;
  const up = UPSTREAM[chain];
  const url = up?.url();
  if (!up || !url) return Response.json({ error: "unknown chain" }, { status: 404 });
  const text = await request.text();
  if (text.length > 200_000) return Response.json({ error: "too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const calls = Array.isArray(body) ? body : [body];
  if (calls.length > 10 || !calls.every((c) => up.methods.has(String((c as { method?: unknown })?.method)))) {
    return Response.json({ error: "method not allowed" }, { status: 403 });
  }
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: text, signal: AbortSignal.timeout(15_000) });
  return new Response(res.body, { status: res.status, headers: { "content-type": "application/json" } });
}
