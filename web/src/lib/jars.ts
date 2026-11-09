import "server-only";

import { NEARJAR_CONTRACT, view } from "./near";
import { RESERVED_SLUGS, SLUG, SUPPORT_JAR_SLUG } from "./pageData";

export { NEARJAR_CONTRACT };

export interface Jar {
  id: string;
  owner: string; // near.com (intents.near) account that created the jar and signs its changes
  /** Sputnik DAO treasury donations go to instead of the owner; set at creation, never changes. */
  payout: string | null;
  /** The payout DAO confirmed the jar on chain (`endorse_jar`); every owner edit clears it. */
  endorsed: boolean;
  /** Counts the owner's edits; a DAO endorses one revision. */
  revision: string;
  /** The short link (/j/<slug>), unique on chain. */
  slug: string | null;
  /** `sha256:<hex>` of the page data the owner signed; the stored page must match it. */
  page: string | null;
  title: string;
  description: string;
  image_url: string | null;
  goal_usd_cents: string | null;
  ends_at: string | null;
  receive_asset: string;
  status: "Open" | "Closed";
  created_at: string;
  raised_usd_cents: string;
  donations_count: string;
}

/**
 * Fills the fields a contract before DAO payouts doesn't return: such a jar pays its owner, and
 * without an on-chain fingerprint its stored page is never shown.
 */
const normalize = (j: Jar): Jar => ({
  ...j,
  payout: j.payout ?? null,
  endorsed: j.endorsed === true,
  revision: j.revision ?? "0",
  slug: j.slug ?? null,
  page: j.page ?? null,
});

export async function getJar(id: string): Promise<Jar | null> {
  if (!/^\d{1,19}$/.test(id)) return null;
  const jar = await view<Jar | null>("get_jar", { jar_id: id });
  return jar ? normalize(jar) : null;
}

export async function getJarsByOwner(owner: string): Promise<Jar[]> {
  return (await view<Jar[]>("get_jars_by_owner", { owner })).map(normalize);
}

/**
 * A jar by its id or its short link (/j/ana-film). Links resolve in the contract, which keeps
 * them unique and signed by the owner, never through the database. The developer's earlier links
 * (/j/support, /j/demo) open the developer's jar.
 */
export async function resolveJar(idOrSlug: string): Promise<Jar | null> {
  if (/^\d{1,19}$/.test(idOrSlug)) return getJar(idOrSlug);
  const lower = idOrSlug.toLowerCase();
  const slug = RESERVED_SLUGS.includes(lower) ? SUPPORT_JAR_SLUG : lower;
  if (!SLUG.test(slug)) return null;
  const jar = await view<Jar | null>("get_jar_by_slug", { slug });
  return jar ? normalize(jar) : null;
}

/** Whether `slug` is free on chain, or already one of `jarId`'s links. Throws when NEAR can't be asked. */
export async function slugAvailable(slug: string, jarId?: string): Promise<boolean> {
  if (!SLUG.test(slug) || RESERVED_SLUGS.includes(slug)) return false;
  const jar = await view<Jar | null>("get_jar_by_slug", { slug });
  return !jar || jar.id === jarId;
}
