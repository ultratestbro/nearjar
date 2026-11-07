// What the jar page shows from the database: only a page whose stored text hashes to the
// fingerprint the contract keeps, and only images whose bytes hash to their id.
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { EMPTY_PAGE, parsePage, type JarPageData } from "./pageData";

vi.stubEnv("TURSO_DATABASE_URL", ":memory:");
const { db } = await import("./db");
const { getImage, getPage, pageFingerprint, saveImage, savePage, trustedPage } = await import("./pages");

const sha = (b: string | Uint8Array) => createHash("sha256").update(b).digest("hex");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const page = (over: Partial<JarPageData> = {}): JarPageData => {
  const p = parsePage({ tagline: "Help Ana finish her film", links: { website: "https://anacosta.film" }, slug: "ana-film", ...over });
  if (!p.ok) throw new Error(p.error);
  return p.page;
};

beforeAll(async () => {
  await db();
});

describe("trustedPage", () => {
  it("shows the stored page when it matches the fingerprint on chain", async () => {
    const p = page();
    const hash = pageFingerprint(p);
    await savePage("5", p, hash, "tx");
    const stored = await getPage("5");
    expect(stored?.hash).toBe(hash);
    expect(trustedPage({ id: "5", page: `sha256:${hash}` }, stored)).toEqual(p);
  });

  it("a page edited in the database shows as empty, even with its hash column fixed up", async () => {
    const p = page();
    const hash = pageFingerprint(p);
    await savePage("6", p, hash, "tx");
    const forged = JSON.stringify({ ...p, links: { website: "https://phish.example" } });
    await (await db()).execute({ sql: "UPDATE jar_pages SET page = ?, hash = ? WHERE jar_id = '6'", args: [forged, sha(forged)] });
    const stored = await getPage("6");
    expect(stored?.page.links.website).toBe("https://phish.example");
    // the contract still holds the owner's fingerprint
    expect(trustedPage({ id: "6", page: `sha256:${hash}` }, stored)).toEqual(EMPTY_PAGE);
  });

  it("no fingerprint on chain or no stored page: empty", async () => {
    const stored = await getPage("5");
    expect(trustedPage({ id: "5", page: null }, stored)).toEqual(EMPTY_PAGE);
    expect(trustedPage({ id: "7", page: `sha256:${"0".repeat(64)}` }, null)).toEqual(EMPTY_PAGE);
  });

  it("the developer's jar keeps its built-in page", () => {
    expect(trustedPage({ id: "demo", page: null }, null).slug).toBe("support");
  });

  it("no longer writes the database's slug column: links live in the contract", async () => {
    await savePage("8", page({ slug: "ana-film" }), "h", null);
    await savePage("9", page({ slug: "ana-film" }), "h", null);
    const r = await (await db()).execute("SELECT COUNT(*) AS n FROM jar_pages WHERE slug IS NOT NULL");
    expect(Number(r.rows[0]!.n)).toBe(0);
  });
});

describe("getImage", () => {
  it("serves bytes that hash to the id, with the type sniffed from them", async () => {
    const hash = await saveImage(PNG, "image/png");
    expect(hash).toBe(sha(PNG));
    expect(await getImage(hash)).toEqual({ mime: "image/png", bytes: PNG });
  });

  it("refuses bytes or a type swapped in the database", async () => {
    const hash = await saveImage(PNG, "image/png");
    const c = await db();
    await c.execute({ sql: "UPDATE images SET mime = 'text/html' WHERE hash = ?", args: [hash] });
    expect((await getImage(hash))?.mime).toBe("image/png");
    await c.execute({ sql: "UPDATE images SET bytes = ? WHERE hash = ?", args: [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9]), hash] });
    expect(await getImage(hash)).toBeNull();
  });
});
