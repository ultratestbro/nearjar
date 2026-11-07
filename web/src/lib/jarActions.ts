import "server-only";

import { randomBytes } from "node:crypto";
import { receiveAsset } from "./assets";
import { NEARJAR_CONTRACT } from "./near";
import { parsePage, type JarPageData } from "./pageData";
import { pageFingerprint } from "./pages";

/** Mirrors the contract's limits so a bad jar fails before the owner signs. */
export const LIMITS = { title: 80, description: 1000, url: 300 } as const;

export interface JarInput {
  title: string;
  description: string;
  image_url: string | null;
  goal_usd_cents: string | null;
  ends_at: string | null;
  receive_asset: string;
  /** The page's short link; signed and kept unique by the contract. */
  slug: string | null;
  /** Fingerprint of the jar page (lib/pageData.ts); signed and stored by the contract. */
  page_hash: string | null;
}

/**
 * `payout` is the Sputnik DAO the jar pays instead of the signer (null: the signer's near.com
 * balance). It is not an editable field: the contract stores it at creation and refuses an update
 * that signs a different one, so updates repeat the jar's on-chain value.
 */
export type JarAction =
  | { action: "create_jar"; jar: JarInput; payout: string | null }
  | { action: "update_jar"; jar_id: string; jar: JarInput; payout: string | null }
  | { action: "close_jar"; jar_id: string };

/** Jar fields the way the contract takes them signed: `"goal": "$1,500"`, `"receive": "USDC"`. */
function signedJar(jar: JarInput, payout: string | null): Record<string, unknown> {
  return {
    title: jar.title,
    ...(jar.description ? { description: jar.description } : {}),
    ...(jar.goal_usd_cents ? { goal: usd(BigInt(jar.goal_usd_cents)) } : {}),
    receive: receiveAsset(jar.receive_asset)!.symbol,
    // in plain sight next to the asset, so the wallet shows where the money goes
    ...(payout ? { payout } : {}),
    ...(jar.slug ? { slug: jar.slug } : {}),
    ...(jar.image_url ? { image_url: jar.image_url } : {}),
    ...(jar.ends_at ? { ends_at: jar.ends_at } : {}),
    ...(jar.page_hash ? { page: `sha256:${jar.page_hash}` } : {}),
  };
}

/** 150000 → "$1,500", 150050 → "$1,500.50" — the only spelling the contract accepts. */
export function usd(cents: bigint): string {
  const dollars = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const rest = cents % 100n;
  return `$${dollars}${rest ? `.${rest.toString().padStart(2, "0")}` : ""}`;
}

export function parseJarInput(raw: unknown): { ok: true; jar: JarInput; page: JarPageData | null } | { ok: false; error: string } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const title = String(r.title ?? "").trim();
  const description = String(r.description ?? "").trim();
  const image = r.image_url ? String(r.image_url).trim() : "";
  const goalUsd = r.goal_usd === undefined || r.goal_usd === "" || r.goal_usd === null ? null : Number(r.goal_usd);
  const asset = String(r.receive_asset ?? "");

  if (!title || [...title].length > LIMITS.title) return { ok: false, error: `Title is required, up to ${LIMITS.title} characters.` };
  if ([...description].length > LIMITS.description) return { ok: false, error: `Description is up to ${LIMITS.description} characters.` };
  if (image && (!image.startsWith("https://") || image.length > LIMITS.url)) return { ok: false, error: "Image must be an https:// link." };
  if (goalUsd !== null && !(Number.isFinite(goalUsd) && goalUsd >= 1 && goalUsd <= 10_000_000)) return { ok: false, error: "Goal must be between $1 and $10,000,000." };
  if (!receiveAsset(asset)) return { ok: false, error: "Pick what you receive." };
  const page = r.page === undefined || r.page === null ? null : parsePage(r.page);
  if (page && !page.ok) return page;

  return {
    ok: true,
    jar: {
      title,
      description,
      image_url: image || null,
      goal_usd_cents: goalUsd === null ? null : String(Math.round(goalUsd * 100)),
      ends_at: null,
      receive_asset: asset,
      slug: page ? page.page.slug : null,
      page_hash: page ? pageFingerprint(page.page) : null,
    },
    page: page ? page.page : null,
  };
}

/**
 * The exact text the owner signs: the NearJar action, then intents.near's envelope fields
 * (signer_id, verifying_contract, deadline, nonce), indented so the wallet shows one field per
 * line with what is being signed on top. Valid for 10 minutes. NEP-413 wallets sign the nonce and
 * the recipient (= verifying_contract) next to the message, so they are left out of its text.
 */
export function envelope(signerId: string, action: JarAction, { nep413 = false } = {}): { message: string; nonce: string } {
  const nonce = randomBytes(32).toString("base64");
  const deadline = new Date(Date.now() + 10 * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const message = JSON.stringify(
    {
      action: action.action,
      ...("jar_id" in action ? { jar_id: action.jar_id } : {}),
      ...("jar" in action ? { jar: signedJar(action.jar, action.payout) } : {}),
      signer_id: signerId,
      ...(nep413 ? { deadline } : { verifying_contract: NEARJAR_CONTRACT, deadline, nonce }),
    },
    null,
    2,
  );
  return { message, nonce };
}
