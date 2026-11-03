"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Pill } from "./ui";
import { WalletOptions } from "./WalletMenu";
import { useWallet } from "./WalletProvider";

type Jar = { id: string; title: string; status: "Open" | "Closed"; raised_usd_cents: string; goal_usd_cents: string | null; donations_count: string };

export function MyJars() {
  const { wallet, restoring } = useWallet();
  const account = wallet?.account ?? "";
  const [loaded, setLoaded] = useState<{ account: string; jars: Jar[] } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!account) return;
    let live = true;
    fetch(`/api/jars?owner=${encodeURIComponent(account)}`)
      .then((r) => r.json() as Promise<{ ok: boolean; jars?: Jar[]; error?: string }>)
      .then((res) => {
        if (!live) return;
        if (res.ok && res.jars) setLoaded({ account, jars: res.jars });
        else setError(res.error ?? "Could not load your jars.");
      })
      .catch(() => live && setError("Could not load your jars."));
    return () => {
      live = false;
    };
  }, [account]);

  const jars = loaded?.account === account ? loaded.jars : null;

  if (!account)
    return (
      <div className="flex max-w-xl flex-col gap-4 rounded-3xl border border-line bg-surface p-6">
        <p className="text-muted">{restoring ? "Restoring your wallet…" : "Connect the wallet you use for near.com to see your jars."}</p>
        {!restoring && <WalletOptions />}
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
