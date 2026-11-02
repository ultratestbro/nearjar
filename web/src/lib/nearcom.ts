/**
 * near.com (intents.near) account ids NEAR Intents can credit. Mirrors the rule of
 * @anywalletkit/protocol-swap2-near-intents ≥0.3.0 for INTENTS / CONFIDENTIAL_INTENTS recipients:
 * a dotted name (name.near), a 64-hex implicit id or a lowercase 0x + 40 hex id. Top-level names
 * without a dot are refused there before any request, so NearJar refuses them up front too.
 */

const NEAR_ACCOUNT_ID = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export type NearComAccount = { ok: true; id: string } | { ok: false; error: string };

/** Accepts what people paste (`nearcom:` prefix, any case) and returns the canonical id. */
export function parseNearComAccount(input: string): NearComAccount {
  // NEAR account ids are lowercase only, and intents.near keys hex ids lowercase too
  let id = input.trim().toLowerCase();
  if (id.startsWith("nearcom:")) id = id.slice("nearcom:".length);

  const valid =
    NEAR_ACCOUNT_ID.test(id) && (id.includes(".") || /^[0-9a-f]{64}$/.test(id) || /^0x[0-9a-f]{40}$/.test(id));
  if (valid) return { ok: true, id };
  if (id.startsWith("0x")) return { ok: false, error: "A 0x near.com account is 0x followed by 40 hex characters." };
  if (NEAR_ACCOUNT_ID.test(id) && !id.includes("."))
    return { ok: false, error: `"${id}" is a top-level NEAR name; NEAR Intents only credits name.near-style, 64-hex or 0x accounts.` };
  return { ok: false, error: "That is not a near.com account. Use the address near.com shows under Receive, like nearcom:0x…" };
}
