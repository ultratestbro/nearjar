import { studioActivity } from "@/lib/donations";
import { getJarsByOwner } from "@/lib/jars";
import { parseNearComAccount } from "@/lib/nearcom";

/** GET ?owner= → the owner's jars from the contract plus 14-day activity from delivered donations. */
export async function GET(request: Request) {
  const owner = parseNearComAccount(new URL(request.url).searchParams.get("owner") ?? "");
  if (!owner.ok) return Response.json({ ok: false, error: owner.error }, { status: 400 });
  const jars = await getJarsByOwner(owner.id).catch(() => null);
  if (!jars) return Response.json({ ok: false, error: "Could not read the contract." }, { status: 502 });
  const activity = await studioActivity(jars.map((j) => j.id)).catch(() => ({ jars: {}, networks: [] as string[] }));
  return Response.json({ ok: true, jars, activity });
}
