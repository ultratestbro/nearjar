import "server-only";

import { createHash } from "node:crypto";
import { db } from "./db";
import type { Jar } from "./jars";
import { EMPTY_PAGE, type JarPageData } from "./pageData";

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

/** sha256 hex of the canonical page JSON; the owner signs it as the jar's `"page": "sha256:<hex>"`. */
export function pageFingerprint(page: JarPageData): string {
  return sha256(JSON.stringify(page));
}

export interface StoredPage {
  page: JarPageData;
  /** sha256 of the stored JSON text itself, computed on read: the `hash` column is not trusted. */
  hash: string;
  txHash: string | null;
}

export async function getPages(jarIds: string[]): Promise<Record<string, StoredPage>> {
  if (jarIds.length === 0) return {};
  const r = await (await db()).execute({
    sql: `SELECT jar_id, page, hash, tx_hash FROM jar_pages WHERE jar_id IN (${jarIds.map(() => "?").join(",")})`,
    args: jarIds,
  });
  const out: Record<string, StoredPage> = {};
  for (const x of r.rows) {
    const text = String(x.page);
    let page: JarPageData;
    try {
      page = { ...EMPTY_PAGE, ...JSON.parse(text) };
    } catch {
      continue;
    }
    out[String(x.jar_id)] = { page, hash: sha256(text), txHash: (x.tx_hash as string | null) ?? null };
  }
  return out;
}

export async function getPage(jarId: string): Promise<StoredPage | null> {
  return (await getPages([jarId]))[jarId] ?? null;
}

/**
 * The page to show for a jar read from the contract: the stored one only when its text hashes to
 * the fingerprint the owner signed and the contract keeps. Anything else (a page edited in the
 * database, or one whose save failed after an update) shows as the empty page, never as the jar's.
 */
export function trustedPage(jar: Pick<Jar, "id" | "page">, stored: StoredPage | null): JarPageData {
  return stored && jar.page === `sha256:${stored.hash}` ? stored.page : EMPTY_PAGE;
}

/**
 * Stores the page of a jar whose signed create/update the contract just accepted. The short link
 * lives in the contract (unique there); the `slug` column is no longer written.
 */
export async function savePage(jarId: string, page: JarPageData, hash: string, txHash: string | null): Promise<void> {
  await (await db()).execute({
    sql: `INSERT INTO jar_pages (jar_id, page, hash, slug, tx_hash, updated_at) VALUES (?, ?, ?, NULL, ?, ?)
      ON CONFLICT (jar_id) DO UPDATE SET page = excluded.page, hash = excluded.hash, slug = NULL,
        tx_hash = excluded.tx_hash, updated_at = excluded.updated_at`,
    args: [jarId, JSON.stringify(page), hash, txHash, Date.now()],
  });
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
  const hash = sha256(bytes);
  await (await db()).execute({
    sql: `INSERT INTO images (hash, mime, bytes, size, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (hash) DO NOTHING`,
    args: [hash, mime, bytes, bytes.length, Date.now()],
  });
  return hash;
}

/** The image whose bytes hash to `hash`; bytes changed in the database don't match and aren't served. */
export async function getImage(hash: string): Promise<{ mime: string; bytes: Uint8Array } | null> {
  const r = await (await db()).execute({ sql: `SELECT mime, bytes FROM images WHERE hash = ?`, args: [hash] });
  const row = r.rows[0];
  if (!row) return null;
  const bytes = new Uint8Array(row.bytes as ArrayBuffer);
  const mime = sniffImage(bytes);
  if (sha256(bytes) !== hash || !mime) return null;
  return { mime, bytes };
}
