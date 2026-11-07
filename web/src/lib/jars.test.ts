// Short links resolve in the contract (get_jar_by_slug), never through the database, and the
// web app spells them by the same rule the contract checks.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getJar, resolveJar, slugAvailable } from "./jars";
import { SLUG } from "./pageData";

const chainJar = (id: string, slug: string | null) => ({
  id, owner: "ana.near", payout: null, endorsed: false, revision: "0", slug, page: null, title: `Jar ${id}`, description: "",
  image_url: null, goal_usd_cents: null, ends_at: null, receive_asset: "nep141:wrap.near", status: "Open", created_at: "0",
  raised_usd_cents: "0", donations_count: "0",
});
let calls: { method: string; args: Record<string, string> }[];
let bySlug: Record<string, unknown>;

beforeEach(() => {
  calls = [];
  bySlug = { "ana-film": chainJar("5", "ana-film-2026"), "ana-film-2026": chainJar("5", "ana-film-2026") };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const p = JSON.parse(String(init?.body)).params;
      const args = JSON.parse(Buffer.from(p.args_base64, "base64").toString());
      calls.push({ method: p.method_name, args });
      const out = p.method_name === "get_jar_by_slug" ? (bySlug[args.slug] ?? null) : p.method_name === "get_jar" ? { id: args.jar_id, owner: "x.near" } : undefined;
      return Response.json({ result: { result: [...Buffer.from(JSON.stringify(out))] } });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("resolveJar", () => {
  it("a short link, current or earlier, is asked of the contract", async () => {
    expect((await resolveJar("ana-film"))?.id).toBe("5");
    expect((await resolveJar("Ana-Film-2026"))?.slug).toBe("ana-film-2026");
    expect(calls.map((c) => c.method)).toEqual(["get_jar_by_slug", "get_jar_by_slug"]);
    expect(await resolveJar("nobody-has-this")).toBeNull();
  });

  it("ids go to get_jar; what is neither isn't looked up at all", async () => {
    await resolveJar("12");
    expect(calls).toEqual([{ method: "get_jar", args: { jar_id: "12" } }]);
    expect(await resolveJar("../etc")).toBeNull();
    expect(await resolveJar("a")).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("an old contract's jar gets the new fields filled", async () => {
    const j = await getJar("12");
    expect(j).toMatchObject({ payout: null, endorsed: false, revision: "0", slug: null, page: null });
  });
});

describe("slugAvailable", () => {
  it("free on chain, or one of the jar's own links", async () => {
    expect(await slugAvailable("brand-new")).toBe(true);
    expect(await slugAvailable("ana-film")).toBe(false);
    expect(await slugAvailable("ana-film", "5")).toBe(true);
    expect(await slugAvailable("ana-film", "6")).toBe(false);
  });

  it("the site's own links and bad spellings are never free", async () => {
    expect(await slugAvailable("support")).toBe(false);
    expect(await slugAvailable("demo")).toBe(false);
    expect(await slugAvailable("12")).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("SLUG matches the contract's is_slug", () => {
  // the same table as contract/src/tests.rs short_link_spelling
  it.each(["abc", "ana-film", "a1b", "2026-fund", "x-1", "a".repeat(40)])("good %s", (s) => expect(SLUG.test(s)).toBe(true));
  it.each(["ab", "-ana", "ana-", "Ana", "123", "12-34", "a_b", "a b", "ána", "a.b", "a".repeat(41), ""])("bad %j", (s) => expect(SLUG.test(s)).toBe(false));
});
