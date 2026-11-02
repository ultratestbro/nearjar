import { refreshDonation, toPublic } from "@/lib/donations";

/** GET → the donation's current status, refreshed from 1Click (and recorded on chain once delivered). */
export async function GET(_request: Request, ctx: RouteContext<"/api/donations/[id]">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return Response.json({ ok: false, error: "Not found." }, { status: 404 });
  const d = await refreshDonation(id);
  if (!d) return Response.json({ ok: false, error: "Not found." }, { status: 404 });
  return Response.json({ ok: true, donation: toPublic(d) });
}
