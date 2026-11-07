import "server-only";

import { db } from "./db";
import { NEARJAR_CONTRACT, view } from "./near";
import { parseNearComAccount } from "./nearcom";
import { jarIdBySlug } from "./pages";

export { NEARJAR_CONTRACT };

export interface Jar {
  id: string;
  owner: string; // near.com (intents.near) account
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

export async function getJar(id: string): Promise<Jar | null> {
  if (id === "demo") return supportJar();
  if (!/^\d{1,19}$/.test(id)) return null;
  return view<Jar | null>("get_jar", { jar_id: id });
}

export async function getJarsByOwner(owner: string): Promise<Jar[]> {
  return view<Jar[]>("get_jars_by_owner", { owner });
}

/** A jar by its id or its short link (/j/ana-film). */
export async function resolveJar(idOrSlug: string): Promise<Jar | null> {
  if (idOrSlug === SUPPORT_SLUG) return getJar("demo");
  if (idOrSlug === "demo" || /^\d{1,19}$/.test(idOrSlug)) return getJar(idOrSlug);
  const id = await jarIdBySlug(idOrSlug.toLowerCase());
  return id ? getJar(id) : null;
}
