import { markSubmitted } from "@/lib/donations";

/** POST { txHash } — the donor's wallet broadcast the deposit. */
export async function POST(request: Request, ctx: RouteContext<"/api/donations/[id]/submitted">) {
  const { id } = await ctx.params;
  const b = (await request.json().catch(() => ({}))) as { txHash?: unknown };
  const txHash = typeof b.txHash === "string" ? b.txHash.trim() : "";
  if (!/^[0-9a-f-]{36}$/.test(id) || !/^[A-Za-z0-9_:+/=-]{16,200}$/.test(txHash)) {
    return Response.json({ ok: false, error: "Bad request." }, { status: 400 });
  }
  await markSubmitted(id, txHash);
  return Response.json({ ok: true });
}
