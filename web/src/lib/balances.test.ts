import { afterEach, describe, expect, it, vi } from "vitest";
import { balancesOf } from "./balances";

vi.mock("./prices", () => ({ tokenPrices: async () => new Map() }));

const KEYED = "https://keyed.example/token/";
const ACCOUNT = "donor.near";

/** A NEAR node that answers view_account with 2 NEAR; `down` lists the hosts that fail with 503. */
function fakeNear(down: string[] = []) {
  const seen: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      seen.push(url);
      if (down.some((d) => url.startsWith(d))) return new Response("", { status: 503 });
      const { params } = JSON.parse(String(init.body)) as { params: { request_type: string } };
      const result = params.request_type === "view_account" ? { amount: "2000000000000000000000000" } : { result: [...Buffer.from('"0"')] };
      return Response.json({ jsonrpc: "2.0", id: 0, result });
    }),
  );
  return seen;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("balance RPCs", () => {
  it("reads NEAR from the keyed endpoint in RPC_URLS", async () => {
    vi.stubEnv("RPC_URLS", JSON.stringify({ "near:mainnet": KEYED }));
    const seen = fakeNear();
    const out = await balancesOf("near", ACCOUNT);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((u) => u === KEYED)).toBe(true);
    expect(out).toContainEqual(expect.objectContaining({ symbol: "NEAR", amount: "2000000000000000000000000" }));
  });

  it("falls back to the public node when the keyed one fails", async () => {
    vi.stubEnv("RPC_URLS", JSON.stringify({ "near:mainnet": KEYED }));
    const seen = fakeNear([KEYED]);
    const out = await balancesOf("near", ACCOUNT);
    expect(seen).toContain("https://free.rpc.fastnear.com");
    expect(out).toContainEqual(expect.objectContaining({ symbol: "NEAR", amount: "2000000000000000000000000" }));
  });

  it("uses the public node without RPC_URLS, or with a value that isn't JSON", async () => {
    for (const value of [undefined, "not json"]) {
      if (value !== undefined) vi.stubEnv("RPC_URLS", value);
      const seen = fakeNear();
      await balancesOf("near", ACCOUNT);
      expect(seen.every((u) => u === "https://free.rpc.fastnear.com")).toBe(true);
    }
  });
});
