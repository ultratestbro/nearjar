"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ReceiveAsset } from "@/lib/assets";
import { CreateJar } from "./CreateJar";
import { ShareModal } from "./ShareModal";
import { Icon, Pill, shortAccount } from "./ui";
import { WalletOptions } from "./WalletMenu";
import { useWallet } from "./WalletProvider";

type Jar = { id: string; title: string; status: "Open" | "Closed"; raised_usd_cents: string; goal_usd_cents: string | null; donations_count: string; receive_asset: string };
type Activity = { jars: Record<string, { daily: number[]; supporters: number }>; networks: string[] };
type Tab = "jars" | "create" | "payouts";

const NETWORK_NAMES: Record<string, string> = {
  "eip155:1": "Ethereum", "eip155:8453": "Base", "eip155:42161": "Arbitrum", "solana:mainnet": "Solana", "tron:728126428": "Tron",
  "ton:-239": "TON", "near:mainnet": "NEAR", "bitcoin:mainnet": "Bitcoin", "zcash:mainnet": "Zcash",
};

export function Studio({ assets }: { assets: readonly (ReceiveAsset & { icon: string })[] }) {
  const { wallet, restoring } = useWallet();
  const account = wallet?.account ?? "";
  const [tab, setTab] = useState<Tab>("jars");
  const [data, setData] = useState<{ account: string; jars: Jar[]; activity: Activity } | null>(null);
  const [error, setError] = useState("");
  const [share, setShare] = useState<Jar | null>(null);
  const closeShare = useCallback(() => setShare(null), []);

  useEffect(() => {
    if (!account) return;
    let live = true;
    fetch(`/api/studio?owner=${encodeURIComponent(account)}`)
      .then((r) => r.json() as Promise<{ ok: boolean; jars?: Jar[]; activity?: Activity; error?: string }>)
      .then((res) => {
        if (!live) return;
        if (res.ok && res.jars && res.activity) setData({ account, jars: res.jars, activity: res.activity });
        else setError(res.error ?? "Could not load your jars.");
      })
      .catch(() => live && setError("Could not load your jars."));
    return () => {
      live = false;
    };
  }, [account, tab]);

  if (!account)
    return (
      <div className="flex max-w-xl flex-col gap-4 rounded-3xl border border-line bg-surface p-6">
        <h1 className="text-2xl font-semibold">Creator studio</h1>
        <p className="text-muted">{restoring ? "Restoring your wallet…" : "Connect the wallet you use for near.com to manage your jars."}</p>
        {!restoring && <WalletOptions />}
      </div>
    );

  const loaded = data?.account === account ? data : null;
  const jars = loaded?.jars ?? [];
  const raised = jars.reduce((s, j) => s + Number(j.raised_usd_cents), 0) / 100;
  const supporters = jars.reduce((s, j) => s + Number(j.donations_count), 0);
  const nav: [Tab, string][] = [["jars", "Jars"], ["create", "Create"], ["payouts", "Payouts"]];

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <nav aria-label="Studio" className="flex shrink-0 gap-1 md:w-52 md:flex-col">
        {nav.map(([id, label]) => (
          <button key={id} type="button" onClick={() => setTab(id)} aria-current={tab === id ? "page" : undefined}
            className={`rounded-xl px-3 py-2.5 text-left ${tab === id ? "bg-surface text-text" : "text-muted hover:text-text"}`}>
            {label}
          </button>
        ))}
        <div className="mt-auto hidden items-center gap-2 rounded-2xl border border-line p-3 md:flex">
          <Icon src={wallet?.icon} alt={wallet?.name ?? ""} size={26} />
          <div className="min-w-0">
            <p className="truncate text-sm">{wallet?.name}</p>
            <p className="truncate font-mono text-xs text-muted">{shortAccount(account)}</p>
          </div>
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col gap-6">
        {tab === "jars" && (
          <>
            <div className="flex items-center justify-between gap-4">
              <h1 className="text-3xl font-semibold tracking-tight">Your jars</h1>
              <button type="button" onClick={() => setTab("create")} className="rounded-full bg-accent px-5 py-2.5 font-medium text-accent-ink">New jar</button>
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Raised" value={`$${raised.toLocaleString("en-US", { maximumFractionDigits: 2 })}`} hint={`across ${jars.length} jar${jars.length === 1 ? "" : "s"}`} />
              <Stat label="Supporters" value={String(supporters)} hint="delivered donations" />
              <Stat label="Networks used" value={String(loaded?.activity.networks.length ?? 0)}
                hint={(loaded?.activity.networks ?? []).map((n) => NETWORK_NAMES[n] ?? n).slice(0, 3).join(", ") || "none yet"} />
            </div>
            {!loaded ? (
              <p className="text-muted">Loading…</p>
            ) : jars.length === 0 ? (
              <div className="rounded-3xl border border-line bg-surface p-6">
                <p className="text-muted">No jars yet.</p>
                <button type="button" onClick={() => setTab("create")} className="mt-3 rounded-full bg-accent px-5 py-2.5 font-medium text-accent-ink">Create your first jar</button>
              </div>
            ) : (
              <ul className="flex flex-col gap-3">
                {jars.map((j) => (
                  <JarRow key={j.id} jar={j} daily={loaded.activity.jars[j.id]?.daily ?? []} asset={assets.find((a) => a.id === j.receive_asset)} onShare={() => setShare(j)} />
                ))}
              </ul>
            )}
          </>
        )}

        {tab === "create" && (
          <>
            <h1 className="text-3xl font-semibold tracking-tight">New jar</h1>
            <CreateJar assets={assets} />
          </>
        )}

        {tab === "payouts" && (
          <div className="flex max-w-2xl flex-col gap-4">
            <h1 className="text-3xl font-semibold tracking-tight">Payouts</h1>
            <div className="flex flex-col gap-2 rounded-3xl border border-line bg-surface p-6">
              <p className="font-semibold">Where donations go</p>
              <p className="text-muted">
                Straight into <span className="font-mono text-text">nearcom:{shortAccount(account)}</span>, in the asset each jar receives. NearJar never holds
                the money and takes no fee.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-line bg-surface p-6">
              <div>
                <p className="font-semibold">Export for your accountant</p>
                <p className="text-sm text-muted">CSV · date, jar, donor, network, amount paid, received, USD, transactions</p>
              </div>
              <a href={`/api/jars/export?owner=${encodeURIComponent(account)}`} className="rounded-full border border-line px-5 py-2.5 hover:bg-surface-2">Download CSV</a>
            </div>
          </div>
        )}
      </div>

      {share && <ShareModal jarId={share.id} title={share.title} raisedUsd={Number(share.raised_usd_cents) / 100} onClose={closeShare} />}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-3xl border border-line bg-surface p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 truncate text-xs text-accent">{hint}</p>
    </div>
  );
}

