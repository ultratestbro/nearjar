"use client";

import { useState } from "react";
import type { JarPageData, Milestone } from "@/lib/pageData";
import { JarLinks } from "./JarArt";
import { Icon, ListCard, PillTabs, ago, money } from "./ui";

export interface SupporterRow {
  id: string;
  name: string | null;
  message: string | null;
  usdCents: number;
  sourceSymbol: string;
  chainLabel: string;
  icon: string;
  at: number;
}

export function JarTabs({
  story,
  milestones,
  links,
  raisedUsd,
  supporters,
  count,
}: {
  story: string;
  milestones: Milestone[];
  links: JarPageData["links"];
  raisedUsd: number;
  supporters: SupporterRow[];
  count: number;
}) {
  const [tab, setTab] = useState<"about" | "supporters">("about");
  return (
    <div className="flex flex-col gap-5">
      <PillTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "about", label: "About" },
          { id: "supporters", label: <>Supporters <span className="opacity-60">{count}</span></> },
        ]}
      />

      {tab === "about" ? (
        <div className="flex flex-col gap-6">
          {story ? <p className="whitespace-pre-line text-text/90 sm:text-lg sm:leading-relaxed">{story}</p> : <p className="text-muted">The creator hasn&apos;t written a story yet.</p>}
          <JarLinks links={links} />
          {milestones.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-medium text-muted">What the money does</h2>
              <ListCard>
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
              </ListCard>
            </div>
          )}
        </div>
      ) : supporters.length === 0 ? (
        <p className="text-muted">No donations yet. Be the first.</p>
      ) : (
        <ListCard>
          {supporters.map((f) => (
            <div key={f.id} className="flex items-start gap-3 px-4 py-3.5">
              <Icon src={f.icon} alt={f.sourceSymbol} size={32} />
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-medium">{f.name ?? "Anonymous"}</span>
                  <span className="shrink-0 font-semibold">{money(f.usdCents / 100)}</span>
                </div>
                {f.message && <p className="whitespace-pre-line break-words text-muted">{f.message}</p>}
                <span className="text-xs text-muted">
                  {f.sourceSymbol} on {f.chainLabel} · {ago(f.at)}
                </span>
              </div>
            </div>
          ))}
        </ListCard>
      )}
    </div>
  );
}
