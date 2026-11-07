// Reads a signed NearJar action out of an intents.near MultiPayload the way the contract does
// (defuse-core's ExtractDefusePayload), so the API can check it before the relayer pays for it.
// The contract still verifies the signature; this only reads what was signed.

export const SIGNED_STANDARDS = ["erc191", "raw_ed25519", "nep413", "ton_connect", "tip191", "sep53", "webauthn"] as const;

export interface SignedAction {
  signerId: string;
  action: "create_jar" | "update_jar" | "close_jar";
  jarId: string | null;
  /** The signed `jar` object for create / update. */
  jar: Record<string, unknown> | null;
  /** `jar.payout` as signed: undefined when the key is absent. */
  payout: unknown;
}

/**
 * The JSON text the signature covers, per standard: `payload` itself for the string standards,
 * `payload.message` for NEP-413 (its recipient and nonce are signed next to it) and
 * `payload.text` of a TON Connect text payload.
 */
function signedText(signed: Record<string, unknown>): string | null {
  const p = signed.payload;
  switch (signed.standard) {
    case "erc191":
    case "raw_ed25519":
    case "tip191":
    case "sep53":
    case "webauthn":
      return typeof p === "string" ? p : null;
    case "nep413": {
      const m = (p as { message?: unknown } | null)?.message;
      return typeof m === "string" ? m : null;
    }
    case "ton_connect": {
      const t = p as { type?: unknown; text?: unknown } | null;
      return t?.type === "text" && typeof t.text === "string" ? t.text : null;
    }
    default:
      return null;
  }
}

export function parseSignedAction(signed: unknown): { ok: true; value: SignedAction } | { ok: false; error: string } {
  const bad = { ok: false as const, error: "Could not read the signed message." };
  if (!signed || typeof signed !== "object") return bad;
  const text = signedText(signed as Record<string, unknown>);
  if (text === null) return bad;
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return bad;
  }
  if (!m || typeof m !== "object" || Array.isArray(m) || typeof m.signer_id !== "string") return bad;
  const action = m.action;
  if (action !== "create_jar" && action !== "update_jar" && action !== "close_jar") return bad;
  const jar = m.jar && typeof m.jar === "object" && !Array.isArray(m.jar) ? (m.jar as Record<string, unknown>) : null;
  if (action !== "close_jar" && !jar) return bad;
  return {
    ok: true,
    value: {
      signerId: m.signer_id,
      action,
      jarId: typeof m.jar_id === "string" ? m.jar_id : null,
      jar,
      payout: jar && Object.hasOwn(jar, "payout") ? jar.payout : undefined,
    },
  };
}

/**
 * The payout in the text a wallet is about to sign (prepare's `message`, which every standard
 * signs as is): the DAO id, null for none, undefined when it isn't a jar action at all. The
 * editor compares this, not prepare's own answer, with what the creator picked.
 */
export function payoutInMessage(message: string): string | null | undefined {
  let m: unknown;
  try {
    m = JSON.parse(message);
  } catch {
    return undefined;
  }
  const jar = (m as { jar?: unknown } | null)?.jar;
  if (!jar || typeof jar !== "object" || Array.isArray(jar)) return undefined;
  const p = (jar as { payout?: unknown }).payout;
  return p === undefined || p === null ? null : typeof p === "string" ? p : undefined;
}
