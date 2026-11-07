"use client";

import { useState, type PointerEvent, type ReactNode } from "react";
import type { StudioCatalog } from "@/lib/assets";
import type { JarPageData } from "@/lib/pageData";
import { JarCover } from "./JarArt";
import type { StudioJar } from "./JarEditor";
import { Icon, Skeleton, ago, money } from "./ui";

export type Activity = { jars: Record<string, { daily: number[]; supporters: number }>; networks: string[] };
export type Recent = { id: string; jarId: string; name: string | null; message: string | null; usdCents: number; sourceChain: string; sourceSymbol: string; at: number };

export const NETWORK_NAMES: Record<string, string> = {
  "eip155:1": "Ethereum", "eip155:8453": "Base", "eip155:42161": "Arbitrum", "solana:mainnet": "Solana", "tron:728126428": "Tron",
  "ton:-239": "TON", "near:mainnet": "NEAR", "bitcoin:mainnet": "Bitcoin", "zcash:mainnet": "Zcash",
};

const hasCover = (j: StudioJar, p: JarPageData) => !!(p.cover || j.image_url);

/** A jar is ready to share once it has a cover and a story. */
export const incomplete = (j: StudioJar, p: JarPageData) => j.status === "Open" && (!hasCover(j, p) || !j.description.trim());

/** What "ready to share" is made of; the contract already guarantees a name and a payout asset. */
function setupSteps(j: StudioJar, p: JarPageData) {
  return [
    { label: "Name your jar", done: !!j.title.trim() },
    { label: "Payouts to near.com", done: !!j.receive_asset },
    { label: "Add a cover image", done: hasCover(j, p), action: "Add" },
    { label: "Write a short story", done: !!j.description.trim(), action: "Write" },
  ];
}

const DAY = 86_400_000;
// /api/studio returns at most this many recent donations (recentFor's default)
const RECENT_CAP = 8;

/** Donations in the last `ms`, counted from the recent list; `exact` is false when the list may be cut off. */
function countSince(recent: Recent[], ms: number) {
  const since = Date.now() - ms;
  const n = recent.filter((r) => r.at >= since).length;
  const exact = recent.length < RECENT_CAP || recent.some((r) => r.at < since);
  return { n, text: `${n}${exact ? "" : "+"}` };
}

/** "Nov 2" for the day `k` days back, "Today" for the last 24 h. */
const dayLabel = (k: number) => (k === 0 ? "Today" : new Date(Date.now() - k * DAY).toLocaleDateString("en-US", { month: "short", day: "numeric" }));
const isRecent = (at: number, ms: number) => Date.now() - at < ms;

const plural = (n: number | string, one: string, many = `${one}s`) => `${n} ${Number(n) === 1 ? one : many}`;

