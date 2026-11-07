import { describe, expect, it } from "vitest";
import { envelope, type JarAction, type JarInput } from "./jarActions";
import { parseSignedAction, payoutInMessage } from "./signedPayload";

const JAR: JarInput = {
  title: "Community fund",
  description: "",
  image_url: null,
  goal_usd_cents: "150000",
  ends_at: null,
  receive_asset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  slug: null,
  page_hash: null,
};
const DAO = "shitzu.sputnik-dao.near";
const SIGNER = "sealteam666.near";
const SIG = { signature: "ed25519:x", public_key: "ed25519:y" };

/** The MultiPayload each wallet family sends (see lib/wallet.ts), around the text prepare built. */
function wrap(standard: string, message: string, nonce: string): Record<string, unknown> {
  switch (standard) {
    case "nep413":
      return { standard, payload: { message, nonce, recipient: "nearjar.near" }, ...SIG };
    case "ton_connect":
      return { standard, address: "0:abc", domain: "nearjar.xyz", timestamp: 1, payload: { type: "text", text: message }, ...SIG };
    case "webauthn":
      return { standard, payload: message, assertion: {}, ...SIG };
    default:
      return { standard, payload: message, ...SIG };
  }
}

describe("parseSignedAction", () => {
  const create: JarAction = { action: "create_jar", jar: JAR, payout: DAO };

  it.each(["erc191", "raw_ed25519", "nep413", "ton_connect", "tip191", "sep53", "webauthn"])("%s: signer and payout of a DAO jar", (standard) => {
    const { message, nonce } = envelope(SIGNER, create, { nep413: standard === "nep413" });
    const r = parseSignedAction(wrap(standard, message, nonce));
    expect(r).toEqual({ ok: true, value: expect.objectContaining({ signerId: SIGNER, action: "create_jar", jarId: null, payout: DAO }) });
  });

  it("the payout is signed in plain sight, next to the asset", () => {
    const { message } = envelope(SIGNER, create);
    expect(message).toContain(`"receive": "USDC",\n    "payout": "${DAO}"`);
  });

  it("the short link is signed as a jar field, so the contract can keep it unique", () => {
    const { message } = envelope(SIGNER, { action: "create_jar", jar: { ...JAR, slug: "ana-film", page_hash: "ab".repeat(32) }, payout: null });
    const jar = JSON.parse(message).jar;
    expect(jar.slug).toBe("ana-film");
    expect(jar.page).toBe(`sha256:${"ab".repeat(32)}`);
  });

  it("a plain jar has no payout key at all", () => {
    const { message, nonce } = envelope(SIGNER, { action: "create_jar", jar: JAR, payout: null });
    expect(message).not.toContain("payout");
    const r = parseSignedAction(wrap("erc191", message, nonce));
    expect(r.ok && r.value.payout).toBeUndefined();
  });

  it("updates and closes carry the jar id", () => {
    const up = envelope(SIGNER, { action: "update_jar", jar_id: "7", jar: JAR, payout: DAO });
    const r = parseSignedAction(wrap("raw_ed25519", up.message, up.nonce));
    expect(r.ok && r.value).toMatchObject({ action: "update_jar", jarId: "7", payout: DAO });
    const close = envelope(SIGNER, { action: "close_jar", jar_id: "7" });
    const c = parseSignedAction(wrap("raw_ed25519", close.message, close.nonce));
    expect(c.ok && c.value).toMatchObject({ action: "close_jar", jarId: "7", jar: null, payout: undefined });
  });

  it("keeps a null payout as null (the contract reads it as none)", () => {
    const text = JSON.stringify({ action: "create_jar", jar: { title: "x", receive: "USDC", payout: null }, signer_id: SIGNER });
    const r = parseSignedAction({ standard: "erc191", payload: text });
    expect(r.ok && r.value.payout).toBeNull();
  });

  it.each([
    ["no payload", { standard: "erc191" }],
    ["unknown standard", { standard: "bip322", payload: "{}" }],
    ["not JSON", { standard: "erc191", payload: "create a jar please" }],
    ["JSON array", { standard: "erc191", payload: "[]" }],
    ["no signer", { standard: "erc191", payload: JSON.stringify({ action: "create_jar", jar: {} }) }],
    ["unknown action", { standard: "erc191", payload: JSON.stringify({ action: "drain", signer_id: SIGNER }) }],
    ["create without a jar", { standard: "erc191", payload: JSON.stringify({ action: "create_jar", signer_id: SIGNER }) }],
    ["nep413 with a string payload", { standard: "nep413", payload: "{}" }],
    ["ton_connect binary payload", { standard: "ton_connect", payload: { type: "binary", bytes: "AA==" } }],
    ["not an object", "erc191"],
  ])("refuses %s", (_name, signed) => expect(parseSignedAction(signed).ok).toBe(false));
});

describe("payoutInMessage (what the editor checks before the wallet signs)", () => {
  it("reads the payout out of the text itself", () => {
    expect(payoutInMessage(envelope(SIGNER, { action: "create_jar", jar: JAR, payout: DAO }).message)).toBe(DAO);
    expect(payoutInMessage(envelope(SIGNER, { action: "create_jar", jar: JAR, payout: null }).message)).toBeNull();
    expect(payoutInMessage(envelope(SIGNER, { action: "update_jar", jar_id: "7", jar: JAR, payout: DAO }, { nep413: true }).message)).toBe(DAO);
  });

  it("a prepare that claims one payout and signs another is caught", () => {
    // prepare's own `payout` field says null, the text names a DAO: the text wins
    const message = envelope(SIGNER, { action: "create_jar", jar: JAR, payout: "evil.sputnik-dao.near" }).message;
    expect(payoutInMessage(message)).not.toBeNull();
  });

  it.each(["not json", "[]", "{}", JSON.stringify({ jar: [] }), JSON.stringify({ jar: { payout: 5 } })])("unreadable: %s", (m) =>
    expect(payoutInMessage(m)).toBeUndefined(),
  );
});
