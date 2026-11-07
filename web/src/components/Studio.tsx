"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { StudioCatalog } from "@/lib/assets";
import { EMPTY_PAGE, type JarPageData } from "@/lib/pageData";
import { PlusIcon } from "./ButtonIcons";
import { DaoEndorse } from "./Dao";
import { JarCover } from "./JarArt";
import { JarEditor, type AssetWithIcon, type StudioJar } from "./JarEditor";
import { ShareModal } from "./ShareModal";
import { NETWORK_NAMES, Overview, incomplete, type Activity, type Recent } from "./StudioHome";
import { Chevron, Icon, ListCard, Panel, Pill, PillTabs, Progress, Skeleton, ago, money, shortAccount } from "./ui";
import { ConnectPanel } from "./WalletMenu";
import { useWallet } from "./WalletProvider";

type Data = { account: string; jars: StudioJar[]; activity: Activity; pages: Record<string, JarPageData>; recent: Recent[]; contract: string };
type View = { kind: "home" } | { kind: "jar"; id: string } | { kind: "edit"; id: string | null };

/** Creator studio in near.com's layout: jars in a sidebar, one rounded panel for the current view. */
export function Studio({ assets, catalog = { chains: [], tokens: {} }, startNew = false }: { assets: readonly AssetWithIcon[]; catalog?: StudioCatalog; startNew?: boolean }) {
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
          setData({ account, jars: res.jars, activity: res.activity, pages: res.pages ?? {}, recent: res.recent ?? [], contract: res.contract ?? "nearjar.near" });
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
        {!restoring && <ConnectPanel />}
      </Panel>
    );

  const loaded = data?.account === account ? data : null;
  const jars = loaded?.jars ?? [];
  const pageOf = (id: string) => loaded?.pages[id] ?? EMPTY_PAGE;
  const jarPath = (j: StudioJar) => `/j/${j.slug ?? j.id}`;
  const current = view.kind !== "home" && view.id ? jars.find((j) => j.id === view.id) ?? null : null;

  const nav = (
    <nav aria-label="Studio" className="flex flex-col gap-1">
      <button type="button" onClick={() => setView({ kind: "edit", id: null })}
        className="btn-tactile-accent mb-3 justify-center px-4 py-2.5">
        <PlusIcon /> New jar
      </button>
      <SideItem active={view.kind === "home" && tab === "overview"} onClick={() => { setView({ kind: "home" }); setTab("overview"); }}>Home</SideItem>
      <SideItem active={view.kind === "home" && tab === "payouts"} onClick={() => { setView({ kind: "home" }); setTab("payouts"); }}>Payouts</SideItem>
      <p className="mt-5 px-3 pb-1 text-xs uppercase tracking-wider text-muted">Your jars</p>
      {!loaded &&
        [0, 1].map((i) => (
          <span key={i} role="status" aria-label="Loading your jars" className="flex items-center gap-3 px-3 py-2">
            <Skeleton className="size-7 shrink-0" />
            <Skeleton className="h-3.5 w-28" />
          </span>
        ))}
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
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 lg:hidden">
          <MobilePill active={view.kind === "home"} onClick={() => setView({ kind: "home" })}>Home</MobilePill>
          {!loaded && [0, 1].map((i) => <Skeleton key={i} className="h-10 w-32 shrink-0 rounded-[14px]!" />)}
          {jars.map((j) => (
            <MobilePill key={j.id} active={view.kind === "jar" && view.id === j.id} onClick={() => setView({ kind: "jar", id: j.id })}>
              <JarCover page={pageOf(j.id)} legacyImage={j.image_url} mark={false} className="size-5 rounded-md" />
              <span className="max-w-36 truncate">{j.title}</span>
            </MobilePill>
          ))}
          <MobilePill active={false} onClick={() => setView({ kind: "edit", id: null })}><PlusIcon /> New</MobilePill>
        </div>
      )}

      <Panel className="min-h-[60vh] p-4 sm:p-8">
        {error && <p className="mb-4 text-sm text-danger">{error}</p>}

        {view.kind === "edit" ? (
          view.id && !current ? (
            <DetailSkeleton />
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
                setToast(r.pageError ?? (r.isNew ? "Your jar is live" : "Changes are live"));
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
              contract={loaded?.contract ?? "nearjar.near"}
              onBack={() => setView({ kind: "home" })}
              onEdit={() => setView({ kind: "edit", id: current.id })}
              onShare={() => setShare(current.id)}
            />
          ) : (
            <DetailSkeleton />
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
                catalog={catalog}
                hidden={hidden}
                onHide={() => setHidden((v) => !v)}
                open={(id) => setView({ kind: "jar", id })}
                edit={(id) => setView({ kind: "edit", id })}
                create={() => setView({ kind: "edit", id: null })}
                share={setShare}
              />
            ) : (
              <Payouts account={account} jars={jars} />
            )}
          </div>
        )}
      </Panel>

      {share && (() => {
        const j = jars.find((x) => x.id === share);
        return <ShareModal path={`/j/${j?.slug ?? shareSlug ?? share}`} title={j?.title ?? "your jar"} raisedUsd={Number(j?.raised_usd_cents ?? 0) / 100} onClose={closeShare} />;
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
    <button type="button" onClick={onClick} aria-current={active ? "page" : undefined} className="btn-tactile shrink-0 px-4 py-2 text-sm font-medium">
      {children}
    </button>
  );
}

/** Stands in for a jar's page in the studio until the jars arrive. */
function DetailSkeleton() {
  return (
    <div role="status" aria-label="Loading the jar" className="flex flex-col gap-6">
      <Skeleton className="-mx-4 -mt-4 aspect-video w-[calc(100%+2rem)] rounded-none rounded-t-[28px] sm:-mx-8 sm:-mt-8 sm:w-[calc(100%+4rem)]" />
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
      </div>
    </div>
  );
}

function JarDetail({
  jar,
  page,
  daily,
  recent,
  asset,
  path,
  contract,
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
  contract: string;
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
        <JarCover page={page} legacyImage={jar.image_url} className="aspect-video w-full rounded-t-[28px]" />
        <button type="button" onClick={onBack} className="btn-tactile absolute left-4 top-4 gap-1 py-1.5 pl-2 pr-3 text-sm sm:left-8">
          <Chevron dir="left" /> Home
        </button>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{jar.title}</h1>
            <Pill tone={open ? "accent" : "muted"}>{jar.status}</Pill>
            {jar.payout && <Pill>DAO</Pill>}
          </div>
          <p className="mt-1 font-mono text-sm text-muted">nearjar.xyz{path}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onShare} className="btn-tactile-accent px-5 py-2.5 text-sm">Share</button>
          {open && <button type="button" onClick={onEdit} className="btn-tactile px-5 py-2.5 text-sm font-medium">Edit page</button>}
          <Link href={path} className="btn-tactile px-5 py-2.5 text-sm font-medium">View ↗</Link>
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

      {jar.payout && <DaoEndorse dao={jar.payout} endorsed={jar.endorsed} jarId={jar.id} revision={jar.revision} contract={contract} />}

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

function Payouts({ account, jars }: { account: string; jars: StudioJar[] }) {
  const daoJars = jars.filter((j) => j.payout);
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-2xl bg-surface p-5">
        <p className="font-semibold">Where donations go</p>
        <p className="text-muted">
          Straight into <span className="font-mono text-text">nearcom:{shortAccount(account)}</span>, in the asset each jar receives. NearJar never holds the
          money and takes no fee.
        </p>
        {daoJars.length > 0 && (
          <ul className="mt-1 flex flex-col gap-1 text-sm">
            {daoJars.map((j) => (
              <li key={j.id} className="truncate text-muted">
                <span className="text-text">{j.title}</span> pays the DAO treasury <span className="font-mono text-text">{j.payout}</span> instead
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-surface p-5">
        <div>
          <p className="font-semibold">Export for your accountant</p>
          <p className="text-sm text-muted">CSV · date, jar, donor, network, amount paid, received, USD, transactions</p>
        </div>
        <a href={`/api/jars/export?owner=${encodeURIComponent(account)}`} className="btn-tactile-accent px-5 py-2.5 text-sm">Download CSV</a>
      </div>
    </div>
  );
}
