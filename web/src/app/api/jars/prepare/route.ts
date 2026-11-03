import { envelope, parseJarInput, type JarAction } from "@/lib/jarActions";
import { parseNearComAccount } from "@/lib/nearcom";
import { NEARJAR_CONTRACT } from "@/lib/near";

/**
 * POST { signerId, action: "create_jar" | "update_jar" | "close_jar", jar?, jarId?, standard? }
 * → { message, nonce, recipient }: the text the owner's wallet signs. Nothing is stored.
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
        ? { action: "update_jar", jar_id: String(body.jarId ?? ""), jar: parsed.jar }
        : { action: "create_jar", jar: parsed.jar };
  }
  if ("jar_id" in action && !/^\d{1,19}$/.test(action.jar_id)) {
    return Response.json({ ok: false, error: "Bad jar id." }, { status: 400 });
  }
  // NEP-413 wallets also bind the signature to a recipient; NearJar uses its contract id.
  return Response.json({ ok: true, ...envelope(signerId, action, { nep413: body.standard === "nep413" }), recipient: NEARJAR_CONTRACT });
}
