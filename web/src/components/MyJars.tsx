"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { availableWallets, connect, type WalletKind } from "@/lib/wallet";
import { Pill } from "./ui";

type Jar = { id: string; title: string; status: "Open" | "Closed"; raised_usd_cents: string; goal_usd_cents: string | null; donations_count: string };

const NAMES: Record<WalletKind, string> = { evm: "EVM wallet", solana: "Solana wallet" };

export function MyJars() {
  const [kinds, setKinds] = useState<WalletKind[] | null>(null);
  const [account, setAccount] = useState("");
  const [jars, setJars] = useState<Jar[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setKinds(availableWallets()), 300);
    return () => clearTimeout(t);
  }, []);

  async function load(kind: WalletKind) {
    setError("");
    try {
      const w = await connect(kind);
      setAccount(w.account);
      const res = (await (await fetch(`/api/jars?owner=${encodeURIComponent(w.account)}`)).json()) as { ok: boolean; jars?: Jar[]; error?: string };
      if (!res.ok || !res.jars) throw new Error(res.error ?? "Could not load your jars.");
      setJars(res.jars);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your jars.");
    }
  }

  if (!account)
    return (
      <div className="flex flex-col gap-3 rounded-3xl border border-line bg-surface p-6">
        <p className="text-muted">Connect the wallet you use for near.com to see your jars.</p>
        <div className="flex flex-wrap gap-2">
          {kinds === null ? (
            <p className="text-sm text-muted">Looking for wallets…</p>
          ) : kinds.length === 0 ? (
            <p className="text-sm text-muted">No browser wallet found. Install MetaMask, Rabby or Phantom.</p>
          ) : (
            kinds.map((k) => (
              <button key={k} type="button" onClick={() => load(k)} className="rounded-full border border-line px-4 py-2 text-sm hover:border-accent">
                {NAMES[k]}
              </button>
            ))
          )}
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Jars paying <span className="break-all font-mono text-text">nearcom:{account}</span>
      </p>
      {error && <p className="text-sm text-danger">{error}</p>}
      {jars === null ? (
        <p className="text-muted">Loading…</p>
      ) : jars.length === 0 ? (
        <div className="rounded-3xl border border-line bg-surface p-6">
          <p className="text-muted">No jars yet.</p>
          <Link href="/new" className="mt-3 inline-block rounded-full bg-accent px-5 py-2.5 font-medium text-accent-ink">Create a jar</Link>
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {jars.map((j) => {
            const raised = Number(j.raised_usd_cents) / 100;
            const goal = j.goal_usd_cents ? Number(j.goal_usd_cents) / 100 : null;
            return (
              <li key={j.id}>
                <Link href={`/j/${j.id}`} className="flex flex-col gap-3 rounded-3xl border border-line bg-surface p-5 hover:border-accent/50">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold">{j.title}</span>
                    <Pill tone={j.status === "Open" ? "accent" : "muted"}>{j.status}</Pill>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-2xl font-semibold">${raised.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
                    <span className="text-sm text-muted">{goal ? `of $${goal.toLocaleString("en-US")} · ` : ""}{j.donations_count} donations</span>
                  </div>
                  {goal && (
                    <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(1, Math.min(100, (raised / goal) * 100))}%` }} />
                    </div>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
