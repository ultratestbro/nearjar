import { daoPayoutRefusal } from "@/lib/dao";
import { isDaoId } from "@/lib/daoPolicy";
import { getJar, getJarsByOwner } from "@/lib/jars";
import { relayCall } from "@/lib/near";
import { parseNearComAccount } from "@/lib/nearcom";
import { parsePage } from "@/lib/pageData";
import { pageFingerprint, savePage } from "@/lib/pages";
import { parseSignedAction, SIGNED_STANDARDS, type SignedAction } from "@/lib/signedPayload";

const STANDARDS = new Set<string>(SIGNED_STANDARDS);

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
 * POST { signed, page? } — a MultiPayload signed by the jar owner. The relayer submits it; the
 * contract verifies the signature and asks intents.near whether the key is the owner's. `page`
 * is stored for the jar only when the signed text carries its fingerprint (the contract keeps the
 * fingerprint too, and pages are shown only when they match it). A DAO payout is checked here,
 * before the relayer pays: the contract only knows the id's shape.
 * → { ok, jarId, txHash, pageError? }
 */
export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (throttled(ip)) return Response.json({ ok: false, error: "Too many requests, try again later." }, { status: 429 });

  const body = (await request.json().catch(() => ({}))) as { signed?: { standard?: string }; page?: unknown };
  const signed = body.signed;
  if (!signed || !STANDARDS.has(String(signed.standard))) {
    return Response.json({ ok: false, error: "Missing or unsupported signature." }, { status: 400 });
  }
  const signedText = JSON.stringify(signed);
  if (signedText.length > 8_000) return Response.json({ ok: false, error: "Payload too large." }, { status: 413 });

  let page = null;
  let hash = "";
  if (body.page !== undefined && body.page !== null) {
    const parsed = parsePage(body.page);
    if (!parsed.ok) return Response.json(parsed, { status: 400 });
    page = parsed.page;
    hash = pageFingerprint(page);
    // the signature covers the whole text; a page whose fingerprint isn't in it was not signed
    if (!signedText.includes(`sha256:${hash}`)) return Response.json({ ok: false, error: "The page changed after signing. Publish again." }, { status: 400 });
  }

  const read = parseSignedAction(signed);
  if (!read.ok) return Response.json(read, { status: 400 });
  const refusal = await payoutRefusal(read.value);
  if (refusal) return Response.json({ ok: false, error: refusal.error }, { status: refusal.status });

  const res = await relayCall<string>("submit", { signed }, 100);
  if (!res.ok) return Response.json({ ok: false, error: res.error, txHash: res.txHash }, { status: 422 });
  if (read.value.action === "create_jar" && isDaoId(read.value.payout)) {
    // a contract without DAO payouts ignores the field and pays the signer: say so, don't hide it
    const jar = await getJar(res.value).catch(() => null);
    if (jar && jar.payout !== read.value.payout) {
      return Response.json(
        { ok: false, jarId: res.value, txHash: res.txHash, error: "The jar was created without the DAO payout: it pays your own near.com balance. Close it in the studio." },
        { status: 500 },
      );
    }
  }
  if (!page) return Response.json({ ok: true, jarId: res.value, txHash: res.txHash });
  const saved = await savePage(res.value, page, hash, res.txHash).then(
    () => true,
    () => false,
  );
  if (!saved) return Response.json({ ok: true, jarId: res.value, txHash: res.txHash, pageError: "The jar is saved, but its page was not. Publish again." });
  return Response.json({ ok: true, jarId: res.value, txHash: res.txHash });
}

/**
 * The same checks as /api/jars/prepare, on what was actually signed (the client may skip prepare):
 * a new jar's DAO must exist, list the signer and be able to spend; an update must sign the
 * payout the jar already has. Any lookup failure refuses.
 */
async function payoutRefusal(a: SignedAction): Promise<{ error: string; status: number } | null> {
  const signed = a.payout ?? null; // the contract reads an absent or null payout as none
  if (a.action === "create_jar") {
    if (signed === null) return null;
    if (!isDaoId(signed)) return { error: "payout must be a Sputnik DAO: name.sputnik-dao.near.", status: 400 };
    return daoPayoutRefusal(signed, a.signerId);
  }
  if (a.action === "update_jar") {
    if (!a.jarId || !/^\d{1,19}$/.test(a.jarId)) return { error: "Bad jar id.", status: 400 };
    const jar = await getJar(a.jarId).catch(() => undefined);
    if (jar === undefined) return { error: "Could not read the contract.", status: 502 };
    if (!jar) return { error: "Jar not found.", status: 404 };
    if (signed !== jar.payout) return { error: "A jar's payout can't change. Publish again.", status: 400 };
  }
  return null;
}

/** GET ?owner=<near.com account> → that owner's jars, straight from the contract. */
export async function GET(request: Request) {
  const owner = parseNearComAccount(new URL(request.url).searchParams.get("owner") ?? "");
  if (!owner.ok) return Response.json({ ok: false, error: owner.error }, { status: 400 });
  const jars = await getJarsByOwner(owner.id).catch(() => null);
  if (!jars) return Response.json({ ok: false, error: "Could not read the contract." }, { status: 502 });
  return Response.json({ ok: true, jars });
}
