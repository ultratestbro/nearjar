import { slugAvailable } from "@/lib/jars";
import { RESERVED_SLUGS, SLUG } from "@/lib/pageData";

/** GET ?s=<short link>&jar=<id being edited> → { ok, available }, asked of the contract. */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const slug = (q.get("s") ?? "").trim().toLowerCase();
  if (!SLUG.test(slug)) return Response.json({ ok: true, available: false, error: "3–40 letters, digits or dashes." });
  if (RESERVED_SLUGS.includes(slug)) return Response.json({ ok: true, available: false, error: "Reserved." });
  const jar = q.get("jar") ?? undefined;
  const available = await slugAvailable(slug, jar).catch(() => null);
  if (available === null) return Response.json({ ok: false, error: "Could not check." }, { status: 502 });
  return Response.json({ ok: true, available });
}
