import { daoPayoutRefusal } from "@/lib/dao";
import { parseDaoId } from "@/lib/daoPolicy";
import { envelope, parseJarInput, type JarAction } from "@/lib/jarActions";
import { getJar, slugAvailable } from "@/lib/jars";
import { parseNearComAccount } from "@/lib/nearcom";
import { NEARJAR_CONTRACT } from "@/lib/near";

/**
 * POST { signerId, action: "create_jar" | "update_jar" | "close_jar", jar?, jarId?, standard? }
 * → { message, nonce, recipient, payout }: the text the owner's wallet signs. Nothing is stored.
 * A new jar may name a Sputnik DAO in `jar.payout`; an update always signs the jar's on-chain one.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  // refuse an account NEAR Intents can't credit before the owner signs anything
  const account = parseNearComAccount(String(body.signerId ?? ""));
  if (!account.ok) return Response.json({ ok: false, error: account.error }, { status: 400 });
  const signerId = account.id;

  let action: JarAction;
  if (body.action === "close_jar") {
    action = { action: "close_jar", jar_id: String(body.jarId ?? "") };
  } else {
    const parsed = parseJarInput(body.jar);
    if (!parsed.ok) return Response.json(parsed, { status: 400 });
    action =
      body.action === "update_jar"
        ? { action: "update_jar", jar_id: String(body.jarId ?? ""), jar: parsed.jar, payout: null }
        : { action: "create_jar", jar: parsed.jar, payout: null };
  }
  if ("jar_id" in action && !/^\d{1,19}$/.test(action.jar_id)) {
    return Response.json({ ok: false, error: "Bad jar id." }, { status: 400 });
  }
  // the contract refuses a taken link; say so before the owner signs
  if ("jar" in action && action.jar.slug) {
    const free = await slugAvailable(action.jar.slug, "jar_id" in action ? action.jar_id : undefined).catch(() => null);
    if (free === null) return Response.json({ ok: false, error: "Could not check the short link. Try again." }, { status: 502 });
    if (!free) return Response.json({ ok: false, error: "That short link is taken." }, { status: 409 });
  }

  if (action.action === "create_jar") {
    const raw = (body.jar as Record<string, unknown> | undefined)?.payout;
    if (raw !== undefined && raw !== null && raw !== "") {
      const dao = parseDaoId(raw);
      if (!dao) return Response.json({ ok: false, error: "That isn't a Sputnik DAO: use name.sputnik-dao.near or a trezu.app link." }, { status: 400 });
      const refusal = await daoPayoutRefusal(dao, signerId);
      if (refusal) return Response.json({ ok: false, error: refusal.error }, { status: refusal.status });
      action.payout = dao;
    }
  } else if (action.action === "update_jar") {
    // the client never picks an update's payout: the contract refuses any but the stored one
    const jar = await getJar(action.jar_id).catch(() => undefined);
    if (jar === undefined) return Response.json({ ok: false, error: "Could not read the contract." }, { status: 502 });
    if (!jar) return Response.json({ ok: false, error: "Jar not found." }, { status: 404 });
    action.payout = jar.payout;
  }

  // NEP-413 wallets also bind the signature to a recipient; NearJar uses its contract id.
  return Response.json({
    ok: true,
    ...envelope(signerId, action, { nep413: body.standard === "nep413" }),
    recipient: NEARJAR_CONTRACT,
    payout: "payout" in action ? action.payout : null,
  });
}
