"use client";

import { useState } from "react";
import type { JarPageData, LinkKind, Milestone } from "@/lib/pageData";
import { LinkIcon } from "./LinkIcon";
import { ShareModal } from "./ShareModal";
import { Icon, PillTabs, ago, money } from "./ui";

export interface SupporterRow {
  id: string;
  name: string | null;
  message: string | null;
  usdCents: number;
  sourceSymbol: string;
  chainLabel: string;
  chainIcon: string;
  icon: string;
  at: number;
}

// rows the Supporters list shows before "Show all"
const SHOWN = 5;

const box = "rounded-[22px] border border-line/70 bg-panel";

/** "Live" on open jars, "Closed" otherwise; the long form sits above the title on desktop. */
export function StatusChip({ open, long = false, className = "" }: { open: boolean; long?: boolean; className?: string }) {
  return (
    <span className={`items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${open ? "text-accent" : "text-muted"} ${className}`}>
      <span aria-hidden>●</span>
      {open ? (long ? "Live · accepting donations" : "Live") : "Closed"}
    </span>
  );
}

/** The latest donation, one line, right under the stats. */
export function JustGave({ row }: { row: SupporterRow }) {
  // "just" only within the day; an older gift reads as plain "gave"
  const when = ago(row.at);
  const fresh = !when.endsWith(" d ago");
  return (
    <div className="flex items-center gap-2.5 rounded-2xl border border-accent/25 bg-accent/[0.08] px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
      <Icon src={row.icon} alt={row.sourceSymbol} size={30} />
      <p className="min-w-0 flex-1 truncate text-[13px] sm:text-sm">
        <b className="font-semibold">{row.name ?? "Someone"}</b> {fresh ? "just gave" : "gave"}{" "}
        <b className="font-semibold text-accent">{money(row.usdCents / 100)}</b> in {row.sourceSymbol}
        {row.message && <> · “{row.message}”</>}
      </p>
      <span className="shrink-0 text-xs text-muted">{when}</span>
    </div>
  );
}

/** One figure over its label; the row stretches them evenly. */
export function Stat({ value, label, size = "lg" }: { value: string; label: string; size?: "sm" | "lg" }) {
  return (
    <div className={`min-w-0 flex-1 border border-line/70 bg-panel ${size === "lg" ? "rounded-[18px] px-4 py-3.5" : "rounded-2xl px-3 py-2.5"}`}>
      <p className={`truncate font-bold ${size === "lg" ? "text-2xl" : "text-lg"}`}>{value}</p>
      <p className={`truncate text-muted ${size === "lg" ? "mt-0.5 text-[13px]" : "text-xs"}`}>{label}</p>
    </div>
  );
}

const LINK_KINDS: LinkKind[] = ["website", "x", "telegram", "youtube"];
const LINK_LABEL: Record<LinkKind, string> = { website: "Website", x: "X", telegram: "Telegram", youtube: "YouTube" };

/** What a link pill reads: the site's host, the X handle, else the network's name. */
function linkText(kind: LinkKind, href: string): string {
  try {
    const u = new URL(href);
    if (kind === "website") return u.hostname.replace(/^www\./, "");
    const handle = u.pathname.split("/").filter(Boolean)[0];
    if (kind === "x" && handle) return `@${handle}`;
  } catch {
    // stored links are normalized, but a label beats a crash
  }
  return LINK_LABEL[kind];
}

function ShareButton({ path, title, raisedUsd, className }: { path: string; title: string; raisedUsd: number; className: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        Share
      </button>
      {open && <ShareModal path={path} title={title} raisedUsd={raisedUsd} onClose={() => setOpen(false)} />}
    </>
  );
}

type ShareProps = { sharePath: string; title: string; raisedUsd: number };

/** Phones: round icon links and Share, above About. */
export function JarLinkRow({ links, ...share }: { links: JarPageData["links"] } & ShareProps) {
  return (
    <div className="flex items-center gap-2">
      {LINK_KINDS.filter((k) => links[k]).map((k) => (
        <a key={k} href={links[k]} target="_blank" rel="noopener nofollow ugc" aria-label={LINK_LABEL[k]}
          className="grid size-11 place-items-center rounded-full bg-surface text-text/90 hover:bg-surface-2">
          <LinkIcon kind={k} size={18} />
        </a>
      ))}
      <ShareButton path={share.sharePath} title={share.title} raisedUsd={share.raisedUsd}
        className="ml-auto h-11 rounded-full border border-line px-4 text-sm font-medium hover:bg-surface" />
    </div>
  );
}

