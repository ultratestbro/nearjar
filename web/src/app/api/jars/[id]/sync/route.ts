import { refreshPending } from "@/lib/donations";

/** POST → refreshes the jar's open donations from 1Click; the jar page reloads when any changed. */
export async function POST(_request: Request, ctx: RouteContext<"/api/jars/[id]/sync">) {
  const { id } = await ctx.params;
  if (!/^\d{1,19}$/.test(id)) return Response.json({ ok: false, error: "Not found." }, { status: 404 });
  const changed = await refreshPending(id).catch(() => 0);
  return Response.json({ ok: true, changed });
}