export function Overview({
  loaded,
  jars,
  pageOf,
  activity,
  recent,
  catalog,
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
  catalog: StudioCatalog;
  hidden: boolean;
  onHide: () => void;
  open: (id: string) => void;
  edit: (id: string) => void;
  create: () => void;
  share: (id: string) => void;
}) {
  const raised = jars.reduce((s, j) => s + Number(j.raised_usd_cents), 0) / 100;
  const supporters = jars.reduce((s, j) => s + Number(j.donations_count), 0);
  const nets = activity?.networks ?? [];
  // all jars' 14-day buckets added up, oldest first, in cents
  const span = Math.max(0, ...Object.values(activity?.jars ?? {}).map((a) => a.daily.length));
  const daily = Array.from({ length: span }, (_, i) => Object.values(activity?.jars ?? {}).reduce((s, a) => s + (a.daily[i] ?? 0), 0));
  const week = daily.slice(-7).reduce((s, v) => s + v, 0) / 100;
  const todo = jars.find((j) => incomplete(j, pageOf(j.id)));
  const mask = (v: string) => (hidden ? "••••" : v);
  const chainOf = (c: string) => catalog.chains.find((x) => x.chain === c);
  const today = loaded ? countSince(recent, DAY) : null;
  const hour = new Date().getHours();

  return (
    <>
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-muted">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            {hour < 5 || hour >= 18 ? "Good evening" : hour < 12 ? "Good morning" : "Good afternoon"}
            {today && today.n > 0 && <span className="text-muted"> — {plural(today.text, "new donation")} today</span>}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {jars.length > 0 && (
            <button type="button" onClick={() => share((jars.find((j) => !incomplete(j, pageOf(j.id))) ?? jars[0]!).id)}
              className="rounded-full bg-surface px-5 py-2.5 text-sm font-medium hover:bg-surface-2">
              Share a jar
            </button>
          )}
          <a href="https://near.com" target="_blank" rel="noreferrer" className="rounded-full bg-surface px-5 py-2.5 text-sm font-medium hover:bg-surface-2">Open near.com ↗</a>
        </div>
      </section>

      {loaded && jars.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-3xl border border-dashed border-line p-6">
          <p className="font-medium">No jars yet</p>
          <p className="text-sm text-muted">Make a page, share the link, and donations from any chain land in your near.com balance.</p>
          <button type="button" onClick={create} className="rounded-full bg-accent px-5 py-2.5 font-medium text-accent-ink">Create your first jar</button>
        </div>
      ) : (
        <>
          <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <div className="col-span-2 flex flex-col gap-2.5 rounded-3xl bg-accent p-5 text-accent-ink sm:col-span-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Total raised</span>
                <button type="button" onClick={onHide} aria-label={hidden ? "Show amounts" : "Hide amounts"}
                  className="grid size-9 place-items-center rounded-full bg-accent-ink/10 hover:bg-accent-ink/20">
                  <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden>
                    <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" fill="none" stroke="currentColor" strokeWidth="1.4" />
                    <circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
                    <path d="M2.5 13.5 13.5 2.5" stroke="currentColor" strokeWidth="1.4" opacity={hidden ? 1 : 0} />
                  </svg>
                </button>
              </div>
              {loaded ? (
                <p className="truncate text-[2.75rem] font-bold leading-none tracking-tight">{mask(money(raised))}</p>
              ) : (
                <span role="status" aria-label="Loading totals" className="block h-11 w-36 animate-pulse rounded-lg bg-accent-ink/15" />
              )}
              <p className="text-sm">Lands in your near.com balance</p>
            </div>

            <Kpi label="This week" loaded={loaded} value={mask(money(week))}
              hint={(() => {
                const w = countSince(recent, 7 * DAY);
                if (w.n > 0) return <><span className="text-accent">{plural(w.text, "donation")}</span> · last {ago(recent[0]!.at)}</>;
                return recent[0] ? `Last donation ${ago(recent[0].at)}` : "No donations yet";
              })()} />

            <Kpi label="Supporters" loaded={loaded} value={supporters}
              hint={(() => {
                const names = [...new Set(recent.map((r) => r.name).filter((n): n is string => !!n))].slice(0, 3);
                return (
                  <>
                    {names.length > 0 && (
                      <span className="flex">
                        {names.map((n, i) => (
                          <span key={n} className={`grid size-[22px] place-items-center rounded-full bg-surface-2 text-[11px] text-text ring-2 ring-surface ${i ? "-ml-2" : ""}`}>
                            {n.slice(0, 1).toUpperCase()}
                          </span>
                        ))}
                      </span>
                    )}
                    across {plural(jars.length, "jar")}
                  </>
                );
              })()} />

            <Kpi label="Paid from" loaded={loaded} className="col-span-2 sm:col-span-1"
              value={<>{nets.length} <span className="text-lg font-medium text-muted">{nets.length === 1 ? "network" : "networks"}</span></>}
              hint={nets.length === 0 ? "No donations yet" : (
                <>
                  <span className="flex">
                    {nets.slice(0, 4).map((n, i) => (
                      <span key={n} className={`rounded-full ring-2 ring-surface ${i ? "-ml-1.5" : ""}`}>
                        <Icon src={chainOf(n)?.icon} alt={chainOf(n)?.label ?? n} size={20} />
                      </span>
                    ))}
                  </span>
                  <span className="truncate">{nets.map((n) => chainOf(n)?.label ?? NETWORK_NAMES[n] ?? n).join(", ")}</span>
                </>
              )} />
          </section>

          <section className="flex flex-wrap gap-4">
            <RaisedChart loaded={loaded} daily={daily} hidden={hidden} />
            {todo && <SetupCard jar={todo} page={pageOf(todo.id)} onEdit={() => edit(todo.id)} />}
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Your jars</h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
              {!loaded
                ? [0, 1].map((i) => (
                    <div key={i} role="status" aria-label="Loading your jars" className="flex flex-col overflow-hidden rounded-3xl bg-surface">
                      <Skeleton className="aspect-video w-full rounded-none" />
                      <div className="flex flex-col gap-3 p-4">
                        <Skeleton className="h-5 w-40" />
                        <Skeleton className="h-4 w-28" />
                        <Skeleton className="h-1.5 w-full rounded-full" />
                        <Skeleton className="h-10 w-full rounded-full" />
                      </div>
                    </div>
                  ))
                : jars.map((j) => (
                    <JarCard key={j.id} jar={j} page={pageOf(j.id)} mask={mask} onOpen={() => open(j.id)} onEdit={() => edit(j.id)} onShare={() => share(j.id)} />
                  ))}
              {loaded && (
                <button type="button" onClick={create}
                  className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-3xl border-[1.5px] border-dashed border-line p-6 text-muted transition hover:border-muted hover:text-text">
                  <span className="grid size-12 place-items-center rounded-full bg-surface text-2xl leading-none text-accent">+</span>
                  <span className="font-medium text-text">Start a new jar</span>
                  <span className="max-w-56 text-center text-sm">Donors pay from any chain — it lands in your near.com balance.</span>
                </button>
              )}
            </div>
          </section>

          <section className="flex flex-col gap-1 rounded-3xl bg-surface p-5 sm:p-6">
            <h2 className="mb-2 flex items-center gap-2.5 text-lg font-semibold">
              Latest donations
              <span aria-hidden className="size-2 rounded-full bg-accent shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent)_18%,transparent)]" />
            </h2>
            {!loaded ? (
              [0, 1, 2].map((i) => (
                <div key={i} role="status" aria-label="Loading donations" className="flex items-center gap-3.5 py-3">
                  <Skeleton className="size-10 shrink-0 rounded-full!" />
                  <span className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-4 w-44" />
                    <Skeleton className="h-3 w-32" />
                  </span>
                  <Skeleton className="h-4 w-12" />
                </div>
              ))
            ) : recent.length === 0 ? (
              <p className="py-3 text-sm text-muted">None yet. Share a jar to get the first one.</p>
            ) : (
              <div className="flex flex-col divide-y divide-line">
                {recent.map((r) => (
                  <DonationRow key={r.id} r={r} jar={jars.find((j) => j.id === r.jarId)?.title ?? ""} catalog={catalog} amount={mask(money(r.usdCents / 100))} />
                ))}
              </div>
            )}
            {loaded && <PayWithStrip catalog={catalog} used={nets} />}
          </section>
        </>
      )}
    </>
  );
}

