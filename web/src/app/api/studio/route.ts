import { recentFor, studioActivity } from "@/lib/donations";
import { getJarsByOwner, NEARJAR_CONTRACT } from "@/lib/jars";
import { parseNearComAccount } from "@/lib/nearcom";
import { getPages, trustedPage, type StoredPage } from "@/lib/pages";

/**
 * GET ?owner= → the owner's jars from the contract, their pages, 14-day activity, the latest
 * delivered donations and the contract id (a DAO endorses its jar with a call to it).
 */
export async function GET(request: Request) {
  const owner = parseNearComAccount(new URL(request.url).searchParams.get("owner") ?? "");
  if (!owner.ok) return Response.json({ ok: false, error: owner.error }, { status: 400 });
  const jars = await getJarsByOwner(owner.id).catch(() => null);
  if (!jars) return Response.json({ ok: false, error: "Could not read the contract." }, { status: 502 });
  const ids = jars.map((j) => j.id);
  const [activity, pages, recent] = await Promise.all([
    studioActivity(ids).catch(() => ({ jars: {}, networks: [] as string[] })),
    getPages(ids).catch((): Record<string, StoredPage> => ({})),
    recentFor(ids).catch(() => []),
  ]);
  // the owner edits what donors see: only pages that match the fingerprint signed on chain
  const pageOf = Object.fromEntries(jars.map((j) => [j.id, trustedPage(j, pages[j.id] ?? null)]));
  return Response.json({ ok: true, jars, activity, pages: pageOf, recent, contract: NEARJAR_CONTRACT });
}
