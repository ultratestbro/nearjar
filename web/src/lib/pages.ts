import "server-only";

import { createHash } from "node:crypto";
import { db } from "./db";
import { EMPTY_PAGE, SLUG, type JarPageData } from "./pageData";

/** sha256 hex of the canonical page JSON; the owner signs it as the jar's `"page": "sha256:<hex>"`. */
export function pageFingerprint(page: JarPageData): string {
  return createHash("sha256").update(JSON.stringify(page)).digest("hex");
}

export interface StoredPage {
  page: JarPageData;
  hash: string;
  txHash: string | null;
}

/** The developer's jar (id "demo") has no owner signature to store a page, so its page lives here. */
const SUPPORT_PAGE: StoredPage = {
  page: {
    ...EMPTY_PAGE,
    tagline: "Built solo for the NEAR Hackathon",
    coverColor: 0,
    avatar: "/icon-180.png",
    thanks: "Thank you for backing NearJar! Every bit goes into more chains, better wallets and the open SDK behind it.",
    links: { website: "https://anywallet.tech", x: "https://x.com/0xdanya_xo" },
    slug: "support",
  },
  hash: "",
  txHash: null,
};

export async function getPages(jarIds: string[]): Promise<Record<string, StoredPage>> {
  if (jarIds.length === 0) return {};
  if (jarIds.includes("demo")) {
    const rest = await getPages(jarIds.filter((id) => id !== "demo"));
    return { ...rest, demo: SUPPORT_PAGE };
  }
  const r = await (await db()).execute({
    sql: `SELECT jar_id, page, hash, tx_hash FROM jar_pages WHERE jar_id IN (${jarIds.map(() => "?").join(",")})`,
    args: jarIds,
  });
  const out: Record<string, StoredPage> = {};
  for (const x of r.rows) {
    out[String(x.jar_id)] = { page: { ...EMPTY_PAGE, ...JSON.parse(String(x.page)) }, hash: String(x.hash), txHash: (x.tx_hash as string | null) ?? null };
  }
  return out;
}

export async function getPage(jarId: string): Promise<StoredPage | null> {
  return (await getPages([jarId]))[jarId] ?? null;
}

export async function jarIdBySlug(slug: string): Promise<string | null> {
  if (!SLUG.test(slug)) return null;
  const r = await (await db()).execute({ sql: `SELECT jar_id FROM jar_pages WHERE slug = ?`, args: [slug] });
  return r.rows[0] ? String(r.rows[0].jar_id) : null;
}

export async function slugAvailable(slug: string, jarId?: string): Promise<boolean> {
  const owner = await jarIdBySlug(slug);
  return owner === null || owner === jarId;
}

/**
 * Stores the page of a jar whose signed create/update the contract just accepted. The short link
 * is kept only while no other jar holds it; returns whether it was.
 */
export async function savePage(jarId: string, page: JarPageData, hash: string, txHash: string | null): Promise<{ slugKept: boolean }> {
  const c = await db();
  const slugKept = !page.slug || (await slugAvailable(page.slug, jarId));
  const slug = slugKept ? page.slug : null;
  try {
    await c.execute({
      sql: `INSERT INTO jar_pages (jar_id, page, hash, slug, tx_hash, updated_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (jar_id) DO UPDATE SET page = excluded.page, hash = excluded.hash, slug = excluded.slug,
          tx_hash = excluded.tx_hash, updated_at = excluded.updated_at`,
      args: [jarId, JSON.stringify(page), hash, slug, txHash, Date.now()],
    });
    return { slugKept };
  } catch (e) {
    // another jar took the short link between the check and the write
    if (!slug || !/UNIQUE/i.test(String(e))) throw e;
    await savePage(jarId, { ...page, slug: null }, hash, txHash);
    return { slugKept: false };
  }
}

// ---------- images ----------

export const IMAGE_MAX_BYTES = 700_000;

/** The type from the file's own first bytes; anything but JPEG, PNG and WebP is refused. */
export function sniffImage(b: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length > 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Content-addressed: the id is the sha256 of the bytes, so the signed page pins the exact picture. */
export async function saveImage(bytes: Uint8Array, mime: string): Promise<string> {
  const hash = createHash("sha256").update(bytes).digest("hex");
  await (await db()).execute({
    sql: `INSERT INTO images (hash, mime, bytes, size, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (hash) DO NOTHING`,
    args: [hash, mime, bytes, bytes.length, Date.now()],
  });
  return hash;
}

export async function getImage(hash: string): Promise<{ mime: string; bytes: Uint8Array } | null> {
  const r = await (await db()).execute({ sql: `SELECT mime, bytes FROM images WHERE hash = ?`, args: [hash] });
  const row = r.rows[0];
  if (!row) return null;
  return { mime: String(row.mime), bytes: new Uint8Array(row.bytes as ArrayBuffer) };
}
