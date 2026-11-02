import { getJar } from "@/lib/jars";
import { quoteDonation } from "@/lib/quote";

/**
 * POST { jarId, usdCents, sourceChain, sourceSymbol, refundAddress?, dry? }
 * Dry quotes (default) price a donation without creating a deposit address.
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "Bad JSON." }, { status: 400 });
  }
  const jarId = String(body.jarId ?? "");
  const jar = await getJar(jarId).catch(() => null);
  if (!jar) return Response.json({ ok: false, error: "Jar not found." }, { status: 404 });

  const result = await quoteDonation({
    jar,
    usdCents: Number(body.usdCents),
    sourceChain: String(body.sourceChain ?? ""),
    sourceSymbol: String(body.sourceSymbol ?? ""),
    ...(typeof body.refundAddress === "string" && body.refundAddress ? { refundAddress: body.refundAddress } : {}),
    dry: body.dry !== false,
  }).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "Quote failed." }));

  return Response.json(result, { status: result.ok ? 200 : 422 });
}
