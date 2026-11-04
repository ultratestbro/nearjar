// The jar page beyond what the contract stores: cover and avatar, tagline, milestones, suggested
// amounts, the thank-you note, links and a short link. The owner signs its fingerprint next to the
// stored fields (see jarActions.ts), so the page can't change without a new signature. Shared by
// the editor (client) and the API (server): both normalize the same way before fingerprinting.

export const PAGE_LIMITS = { tagline: 100, thanks: 280, milestone: 60, milestones: 6, presets: 6, link: 200 } as const;

export const PRESET_CHOICES = [2, 5, 10, 20, 25, 50, 100, 250] as const;
export const DEFAULT_PRESETS = [5, 10, 25, 50];

/** Cover backgrounds when there is no photo; the index is what the page stores. */
export const COVER_GRADIENTS = [
  "linear-gradient(135deg, #1f4733 0%, #0f2a1d 55%, #111 100%)",
  "linear-gradient(135deg, #3b2a5c 0%, #1d1530 55%, #111 100%)",
  "linear-gradient(135deg, #5c3a1f 0%, #2e1d10 55%, #111 100%)",
  "linear-gradient(135deg, #1f3f5c 0%, #10202e 55%, #111 100%)",
  "linear-gradient(135deg, #5c1f3a 0%, #2e101d 55%, #111 100%)",
] as const;

export const LINK_KINDS = ["website", "x", "telegram", "youtube"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export interface Milestone {
  usd: number;
  label: string;
}

export interface JarPageData {
  v: 1;
  tagline: string;
  /** sha256 hex of an uploaded image, see /api/img. */
  cover: string | null;
  coverColor: number;
  avatar: string | null;
  milestones: Milestone[];
  presets: number[];
  thanks: string;
  links: Partial<Record<LinkKind, string>>;
  slug: string | null;
}

export const EMPTY_PAGE: JarPageData = {
  v: 1,
  tagline: "",
  cover: null,
  coverColor: 0,
  avatar: null,
  milestones: [],
  presets: DEFAULT_PRESETS,
  thanks: "",
  links: {},
  slug: null,
};

const HASH = /^[0-9a-f]{64}$/;
// a letter somewhere, so a short link never looks like a jar id
export const SLUG = /^(?=[a-z0-9-]*[a-z])[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export const imageUrl = (hash: string) => `/api/img/${hash}`;

/** "Help Ana finish her film" → "help-ana-finish-her-film" (≤ 40 chars). */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

const LINK_PREFIX: Record<LinkKind, string> = {
  website: "https://",
  x: "https://x.com/",
  telegram: "https://t.me/",
  youtube: "https://youtube.com/@",
};
const LINK_HOSTS: Record<LinkKind, string[] | null> = {
  website: null,
  x: ["x.com", "twitter.com"],
  telegram: ["t.me"],
  youtube: ["youtube.com", "www.youtube.com", "youtu.be"],
};

/** A handle or a link → an https URL on the right site, or null when it isn't one. */
export function normalizeLink(kind: LinkKind, raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const url = /^https?:\/\//i.test(v) ? v.replace(/^http:/i, "https:") : LINK_PREFIX[kind] + v.replace(/^@/, "");
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    const hosts = LINK_HOSTS[kind];
    if (hosts && !hosts.includes(u.hostname.toLowerCase())) return null;
    if (!hosts && !u.hostname.includes(".")) return null;
    const s = u.toString();
    return s.length <= PAGE_LIMITS.link ? s : null;
  } catch {
    return null;
  }
}

const clean = (v: unknown, max: number) => [...String(v ?? "").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").trim()].slice(0, max).join("");
const line = (v: unknown, max: number) => clean(String(v ?? "").replace(/\s+/g, " "), max);

/**
 * Untrusted input → a page in canonical form (fixed key order, sorted milestones and presets), or
 * the first problem found. Fingerprints are taken of `JSON.stringify` of the result.
 */
export function parsePage(raw: unknown): { ok: true; page: JarPageData } | { ok: false; error: string } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const cover = r.cover ? String(r.cover) : null;
  const avatar = r.avatar ? String(r.avatar) : null;
  if ((cover && !HASH.test(cover)) || (avatar && !HASH.test(avatar))) return { ok: false, error: "Upload the image again." };

  const coverColor = Number(r.coverColor ?? 0);
  if (!Number.isInteger(coverColor) || coverColor < 0 || coverColor >= COVER_GRADIENTS.length) return { ok: false, error: "Bad cover color." };

  const rawMs = Array.isArray(r.milestones) ? r.milestones : [];
  if (rawMs.length > PAGE_LIMITS.milestones) return { ok: false, error: `Up to ${PAGE_LIMITS.milestones} milestones.` };
  const milestones: Milestone[] = [];
  for (const m of rawMs as Record<string, unknown>[]) {
    const usd = Number(m?.usd);
    const label = line(m?.label, PAGE_LIMITS.milestone);
    if (!label) return { ok: false, error: "Every milestone needs a label." };
    if (!Number.isInteger(usd) || usd < 1 || usd > 10_000_000) return { ok: false, error: `Milestone "${label}" needs a whole-dollar amount.` };
    milestones.push({ usd, label });
  }
  milestones.sort((a, b) => a.usd - b.usd);

  const presets = [...new Set((Array.isArray(r.presets) ? r.presets : DEFAULT_PRESETS).map(Number))].sort((a, b) => a - b);
  if (presets.length < 1 || presets.length > PAGE_LIMITS.presets || presets.some((p) => !Number.isInteger(p) || p < 1 || p > 10_000))
    return { ok: false, error: `Pick 1 to ${PAGE_LIMITS.presets} suggested amounts.` };

  const links: Partial<Record<LinkKind, string>> = {};
  const rawLinks = (r.links ?? {}) as Record<string, unknown>;
  for (const k of LINK_KINDS) {
    const v = rawLinks[k];
    if (v === undefined || v === null || String(v).trim() === "") continue;
    const n = normalizeLink(k, String(v));
    if (!n) return { ok: false, error: `That ${k === "x" ? "X" : k} link doesn't look right.` };
    links[k] = n;
  }

  const slug = r.slug ? String(r.slug).trim().toLowerCase() : null;
  if (slug && !SLUG.test(slug)) return { ok: false, error: "Short link: 3–40 letters, digits or dashes." };

  return {
    ok: true,
    page: {
      v: 1,
      tagline: line(r.tagline, PAGE_LIMITS.tagline),
      cover,
      coverColor,
      avatar,
      milestones,
      presets,
      thanks: clean(r.thanks, PAGE_LIMITS.thanks).replace(/\s*\n\s*\n\s*/g, "\n\n"),
      links,
      slug,
    },
  };
}
