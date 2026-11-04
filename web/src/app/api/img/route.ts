import { IMAGE_MAX_BYTES, saveImage, sniffImage } from "@/lib/pages";

// per-instance throttle: 30 uploads per IP per 10 minutes
const hits = new Map<string, number[]>();
function throttled(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 600_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 30;
}

/**
 * POST <image bytes> — a cover or avatar the editor already resized. JPEG, PNG or WebP by its own
 * bytes, up to 700 KB. → { ok, hash }: the sha256 the jar page refers to.
 */
export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (throttled(ip)) return Response.json({ ok: false, error: "Too many uploads, try again later." }, { status: 429 });
  if (Number(request.headers.get("content-length") ?? 0) > IMAGE_MAX_BYTES)
    return Response.json({ ok: false, error: "Image is too large." }, { status: 413 });

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length === 0 || bytes.length > IMAGE_MAX_BYTES) return Response.json({ ok: false, error: "Image is too large." }, { status: 413 });
  const mime = sniffImage(bytes);
  if (!mime) return Response.json({ ok: false, error: "Use a JPG, PNG or WebP image." }, { status: 415 });
  const hash = await saveImage(bytes, mime).catch(() => null);
  if (!hash) return Response.json({ ok: false, error: "Could not store the image." }, { status: 502 });
  return Response.json({ ok: true, hash });
}
