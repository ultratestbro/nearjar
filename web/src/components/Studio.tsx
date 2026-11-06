"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { EMPTY_PAGE, type JarPageData } from "@/lib/pageData";
import { JarCover } from "./JarArt";
import { JarEditor, type AssetWithIcon, type StudioJar } from "./JarEditor";
import { ShareModal } from "./ShareModal";
import { Chevron, Icon, ListCard, Panel, Pill, PillTabs, Progress, ago, money, shortAccount } from "./ui";
import { WalletOptions } from "./WalletMenu";
import { useWallet } from "./WalletProvider";

type Activity = { jars: Record<string, { daily: number[]; supporters: number }>; networks: string[] };
type Recent = { id: string; jarId: string; name: string | null; message: string | null; usdCents: number; sourceChain: string; sourceSymbol: string; at: number };
type Data = { account: string; jars: StudioJar[]; activity: Activity; pages: Record<string, JarPageData>; recent: Recent[] };
type View = { kind: "home" } | { kind: "jar"; id: string } | { kind: "edit"; id: string | null };

const NETWORK_NAMES: Record<string, string> = {
  "eip155:1": "Ethereum", "eip155:8453": "Base", "eip155:42161": "Arbitrum", "solana:mainnet": "Solana", "tron:728126428": "Tron",
  "ton:-239": "TON", "near:mainnet": "NEAR", "bitcoin:mainnet": "Bitcoin", "zcash:mainnet": "Zcash",
};

/** A jar is ready to share once it has a cover and a story. */
const incomplete = (j: StudioJar, p: JarPageData) => j.status === "Open" && ((!p.cover && !j.image_url) || !j.description.trim());

