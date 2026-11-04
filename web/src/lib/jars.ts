import "server-only";

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

/**
 * NEARJAR_DEMO_OWNER serves one demo jar (id "demo") paying that near.com account, so the donor
 * flow can be tried without creating a jar.
 */
function demoJar(): Jar | null {
  const parsed = parseNearComAccount(process.env.NEARJAR_DEMO_OWNER ?? "");
  if (!parsed.ok) return null;
  const owner = parsed.id;
  return {
    id: "demo",
    owner,
    title: "NearJar demo jar",
    description: "A demo jar. Donations land in this near.com account.",
    image_url: null,
    goal_usd_cents: "10000",
    ends_at: null,
    receive_asset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    status: "Open",
    created_at: "0",
    raised_usd_cents: "0",
    donations_count: "0",
  };
}

export async function getJar(id: string): Promise<Jar | null> {
  if (id === "demo") return demoJar();
  if (!/^\d{1,19}$/.test(id)) return null;
  return view<Jar | null>("get_jar", { jar_id: id });
}

export async function getJarsByOwner(owner: string): Promise<Jar[]> {
  return view<Jar[]>("get_jars_by_owner", { owner });
}

/** A jar by its id or its short link (/j/ana-film). */
export async function resolveJar(idOrSlug: string): Promise<Jar | null> {
  if (idOrSlug === "demo" || /^\d{1,19}$/.test(idOrSlug)) return getJar(idOrSlug);
  const id = await jarIdBySlug(idOrSlug.toLowerCase());
  return id ? getJar(id) : null;
}