function Kpi({ label, value, hint, loaded, className = "" }: { label: string; value: ReactNode; hint: ReactNode; loaded: boolean; className?: string }) {
  return (
    <div className={`flex min-w-0 flex-col gap-2.5 rounded-3xl bg-surface p-4 sm:p-5 ${className}`}>
      <span className="text-sm text-muted">{label}</span>
      {loaded ? (
        <>
          <p className="truncate text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{value}</p>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">{hint}</div>
        </>
      ) : (
        <span role="status" aria-label={`Loading ${label.toLowerCase()}`} className="flex flex-col gap-2.5">
          <Skeleton className="h-10 w-full max-w-28" />
          <Skeleton className="h-4 w-full max-w-36" />
        </span>
      )}
    </div>
  );
}

/** Upper end and tick step of a $ axis that reads in round numbers (0, 5, 10, 15…). */
function axis(max: number) {
  if (max <= 0) return { top: 10, step: 5 };
  const raw = max / 3;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p;
  return { top: step * Math.ceil(max / step), step };
}

const RANGES = [7, 14] as const;

/** Cumulative step line of what all jars raised over the last 7 or 14 days. */
function RaisedChart({ loaded, daily, hidden }: { loaded: boolean; daily: number[]; hidden: boolean }) {
  const [range, setRange] = useState<(typeof RANGES)[number]>(14);
  const [hover, setHover] = useState<number | null>(null);
  const days = daily.slice(-range).map((c) => c / 100);
  const n = days.length;
  const cum = days.reduce<number[]>((a, v) => [...a, (a.at(-1) ?? 0) + v], []);
  const total = cum.at(-1) ?? 0;
  const { top, step } = axis(total);
  // plot coordinates in a 600×180 box: $0 sits at y=170, the axis top at y=10
  const y = (v: number) => 170 - (v / top) * 160;
  const x = (i: number) => (i / n) * 600;
  const line = `M0 170${cum.map((v, i) => `H${x(i)}V${y(v)}`).join("")}H600`;
  // bucket i is the 24 h that ended (n-1-i) days ago
  const dayOf = (i: number) => dayLabel(n - 1 - i);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, k) => k * step);
  const fmt = (v: number) => (hidden ? "••" : money(v, step < 1 ? 2 : 0));
  const at = hover ?? (n ? n - 1 : null);
  const pick = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover(Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n))));
  };

  return (
    <div className="flex min-w-0 flex-[2_1_440px] flex-col gap-4 rounded-3xl bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Raised over time</h2>
          <p className="text-sm text-muted">Cumulative, all jars · last {range} days</p>
        </div>
        <div role="group" aria-label="Range" className="flex gap-1 rounded-full bg-panel p-1">
          {RANGES.map((d) => (
            <button key={d} type="button" aria-pressed={range === d} onClick={() => { setRange(d); setHover(null); }}
              className={`h-8 rounded-full px-3.5 text-sm ${range === d ? "bg-surface-2 text-text" : "text-muted hover:text-text"}`}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {!loaded ? (
        <Skeleton className="h-[200px] w-full rounded-2xl" />
      ) : (
        <div className="flex gap-3 pb-6">
          <div className="relative h-[200px] w-10 shrink-0 text-right text-xs text-muted">
            {ticks.map((t) => (
              <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${(y(t) / 180) * 100}%` }}>{fmt(t)}</span>
            ))}
          </div>
          <div className="relative h-[200px] min-w-0 flex-1 touch-pan-y" onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setHover(null)}>
            <svg width="100%" height="200" viewBox="0 0 600 180" preserveAspectRatio="none" role="img"
              aria-label={`Raised over the last ${range} days: ${hidden ? "amounts hidden" : money(total)}`}>
              {ticks.slice(1).map((t) => (
                <path key={t} d={`M0 ${y(t)}H600`} className="stroke-line" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              ))}
              <path d="M0 170H600" className="stroke-muted/50" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              {n > 0 && (
                <>
                  <path d={`${line}V170Z`} className="fill-accent/12" />
                  <path d={line} fill="none" className="stroke-accent" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                </>
              )}
              {hover !== null && <path d={`M${x(hover + 0.5)} 10V170`} className="stroke-muted/60" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
            </svg>
            {total === 0 && (
              <p className="absolute inset-x-0 top-1/3 text-center text-sm text-muted">No donations in the last {range} days</p>
            )}
            {at !== null && total > 0 && (() => {
              const left = ((at + 0.5) / n) * 100;
              const top = (y(cum[at]!) / 180) * 100;
              return (
                <>
                  <span className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-[3px] ring-surface" style={{ left: `${left}%`, top: `${top}%` }} />
                  <span className={`pointer-events-none absolute whitespace-nowrap rounded-xl border border-line bg-surface-2 px-2.5 py-1.5 text-xs ${left > 55 ? "-translate-x-full" : ""}`}
                    style={{ left: `calc(${left}% ${left > 55 ? "- 12px" : "+ 12px"})`, top: `max(0px, calc(${top}% - 44px))` }}>
                    <b className="font-semibold">{hidden ? "••••" : money(cum[at]!)}</b>
                    <span className="text-muted"> · {dayOf(at)}{days[at]! > 0 && !hidden ? ` · +${money(days[at]!)}` : ""}</span>
                  </span>
                </>
              );
            })()}
            <div className="absolute inset-x-0 -bottom-6 flex justify-between text-xs text-muted">
              <span>{n ? dayOf(0) : ""}</span>
              <span>{n > 2 ? dayOf(Math.floor(n / 2)) : ""}</span>
              <span>Today</span>
            </div>
          </div>
          <table className="sr-only">
            <caption>Raised per day, last {range} days</caption>
            <tbody>
              {days.map((v, i) => (
                <tr key={i}><th>{dayOf(i)}</th><td>{hidden ? "hidden" : money(v)}</td><td>{hidden ? "hidden" : money(cum[i]!)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** The first jar that isn't ready to share, as a checklist of what's left. */
function SetupCard({ jar, page, onEdit }: { jar: StudioJar; page: JarPageData; onEdit: () => void }) {
  const steps = setupSteps(jar, page);
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  const C = 2 * Math.PI * 20;
  return (
    <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-3.5 rounded-3xl border border-amber-400/35 bg-surface p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-amber-300">Finish setup</p>
          <h2 className="mt-0.5 text-lg font-semibold">“{jar.title}” isn&apos;t ready to share</h2>
        </div>
        <svg width="48" height="48" viewBox="0 0 48 48" role="img" aria-label={`${done} of ${steps.length} steps done`} className="shrink-0">
          <circle cx="24" cy="24" r="20" fill="none" className="stroke-line" strokeWidth="5" />
          <circle cx="24" cy="24" r="20" fill="none" className="stroke-amber-400" strokeWidth="5" strokeLinecap="round"
            strokeDasharray={`${(done / steps.length) * C} ${C}`} transform="rotate(-90 24 24)" />
          <text x="24" y="28.5" textAnchor="middle" fontSize="13" fontWeight="600" className="fill-text">{done}/{steps.length}</text>
        </svg>
      </div>
      <ul className="flex flex-col">
        {steps.map((s) => (
          <li key={s.label} className={`flex items-center gap-3 py-2 ${s.done ? "text-muted" : ""}`}>
            {s.done ? (
              <span className="grid size-[22px] shrink-0 place-items-center rounded-full bg-accent text-accent-ink">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" aria-hidden><path d="m5 12 5 5 9-10" /></svg>
              </span>
            ) : (
              <span className={`size-[22px] shrink-0 rounded-full border-2 ${s === next ? "border-amber-400" : "border-line"}`} />
            )}
            <span className={`flex-1 ${s.done ? "line-through" : ""}`}>{s.label}</span>
            {!s.done && s.action && (
              <button type="button" onClick={onEdit} className={`text-sm ${s === next ? "text-amber-300" : "text-muted"} hover:underline`}>{s.action}</button>
            )}
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted">Pages with a cover and a story get more donations.</p>
      <button type="button" onClick={onEdit} className="mt-auto h-11 rounded-full bg-amber-300 font-semibold text-bg">Finish setup</button>
    </div>
  );
}

function JarCard({ jar, page, mask, onOpen, onEdit, onShare }: {
  jar: StudioJar;
  page: JarPageData;
  mask: (v: string) => string;
  onOpen: () => void;
  onEdit: () => void;
  onShare: () => void;
}) {
  const r = Number(jar.raised_usd_cents) / 100;
  const goal = jar.goal_usd_cents ? Number(jar.goal_usd_cents) / 100 : null;
  const pct = goal ? (r / goal) * 100 : 0;
  const open = jar.status === "Open";
  const setup = incomplete(jar, page);
  const steps = setupSteps(jar, page);
  const badge = !open ? (
    <span className="rounded-full bg-black/60 px-2.5 py-1 text-xs text-muted">Closed</span>
  ) : setup ? (
    <span className="rounded-full bg-amber-400/15 px-2.5 py-1 text-xs font-medium text-amber-300">Setup · {steps.filter((s) => s.done).length}/{steps.length}</span>
  ) : (
    <span className="flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs"><span className="size-[7px] rounded-full bg-accent" />Live</span>
  );
  const btn = "h-10 flex-1 rounded-full text-sm font-medium";

  return (
    <article className="flex flex-col overflow-hidden rounded-3xl bg-surface">
      {open && !hasCover(jar, page) ? (
        // no photo yet: an empty frame that leads to the editor
        <button type="button" onClick={onEdit}
          className="relative mx-2.5 mt-2.5 flex aspect-video flex-col items-center justify-center gap-2 rounded-2xl border-[1.5px] border-dashed border-line text-sm text-muted hover:border-muted">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 16-5-5-9 8" />
          </svg>
          <span className="font-medium text-amber-300">Add a cover</span>
          <span className="absolute left-2.5 top-2.5">{badge}</span>
        </button>
      ) : (
        <button type="button" onClick={onOpen} aria-label={`Open ${jar.title}`} className="relative block">
          <JarCover page={page} legacyImage={jar.image_url} className="aspect-video w-full" />
          <span className="absolute left-3 top-3">{badge}</span>
        </button>
      )}
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <button type="button" onClick={onOpen} className="min-w-0 truncate text-left text-[17px] font-semibold hover:underline">{jar.title}</button>
          <span className="shrink-0 text-sm text-muted">{plural(jar.donations_count, "supporter")}</span>
        </div>
        <div className="mt-auto">
          <div className="flex justify-between gap-2 text-sm">
            <span className="truncate">
              <b className="font-semibold">{mask(money(r))}</b>
              <span className="text-muted"> {goal ? `of ${money(goal, 0)}` : "raised"}</span>
            </span>
            {goal && <span className="shrink-0 text-muted">{mask(`${pct > 0 && pct < 1 ? pct.toFixed(2) : Math.round(pct)}%`)}</span>}
          </div>
          {goal && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full min-w-1.5 rounded-full bg-accent" style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onShare} className={`${btn} border border-line hover:bg-surface-2`}>Share</button>
          {!open ? (
            <button type="button" onClick={onOpen} className={`${btn} border border-line hover:bg-surface-2`}>Details</button>
          ) : setup ? (
            <button type="button" onClick={onEdit} className={`${btn} bg-amber-300 font-semibold text-bg`}>Finish setup</button>
          ) : (
            <button type="button" onClick={onEdit} className={`${btn} border border-line hover:bg-surface-2`}>Edit</button>
          )}
        </div>
      </div>
    </article>
  );
}

function DonationRow({ r, jar, catalog, amount }: { r: Recent; jar: string; catalog: StudioCatalog; amount: string }) {
  const chain = catalog.chains.find((c) => c.chain === r.sourceChain);
  const chainName = chain?.label ?? NETWORK_NAMES[r.sourceChain] ?? r.sourceChain;
  const token = catalog.tokens[`${r.sourceChain}|${r.sourceSymbol}`];
  return (
    <div className="flex items-center gap-3.5 py-3.5">
      <span className="relative shrink-0">
        <Icon src={token || chain?.icon} alt={r.sourceSymbol} size={40} />
        {chain?.icon && token && token !== chain.icon && (
          <span className="absolute -bottom-1 -right-1 rounded-full ring-2 ring-surface">
            <Icon src={chain.icon} alt={chainName} size={18} />
          </span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          {r.name ?? "Anonymous"} {jar && <span className="font-normal text-muted">→ {jar}</span>}
        </p>
        {r.message && <p className="break-words text-sm">“{r.message}”</p>}
        <p className="text-sm text-muted">{r.sourceSymbol} on {chainName} · {ago(r.at)}</p>
      </div>
      {isRecent(r.at, DAY) && <span className="hidden rounded-full bg-accent/12 px-2 py-0.5 text-xs text-accent sm:inline">New</span>}
      <span className="min-w-16 shrink-0 text-right font-semibold">{amount}</span>
    </div>
  );
}

/** The networks no donor has used yet, as a reminder of what the jar accepts. */
function PayWithStrip({ catalog, used }: { catalog: StudioCatalog; used: string[] }) {
  const rest = catalog.chains.filter((c) => !used.includes(c.chain));
  if (rest.length === 0) return null;
  const named = rest.slice(0, 3).map((c) => c.label);
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-2.5 rounded-2xl bg-surface-2/60 px-4 py-3.5 text-sm text-muted">
      Donors can also pay from
      <span className="flex">
        {rest.slice(0, 5).map((c, i) => (
          <span key={c.chain} className={`rounded-full ring-2 ring-surface-2 ${i ? "-ml-1.5" : ""}`}>
            <Icon src={c.icon} alt={c.label} size={22} />
          </span>
        ))}
      </span>
      {named.join(", ")}
      {rest.length > named.length ? ` and ${rest.length - named.length} more networks` : ""} — via NEAR Intents.
    </div>
  );
}