/** Creator studio in near.com's layout: jars in a sidebar, one rounded panel for the current view. */
export function Studio({ assets, startNew = false }: { assets: readonly AssetWithIcon[]; startNew?: boolean }) {
  const { wallet, restoring } = useWallet();
  const account = wallet?.account ?? "";
  const [view, setView] = useState<View>(startNew ? { kind: "edit", id: null } : { kind: "home" });
  const [tab, setTab] = useState<"overview" | "payouts">("overview");
  const [hidden, setHidden] = useState(false);
  const [data, setData] = useState<Data | null>(null);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState("");
  const [share, setShare] = useState<string | null>(null);
  // a new jar's short link, known before the studio reloads its pages
  const [shareSlug, setShareSlug] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const closeShare = useCallback(() => setShare(null), []);

  useEffect(() => {
    if (!account) return;
    let live = true;
    fetch(`/api/studio?owner=${encodeURIComponent(account)}`)
      .then((r) => r.json() as Promise<{ ok: boolean; error?: string } & Partial<Omit<Data, "account">>>)
      .then((res) => {
        if (!live) return;
        if (res.ok && res.jars && res.activity)
          setData({ account, jars: res.jars, activity: res.activity, pages: res.pages ?? {}, recent: res.recent ?? [] });
        else setError(res.error ?? "Could not load your jars.");
      })
      .catch(() => live && setError("Could not load your jars."));
    return () => {
      live = false;
    };
  }, [account, reload]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  if (!wallet)
    return (
      <Panel className="mx-auto flex max-w-xl flex-col gap-4 p-6 sm:p-8">
        <h1 className="text-2xl font-semibold">Creator studio</h1>
        <p className="text-muted">{restoring ? "Restoring your wallet…" : "Connect the wallet you use for near.com to make and manage your jars."}</p>
        {!restoring && <WalletOptions />}
      </Panel>
    );

  const loaded = data?.account === account ? data : null;
  const jars = loaded?.jars ?? [];
  const pageOf = (id: string) => loaded?.pages[id] ?? EMPTY_PAGE;
  const jarPath = (j: StudioJar) => `/j/${pageOf(j.id).slug ?? j.id}`;
  const current = view.kind !== "home" && view.id ? jars.find((j) => j.id === view.id) ?? null : null;

  const nav = (
    <nav aria-label="Studio" className="flex flex-col gap-1">
      <button type="button" onClick={() => setView({ kind: "edit", id: null })}
        className="mb-3 flex items-center justify-center gap-2 rounded-full bg-accent px-4 py-2.5 font-medium text-accent-ink">
        + New jar
      </button>
      <SideItem active={view.kind === "home" && tab === "overview"} onClick={() => { setView({ kind: "home" }); setTab("overview"); }}>Home</SideItem>
      <SideItem active={view.kind === "home" && tab === "payouts"} onClick={() => { setView({ kind: "home" }); setTab("payouts"); }}>Payouts</SideItem>
      <p className="mt-5 px-3 pb-1 text-xs uppercase tracking-wider text-muted">Your jars</p>
      {!loaded && <p className="px-3 text-sm text-muted">Loading…</p>}
      {jars.map((j) => (
        <SideItem key={j.id} active={view.kind !== "home" && view.id === j.id} onClick={() => setView({ kind: "jar", id: j.id })}>
          <span className="relative">
            <JarCover page={pageOf(j.id)} legacyImage={j.image_url} mark={false} className="size-7 rounded-lg" />
            {incomplete(j, pageOf(j.id)) && <span aria-label="not ready" className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-amber-400 ring-2 ring-bg" />}
          </span>
          <span className="truncate">{j.title}</span>
        </SideItem>
      ))}
    </nav>
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[230px_minmax(0,1fr)]">
      <aside className="hidden lg:flex lg:flex-col lg:gap-6">
        {nav}
        <div className="mt-auto flex items-center gap-2 rounded-2xl border border-line p-3">
          <Icon src={wallet.icon} alt={wallet.name} size={28} />
          <div className="min-w-0">
            <p className="truncate font-mono text-sm">{shortAccount(account)}</p>
            <p className="truncate text-xs text-muted">near.com · {wallet.name}</p>
          </div>
        </div>
      </aside>

      {/* phones: the sidebar becomes a row of pills */}
      {view.kind !== "edit" && (
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 lg:hidden">
          <MobilePill active={view.kind === "home"} onClick={() => setView({ kind: "home" })}>Home</MobilePill>
          {jars.map((j) => (
            <MobilePill key={j.id} active={view.kind === "jar" && view.id === j.id} onClick={() => setView({ kind: "jar", id: j.id })}>
              <JarCover page={pageOf(j.id)} legacyImage={j.image_url} mark={false} className="size-5 rounded-md" />
              <span className="max-w-36 truncate">{j.title}</span>
            </MobilePill>
          ))}
          <MobilePill active={false} onClick={() => setView({ kind: "edit", id: null })}>+ New</MobilePill>
        </div>
      )}

      <Panel className="min-h-[60vh] p-4 sm:p-8">
        {error && <p className="mb-4 text-sm text-danger">{error}</p>}

        {view.kind === "edit" ? (
          view.id && !current ? (
            <p className="text-muted">Loading…</p>
          ) : (
            <JarEditor
              key={view.id ?? "new"}
              jar={current}
              page={current ? pageOf(current.id) : null}
              wallet={wallet}
              assets={assets}
              onClose={() => setView(view.id ? { kind: "jar", id: view.id } : { kind: "home" })}
              onPublished={(r) => {
                setReload((n) => n + 1);
                setView({ kind: "jar", id: r.jarId });
                setToast(r.pageError ?? (!r.slugKept ? "Saved · the short link was taken, the numbered link works" : r.isNew ? "Your jar is live" : "Changes are live"));
                if (r.isNew) {
                  setShareSlug(r.slug);
                  setShare(r.jarId);
                }
              }}
            />
          )
        ) : view.kind === "jar" ? (
          current ? (
            <JarDetail
              jar={current}
              page={pageOf(current.id)}
              daily={loaded?.activity.jars[current.id]?.daily ?? []}
              recent={(loaded?.recent ?? []).filter((r) => r.jarId === current.id)}
              asset={assets.find((a) => a.id === current.receive_asset)}
              path={jarPath(current)}
              onBack={() => setView({ kind: "home" })}
              onEdit={() => setView({ kind: "edit", id: current.id })}
              onShare={() => setShare(current.id)}
            />
          ) : (
            <p className="text-muted">Loading…</p>
          )
        ) : (
          <div className="flex flex-col gap-8">
            <PillTabs value={tab} onChange={setTab} tabs={[{ id: "overview", label: "Overview" }, { id: "payouts", label: "Payouts" }]} />
            {tab === "overview" ? (
              <Overview
                loaded={!!loaded}
                jars={jars}
                pageOf={pageOf}
                activity={loaded?.activity ?? null}
                recent={loaded?.recent ?? []}
                hidden={hidden}
                onHide={() => setHidden((v) => !v)}
                open={(id) => setView({ kind: "jar", id })}
                edit={(id) => setView({ kind: "edit", id })}
                create={() => setView({ kind: "edit", id: null })}
                share={() => jars[0] && setShare(jars[0].id)}
              />
            ) : (
              <Payouts account={account} />
            )}
          </div>
        )}
      </Panel>

      {share && (() => {
        const j = jars.find((x) => x.id === share);
        return <ShareModal path={`/j/${pageOf(share).slug ?? shareSlug ?? share}`} title={j?.title ?? "your jar"} raisedUsd={Number(j?.raised_usd_cents ?? 0) / 100} onClose={closeShare} />;
      })()}

      {toast && (
        <div role="status" className="fixed inset-x-0 bottom-6 z-50 mx-auto w-fit max-w-[calc(100vw-2rem)] rounded-full bg-pill px-5 py-3 text-sm font-medium text-bg shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  );
}

function SideItem({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? "page" : undefined}
      className={`flex items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition ${active ? "bg-surface text-text" : "text-muted hover:bg-surface/60 hover:text-text"}`}>
      {children}
    </button>
  );
}

function MobilePill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium ${active ? "bg-pill text-bg" : "bg-surface text-text"}`}>
      {children}
    </button>
  );
}

function Overview({
  loaded,
  jars,
  pageOf,
  activity,
  recent,
  hidden,
  onHide,
  open,
  edit,
  create,
  share,
}: {
  loaded: boolean;
  jars: StudioJar[];
  pageOf: (id: string) => JarPageData;
  activity: Activity | null;
  recent: Recent[];
  hidden: boolean;
  onHide: () => void;
  open: (id: string) => void;
  edit: (id: string) => void;
  create: () => void;
  share: () => void;
}) {
  const raised = jars.reduce((s, j) => s + Number(j.raised_usd_cents), 0) / 100;
  const supporters = jars.reduce((s, j) => s + Number(j.donations_count), 0);
  const nets = activity?.networks ?? [];
  const todo = jars.find((j) => incomplete(j, pageOf(j.id)));
  const titleOf = (id: string) => jars.find((j) => j.id === id)?.title ?? "";
  const mask = (v: string) => (hidden ? "••••" : v);

  return (
    <>
      <section className="flex flex-col gap-4">
        <div>
          <p className="flex items-center gap-2 text-sm text-muted">
            Total raised
            <button type="button" onClick={onHide} aria-label={hidden ? "Show amounts" : "Hide amounts"} className="rounded-full p-1 hover:bg-surface hover:text-text">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" fill="none" stroke="currentColor" strokeWidth="1.4" />
                <circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
                <path d="M2.5 13.5 13.5 2.5" stroke="currentColor" strokeWidth="1.4" opacity={hidden ? 1 : 0} />
              </svg>
            </button>
          </p>
          <p className="text-5xl font-semibold tracking-tight">{mask(money(raised))}</p>
          <p className="mt-1 text-sm text-muted">
            {supporters} supporter{supporters === 1 ? "" : "s"} · {jars.length} jar{jars.length === 1 ? "" : "s"}
            {nets.length > 0 && ` · paid from ${nets.map((n) => NETWORK_NAMES[n] ?? n).slice(0, 4).join(", ")}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={create} className="rounded-full bg-pill px-5 py-2.5 text-sm font-medium text-bg">+ New jar</button>
          {jars.length > 0 && <button type="button" onClick={share} className="rounded-full bg-surface px-5 py-2.5 text-sm font-medium hover:bg-surface-2">Share</button>}
          <a href="https://near.com" target="_blank" rel="noreferrer" className="rounded-full bg-surface px-5 py-2.5 text-sm font-medium hover:bg-surface-2">Open near.com ↗</a>
        </div>
      </section>

      {todo && (
        <button type="button" onClick={() => edit(todo.id)}
          className="flex items-center gap-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-left hover:bg-amber-400/15">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-amber-400/20 text-amber-300">!</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">“{todo.title}” isn&apos;t ready to share yet</span>
            <span className="block text-sm text-muted">
              Add {[!pageOf(todo.id).cover && !todo.image_url && "a cover", !todo.description.trim() && "a story"].filter(Boolean).join(" and ")} — pages with both get more donations.
            </span>
          </span>
          <span className="shrink-0 rounded-full bg-amber-300 px-4 py-2 text-sm font-medium text-bg">Finish setup</span>
        </button>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Your jars</h2>
        {!loaded ? (
          <p className="text-muted">Loading…</p>
        ) : jars.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-line p-6">
            <p className="font-medium">No jars yet</p>
            <p className="text-sm text-muted">Make a page, share the link, and donations from any chain land in your near.com balance.</p>
            <button type="button" onClick={create} className="rounded-full bg-accent px-5 py-2.5 font-medium text-accent-ink">Create your first jar</button>
          </div>
        ) : (
          <ListCard>
            {jars.map((j) => {
              const r = Number(j.raised_usd_cents) / 100;
              const goal = j.goal_usd_cents ? Number(j.goal_usd_cents) / 100 : null;
              return (
                <button key={j.id} type="button" onClick={() => open(j.id)} className="flex w-full items-center gap-4 px-4 py-3.5 text-left hover:bg-surface-2">
                  <JarCover page={pageOf(j.id)} legacyImage={j.image_url} mark={false} className="size-12 shrink-0 rounded-xl" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">{j.title}</span>
                      {j.status === "Closed" && <Pill>Closed</Pill>}
                      {incomplete(j, pageOf(j.id)) && <Pill tone="warn">Setup</Pill>}
                    </span>
                    <span className="block text-sm text-muted">{j.donations_count} supporters</span>
                  </span>
                  <span className="hidden w-40 shrink-0 flex-col gap-1.5 sm:flex">
                    <span className="text-right text-sm">
                      {mask(money(r))}
                      {goal && <span className="text-muted"> / {money(goal, 0)}</span>}
                    </span>
                    {goal && <Progress pct={(r / goal) * 100} className="h-1.5" />}
                  </span>
                  <span className="text-sm sm:hidden">{mask(money(r, 0))}</span>
                  <Chevron />
                </button>
              );
            })}
          </ListCard>
        )}
      </section>

      {recent.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">Latest donations</h2>
          <ListCard>
            {recent.map((r) => (
              <div key={r.id} className="flex items-start gap-3 px-4 py-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-sm">{(r.name ?? "A").slice(0, 1).toUpperCase()}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="truncate font-medium">{r.name ?? "Anonymous"}</span>
                    <span className="shrink-0 font-semibold">{mask(money(r.usdCents / 100))}</span>
                  </span>
                  {r.message && <span className="block break-words text-sm text-muted">{r.message}</span>}
                  <span className="block text-xs text-muted">
                    {titleOf(r.jarId)} · {r.sourceSymbol} on {NETWORK_NAMES[r.sourceChain] ?? r.sourceChain} · {ago(r.at)}
                  </span>
                </span>
              </div>
            ))}
          </ListCard>
        </section>
      )}
    </>
  );
}

function JarDetail({
  jar,
  page,
  daily,
  recent,
  asset,
  path,
  onBack,
  onEdit,
  onShare,
}: {
  jar: StudioJar;
  page: JarPageData;
  daily: number[];
  recent: Recent[];
  asset?: AssetWithIcon;
  path: string;
  onBack: () => void;
  onEdit: () => void;
  onShare: () => void;
}) {
  const raised = Number(jar.raised_usd_cents) / 100;
  const goal = jar.goal_usd_cents ? Number(jar.goal_usd_cents) / 100 : null;
  const week = daily.slice(-7).reduce((s, v) => s + v, 0) / 100;
  const peak = Math.max(1, ...daily);
  const open = jar.status === "Open";

  return (
    <div className="flex flex-col gap-6">
      <div className="relative -mx-4 -mt-4 sm:-mx-8 sm:-mt-8">
        <JarCover page={page} legacyImage={jar.image_url} className="aspect-[8/3] w-full rounded-t-[28px]" />
        <button type="button" onClick={onBack} className="absolute left-4 top-4 flex items-center gap-1 rounded-full bg-black/50 py-1.5 pl-2 pr-3 text-sm backdrop-blur sm:left-8">
          <Chevron dir="left" /> Home
        </button>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{jar.title}</h1>
            <Pill tone={open ? "accent" : "muted"}>{jar.status}</Pill>
          </div>
          <p className="mt-1 font-mono text-sm text-muted">nearjar.xyz{path}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onShare} className="rounded-full bg-pill px-5 py-2.5 text-sm font-medium text-bg">Share</button>
          {open && <button type="button" onClick={onEdit} className="rounded-full bg-surface px-5 py-2.5 text-sm font-medium hover:bg-surface-2">Edit page</button>}
          <Link href={path} className="rounded-full bg-surface px-5 py-2.5 text-sm font-medium hover:bg-surface-2">View ↗</Link>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-semibold tracking-tight">{money(raised)}</span>
          {goal && <span className="text-muted">of {money(goal, 0)}</span>}
        </div>
        {goal && <Progress pct={(raised / goal) * 100} />}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Supporters" value={jar.donations_count} />
        <Stat label="Last 7 days" value={money(week, 0)} />
        <Stat label="Receives" value={<span className="flex items-center gap-1.5">{asset && <Icon src={asset.icon} alt={asset.symbol} size={18} />}{asset?.symbol ?? "—"}</span>} />
      </div>

      {daily.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">Last 14 days</p>
          <div className="flex h-20 items-end gap-1" role="img" aria-label="Donations over the last 14 days">
            {daily.map((v, i) => (
              <span key={i} className="flex-1 rounded-md bg-accent" style={{ height: `${Math.max(4, (v / peak) * 100)}%`, opacity: v ? 0.9 : 0.15 }} />
            ))}
          </div>
        </div>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Donations</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-muted">None yet. Share the link to get the first one.</p>
        ) : (
          <ListCard>
            {recent.map((r) => (
              <div key={r.id} className="flex items-baseline justify-between gap-3 px-4 py-3">
                <span className="min-w-0">
                  <span className="block truncate">{r.name ?? "Anonymous"}</span>
                  {r.message && <span className="block break-words text-sm text-muted">{r.message}</span>}
                  <span className="block text-xs text-muted">{r.sourceSymbol} on {NETWORK_NAMES[r.sourceChain] ?? r.sourceChain} · {ago(r.at)}</span>
                </span>
                <span className="shrink-0 font-semibold">{money(r.usdCents / 100)}</span>
              </div>
            ))}
          </ListCard>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-2xl bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}

function Payouts({ account }: { account: string }) {
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-2xl bg-surface p-5">
        <p className="font-semibold">Where donations go</p>
        <p className="text-muted">
          Straight into <span className="font-mono text-text">nearcom:{shortAccount(account)}</span>, in the asset each jar receives. NearJar never holds the
          money and takes no fee.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-surface p-5">
        <div>
          <p className="font-semibold">Export for your accountant</p>
          <p className="text-sm text-muted">CSV · date, jar, donor, network, amount paid, received, USD, transactions</p>
        </div>
        <a href={`/api/jars/export?owner=${encodeURIComponent(account)}`} className="rounded-full bg-pill px-5 py-2.5 text-sm font-medium text-bg">Download CSV</a>
      </div>
    </div>
  );
}
