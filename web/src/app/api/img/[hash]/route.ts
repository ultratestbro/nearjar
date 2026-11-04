import { getImage } from "@/lib/pages";

/** GET → the stored image. Content-addressed, so it never changes and caches forever. */
export async function GET(_request: Request, ctx: RouteContext<"/api/img/[hash]">) {
  const { hash } = await ctx.params;
  if (!/^[0-9a-f]{64}$/.test(hash)) return new Response("Not found", { status: 404 });
  const img = await getImage(hash).catch(() => null);
  if (!img) return new Response("Not found", { status: 404 });
  return new Response(img.bytes as BodyInit, {
    headers: {
      "content-type": img.mime,
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'",
    },
  });
}
