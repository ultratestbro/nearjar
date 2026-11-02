import "server-only";

import { randomBytes } from "node:crypto";
import { receiveAsset } from "./assets";
import { NEARJAR_CONTRACT } from "./near";

/** Mirrors the contract's limits so a bad jar fails before the owner signs. */
export const LIMITS = { title: 80, description: 1000, url: 300 } as const;

export interface JarInput {
  title: string;
  description: string;
  image_url: string | null;
  goal_usd_cents: string | null;
  ends_at: string | null;
  receive_asset: string;
}

export type JarAction =
  | { action: "create_jar"; jar: JarInput }
  | { action: "update_jar"; jar_id: string; jar: JarInput }
  | { action: "close_jar"; jar_id: string };

export function parseJarInput(raw: unknown): { ok: true; jar: JarInput } | { ok: false; error: string } {
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

  return {
    ok: true,
    jar: {
      title,
      description,
      image_url: image || null,
      goal_usd_cents: goalUsd === null ? null : String(Math.round(goalUsd * 100)),
      ends_at: null,
      receive_asset: asset,
    },
  };
}

/**
 * The exact text the owner signs: intents.near's envelope (signer_id, verifying_contract,
 * deadline, nonce) with the NearJar action flattened in. Valid for 10 minutes.
 */
export function envelope(signerId: string, action: JarAction): { message: string; nonce: string } {
  const nonce = randomBytes(32).toString("base64");
  const deadline = new Date(Date.now() + 10 * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const message = JSON.stringify({
    signer_id: signerId,
    verifying_contract: NEARJAR_CONTRACT,
    deadline,
    nonce,
    ...action,
  });
  return { message, nonce };
}
