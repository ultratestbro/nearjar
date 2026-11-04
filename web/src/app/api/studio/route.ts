import { recentFor, studioActivity } from "@/lib/donations";
import { getJarsByOwner } from "@/lib/jars";
import { parseNearComAccount } from "@/lib/nearcom";
import { getPages } from "@/lib/pages";

/**
 * GET ?owner= → the owner's jars from the contract, their pages, 14-day activity and the latest
 * delivered donations.
 */
export async function GET(request: Request) {
  const owner = parseNearComAccount(new URL(request.url).searchParams.get("owner") ?? "");
  if (!owner.ok) return Response.json({ ok: false, error: owner.error }, { status: 400 });
  const jars = await getJarsByOwner(owner.id).catch(() => null);
  if (!jars) return Response.json({ ok: false, error: "Could not read the contract." }, { status: 502 });
  const ids = jars.map((j) => j.id);
  const [activity, pages, recent] = await Promise.all([
    studioActivity(ids).catch(() => ({ jars: {}, networks: [] as string[] })),
    getPages(ids).catch(() => ({})),
    recentFor(ids).catch(() => []),
  ]);
  const pageOf = Object.fromEntries(Object.entries(pages).map(([id, p]) => [id, p.page]));
  return Response.json({ ok: true, jars, activity, pages: pageOf, recent });
}
