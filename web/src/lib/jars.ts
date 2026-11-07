import "server-only";

import { db } from "./db";
import { NEARJAR_CONTRACT, view } from "./near";
import { parseNearComAccount } from "./nearcom";
import { RESERVED_SLUGS, SLUG } from "./pageData";

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

/** The short link of the developer's jar; /j/demo keeps working too. */
export const SUPPORT_SLUG = "support";

/**
 * NEARJAR_DEMO_OWNER serves the "Support the NearJar developer" jar (id "demo") paying that
 * near.com account. It isn't in the contract, so its totals come from the delivered donations.
 */
async function supportJar(): Promise<Jar | null> {
  const parsed = parseNearComAccount(process.env.NEARJAR_DEMO_OWNER ?? "");
  if (!parsed.ok) return null;
  const totals = await (await db())
    .execute({
      sql: `SELECT COALESCE(SUM(COALESCE(delivered_usd_cents, usd_cents)), 0) AS cents, COUNT(*) AS n FROM donations WHERE jar_id = 'demo' AND status = 'delivered'`,
      args: [],
    })
    .then((r) => r.rows[0])
    .catch(() => undefined);
  return {
    id: "demo",
    owner: parsed.id,
    payout: null,
    endorsed: false,
    revision: "0",
    slug: SUPPORT_SLUG,
    page: null,
    title: "Support the NearJar developer",
    description:
      "NearJar is built by one developer for the NEAR Hackathon: donation jars anyone can pay from any chain, landing straight in a near.com balance. It runs on Any Wallet Kit, an open wallet SDK by the same developer. If you like where this is going, chip in — it lands in the developer's near.com balance and keeps the work going.",
    image_url: null,
    goal_usd_cents: "100000",
    ends_at: null,
    receive_asset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    status: "Open",
    created_at: "0",
    raised_usd_cents: String(totals?.cents ?? 0),
    donations_count: String(totals?.n ?? 0),
  };
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
  if (id === "demo") return supportJar();
  if (!/^\d{1,19}$/.test(id)) return null;
  const jar = await view<Jar | null>("get_jar", { jar_id: id });
  return jar ? normalize(jar) : null;
}

export async function getJarsByOwner(owner: string): Promise<Jar[]> {
  return (await view<Jar[]>("get_jars_by_owner", { owner })).map(normalize);
}

/**
 * A jar by its id or its short link (/j/ana-film). Links resolve in the contract, which keeps
 * them unique and signed by the owner, never through the database.
 */
export async function resolveJar(idOrSlug: string): Promise<Jar | null> {
  if (idOrSlug === SUPPORT_SLUG) return getJar("demo");
  if (idOrSlug === "demo" || /^\d{1,19}$/.test(idOrSlug)) return getJar(idOrSlug);
  const slug = idOrSlug.toLowerCase();
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
