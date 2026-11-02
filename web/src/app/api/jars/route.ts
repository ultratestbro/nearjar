import { relayCall } from "@/lib/near";

const STANDARDS = new Set(["erc191", "raw_ed25519", "nep413", "ton_connect", "tip191", "sep53", "webauthn"]);

// Simple per-instance throttle until the database lands: 10 submissions per IP per 10 minutes.
const hits = new Map<string, number[]>();
function throttled(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 600_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 10;
}

/**
 * POST { signed } — a MultiPayload signed by the jar owner. The relayer submits it; the
 * contract verifies the signature and asks intents.near whether the key is the owner's.
 * → { ok, jarId, txHash }
 */
export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (throttled(ip)) return Response.json({ ok: false, error: "Too many requests, try again later." }, { status: 429 });

  const body = (await request.json().catch(() => ({}))) as { signed?: { standard?: string } };
  const signed = body.signed;
  if (!signed || !STANDARDS.has(String(signed.standard))) {
    return Response.json({ ok: false, error: "Missing or unsupported signature." }, { status: 400 });
  }
  if (JSON.stringify(signed).length > 8_000) return Response.json({ ok: false, error: "Payload too large." }, { status: 413 });

  const res = await relayCall<string>("submit", { signed }, 100);
  if (!res.ok) return Response.json({ ok: false, error: res.error, txHash: res.txHash }, { status: 422 });
  return Response.json({ ok: true, jarId: res.value, txHash: res.txHash });
}
