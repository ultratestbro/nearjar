import { createDonation } from "@/lib/donations";
import { getJar } from "@/lib/jars";

/**
 * POST { jarId, usdCents, sourceChain, sourceSymbol, refundAddress, method?, name?, message? }
 * Live 1Click quote crediting the jar owner's near.com account → a one-time deposit address
 * and the exact amount the donor's wallet sends.
 */
export async function POST(request: Request) {
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const jar = await getJar(String(b.jarId ?? "")).catch(() => null);
  if (!jar) return Response.json({ ok: false, error: "Jar not found." }, { status: 404 });
  const method = b.method === "Manual" ? "Manual" : "Wallet";
  const res = await createDonation({
    jar,
    method,
    usdCents: Number(b.usdCents),
    sourceChain: String(b.sourceChain ?? ""),
    sourceSymbol: String(b.sourceSymbol ?? ""),
    refundAddress: String(b.refundAddress ?? "").trim(),
    ...(typeof b.name === "string" ? { name: b.name } : {}),
    ...(typeof b.message === "string" ? { message: b.message } : {}),
  }).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "Could not start the donation." }));
  return Response.json(res, { status: res.ok ? 200 : 422 });
}
