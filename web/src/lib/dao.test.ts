// The DAO lookups behind the editor, the relay and every quote: bounded cache, fail closed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearDaoCache, daoCacheSize, daoExists, daoTreasuryRefusal } from "./dao";

const DAO = "shitzu.sputnik-dao.near";
let rpcCalls: number;
let down: boolean;
let keys: string[];

beforeEach(() => {
  clearDaoCache();
  rpcCalls = 0;
  down = false;
  keys = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      rpcCalls++;
      if (down) throw new TypeError("fetch failed");
      const p = JSON.parse(String(init?.body)).params;
      if (p.request_type === "view_account") {
        if (p.account_id !== DAO) return Response.json({ error: { cause: { name: "UNKNOWN_ACCOUNT" } } });
        return Response.json({ result: { code_hash: "4zSoHkLjJWZm34Psd4Eq2WUXHELt6LxtKmUXpsZWAECp" } });
      }
      const out = p.method_name === "get_config" ? { intents_id: "intents.near", version: "0.2.0" } : p.method_name === "public_keys_of" ? keys : null;
      return Response.json({ result: { result: [...Buffer.from(JSON.stringify(out))] } });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("cache", () => {
  it("random ids can't grow it without bound", async () => {
    for (let i = 0; i < 700; i++) await daoExists(`x${i}.sputnik-dao.near`);
    expect(daoCacheSize()).toBeLessThanOrEqual(500);
  });

  it("an existing DAO is trusted for an hour, a missing one asked again after a minute", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await daoExists(DAO);
    await daoExists("ghost.sputnik-dao.near");
    vi.advanceTimersByTime(2 * 60_000);
    const before = rpcCalls;
    expect(await daoExists(DAO)).toBe(true);
    expect(rpcCalls).toBe(before);
    expect(await daoExists("ghost.sputnik-dao.near")).toBe(false);
    expect(rpcCalls).toBe(before + 1);
  });

  it("a failed lookup is never cached", async () => {
    down = true;
    await expect(daoExists(DAO)).rejects.toThrow();
    down = false;
    expect(await daoExists(DAO)).toBe(true);
  });
});

describe("daoTreasuryRefusal (every quote to a DAO jar)", () => {
  it("passes an existing DAO no key can spend", async () => expect(await daoTreasuryRefusal(DAO)).toBeNull());
  it("refuses a name nobody created", async () => expect(await daoTreasuryRefusal("ghost.sputnik-dao.near")).toMatch(/doesn't exist/));
  it("refuses a treasury with an intents.near key", async () => {
    keys = ["ed25519:5a8xWYm8UjEGCAs3MQhWVuGuJ3Ko2DJ6VM2xjWrHXBkx"];
    expect(await daoTreasuryRefusal(DAO)).toMatch(/spent with a key/);
  });
  it("refuses when NEAR can't be asked", async () => {
    down = true;
    expect(await daoTreasuryRefusal(DAO)).toMatch(/Could not check/);
  });
  it("refuses what isn't a DAO id without asking", async () => {
    expect(await daoTreasuryRefusal("evil.near")).toMatch(/isn't a Sputnik DAO/);
    expect(rpcCalls).toBe(0);
  });
});