function JarRow({ jar, daily, asset, onShare }: { jar: Jar; daily: number[]; asset?: ReceiveAsset & { icon: string }; onShare: () => void }) {
  const raised = Number(jar.raised_usd_cents) / 100;
  const goal = jar.goal_usd_cents ? Number(jar.goal_usd_cents) / 100 : null;
  const pct = goal ? Math.min(100, (raised / goal) * 100) : null;
  const peak = Math.max(1, ...daily);
  return (
    <li className="grid items-center gap-4 rounded-3xl border border-line bg-surface p-4 sm:grid-cols-[48px_minmax(0,1fr)_170px_140px_auto]">
      <span className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-accent/80 to-accent/20 text-lg font-semibold text-accent-ink">
        {jar.title.slice(0, 1).toUpperCase()}
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Link href={`/j/${jar.id}`} className="truncate font-semibold hover:underline">{jar.title}</Link>
          <Pill tone={jar.status === "Open" ? "accent" : "muted"}>{jar.status}</Pill>
        </div>
        <p className="flex items-center gap-1.5 truncate text-sm text-muted">
          {asset && <Icon src={asset.icon} alt={asset.symbol} size={14} />}
          {asset?.symbol ?? ""} · {jar.donations_count} supporters
        </p>
      </div>
      <div>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-accent" style={{ width: `${pct ?? 100}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-muted">
          ${raised.toLocaleString("en-US", { maximumFractionDigits: 2 })}
          {goal ? ` of $${goal.toLocaleString("en-US")}` : " · no goal"}
        </p>
      </div>
      <div className="flex h-9 items-end gap-0.5" role="img" aria-label="Donations over the last 14 days">
        {daily.map((v, i) => (
          <span key={i} className="flex-1 rounded-sm bg-accent/50" style={{ height: `${Math.max(6, (v / peak) * 100)}%`, opacity: v ? 1 : 0.3 }} />
        ))}
      </div>
      <button type="button" onClick={onShare} className="rounded-full border border-line px-4 py-2 text-sm hover:bg-surface-2">Share</button>
    </li>
  );
}