/** The story, the links as labelled pills (desktop) and the milestones. */
export function JarAbout({ story, links, milestones, raisedUsd, ...share }: { story: string; links: JarPageData["links"]; milestones: Milestone[] } & ShareProps) {
  const pill = "inline-flex items-center gap-2 rounded-full border border-line px-3.5 py-2 text-sm text-text/85 hover:bg-surface hover:text-text";
  return (
    <section className="flex flex-col gap-3 pt-1.5 lg:gap-5 lg:pt-2">
      <h2 className="text-xl font-semibold tracking-tight lg:text-[22px]">About</h2>
      {story ? (
        <p className="whitespace-pre-line break-words leading-relaxed text-text/90 lg:text-[19px] lg:leading-[1.65]">{story}</p>
      ) : (
        <p className="text-muted">The creator hasn&apos;t written a story yet.</p>
      )}
      <div className="hidden flex-wrap gap-2 lg:flex">
        {LINK_KINDS.filter((k) => links[k]).map((k) => (
          <a key={k} href={links[k]} target="_blank" rel="noopener nofollow ugc" className={pill}>
            <LinkIcon kind={k} size={15} />
            {linkText(k, links[k]!)}
          </a>
        ))}
        <ShareButton path={share.sharePath} title={share.title} raisedUsd={raisedUsd} className={`${pill} font-medium`} />
      </div>
      {milestones.length > 0 && (
        <div className="flex flex-col gap-3 pt-2">
          <h3 className="text-sm font-medium text-muted">What the money does</h3>
          <div className={`flex flex-col divide-y divide-line/70 overflow-hidden ${box}`}>
            {milestones.map((m) => {
              const reached = raisedUsd >= m.usd;
              return (
                <div key={`${m.usd}-${m.label}`} className="flex items-center gap-3 px-4 py-3.5">
                  <span className={`grid size-6 shrink-0 place-items-center rounded-full text-xs ${reached ? "bg-accent text-accent-ink" : "border-2 border-line"}`}>{reached ? "✓" : ""}</span>
                  <span className={`flex-1 ${reached ? "text-muted line-through decoration-line" : ""}`}>{m.label}</span>
                  <span className="font-mono text-sm text-muted">{money(m.usd, 0)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function SupporterAvatar({ row }: { row: SupporterRow }) {
  return (
    <span className="relative grid size-[38px] shrink-0 place-items-center rounded-full bg-surface-2 font-semibold sm:size-10">
      {/* by code point, so a name that starts with an emoji keeps it whole */}
      {Array.from(row.name ?? "Anonymous")[0]}
      <span className="absolute -bottom-1 -right-1 rounded-full ring-2 ring-panel">
        <Icon src={row.chainIcon} alt={row.chainLabel} size={16} />
      </span>
    </span>
  );
}

/** Everyone who gave, latest or largest first, with the largest marked. */
export function JarSupporters({ rows, count, open }: { rows: SupporterRow[]; count: number; open: boolean }) {
  const [sort, setSort] = useState<"latest" | "top">("latest");
  const [all, setAll] = useState(false);
  // marked only when one gift is larger than every other; a tie has no top supporter
  const max = Math.max(...rows.map((r) => r.usdCents));
  const top = rows.filter((r) => r.usdCents === max).length === 1 && rows.length > 1 ? rows.find((r) => r.usdCents === max) : undefined;
  const sorted = sort === "top" ? [...rows].sort((a, b) => b.usdCents - a.usdCents) : rows;
  const shown = all ? sorted : sorted.slice(0, SHOWN);

  return (
    <section className="flex flex-col gap-3 pt-1.5 lg:gap-3.5 lg:pt-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-semibold tracking-tight lg:text-[22px]">
          Supporters <span className="font-normal text-muted">{count}</span>
        </h2>
        {rows.length > 1 && (
          <PillTabs value={sort} onChange={setSort} tabs={[{ id: "latest", label: "Latest" }, { id: "top", label: "Top" }]} />
        )}
      </div>

      {rows.length === 0 ? (
        <div className={`flex flex-col items-start gap-3 px-5 py-6 ${box}`}>
          <p className="text-lg font-semibold">Be the first supporter</p>
          <p className="text-muted">Your name and a few words show up here, next to what you gave.</p>
          {open && (
            <button type="button" onClick={() => document.getElementById("donate")?.scrollIntoView({ behavior: "smooth" })}
              className="rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-ink lg:hidden">
              Donate from any chain
            </button>
          )}
        </div>
      ) : (
        <div className={`flex flex-col divide-y divide-line/70 overflow-hidden ${box}`}>
          {shown.map((r) => (
            <div key={r.id} className="flex items-start gap-3 p-3.5 sm:gap-3.5 sm:px-[18px] sm:py-4">
              <SupporterAvatar row={r} />
              <div className="flex min-w-0 flex-1 flex-col">
                <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-medium">
                  <span className="min-w-0 truncate">{r.name ?? "Anonymous"}</span>
                  {r.id === top?.id && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-normal text-accent">Top supporter</span>}
                </p>
                {r.message && <p className="mt-0.5 whitespace-pre-line break-words text-[15px] text-text/85 sm:text-base">“{r.message}”</p>}
                <p className="mt-1 text-xs text-muted">
                  {r.sourceSymbol} on {r.chainLabel} · {ago(r.at)}
                </p>
              </div>
              <span className="shrink-0 font-bold sm:text-[17px]">{money(r.usdCents / 100)}</span>
            </div>
          ))}
        </div>
      )}

      {!all && rows.length > SHOWN && (
        <button type="button" onClick={() => setAll(true)}
          className="h-12 rounded-full border border-line text-[15px] hover:bg-surface lg:h-auto lg:self-start lg:px-[18px] lg:py-2.5 lg:text-sm">
          Show all {rows.length} supporters
        </button>
      )}
    </section>
  );
}

/** Desktop donate card footer: the latest givers' networks and "Marta and 36 others chipped in". */
export function ChippedIn({ rows, count }: { rows: SupporterRow[]; count: number }) {
  const first = rows[0];
  if (!first) return null;
  const others = Math.max(count, rows.length) - 1;
  return (
    <div className="hidden items-center gap-2.5 pt-1 lg:flex">
      <span className="flex">
        {rows.slice(0, 4).map((r, i) => (
          <span key={r.id} className={`rounded-full ring-2 ring-panel ${i ? "-ml-2" : ""}`}>
            <Icon src={r.chainIcon} alt="" size={26} />
          </span>
        ))}
      </span>
      <span className="text-[13px] text-muted">
        {first.name ?? "Someone"}
        {others > 0 && ` and ${others} other${others === 1 ? "" : "s"}`} chipped in
      </span>
    </div>
  );
}
