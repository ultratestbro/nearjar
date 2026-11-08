"use client";

import { useState } from "react";
import { addProposalArgs, DAO_CALL_GAS as GAS, daoLabel, soloText, spendShort, spendText, trezuTemplate, trezuUrl, type Governance } from "@/lib/daoPolicy";
import { ListCard } from "./ui";

/** A treasury building: marks a jar that pays a DAO instead of a person. */
export function DaoMark({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`shrink-0 ${className}`}>
      <path d="M3 9.5 12 4l9 5.5" />
      <path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8" />
      <path d="M3 20.5h18" />
    </svg>
  );
}

export function CopyButton({ value, label = "Copy", className = "px-3 py-1 text-xs" }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className={`btn-tactile shrink-0 hover:bg-line ${className}`}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

/**
 * "9 members · Spending: 3 of 9 approvals", quiet and kept whole when the line wraps; the full rule
 * and any one-member warning sit in the tooltip. Only a key that spends without a proposal is loud:
 * it stops donations.
 */
export function GovernanceText({ governance, intentsKeys }: { governance: Governance; intentsKeys: number }) {
  if (intentsKeys > 0) {
    return (
      <span className="whitespace-nowrap text-amber-300" title="A key on NEAR Intents can spend this treasury without a proposal, so NearJar doesn't send donations to it">
        Donations paused
      </span>
    );
  }
  const members = `${governance.members} member${governance.members === 1 ? "" : "s"}`;
  const extra = governance.solo === "rules" ? "Rules: 1 approval" : governance.solo === "unsized" ? "Token-weighted votes" : null;
  return (
    <span className="text-muted" title={[members, spendText(governance), soloText(governance)].filter(Boolean).join(" · ")}>
      <span className="whitespace-nowrap">{members}</span> · <span className="whitespace-nowrap">{spendShort(governance)}</span>
      {extra && (
        <>
          {" "}· <span className="whitespace-nowrap">{extra}</span>
        </>
      )}
    </span>
  );
}

/**
 * The jar page's line under the title: which treasury gets the money (the full id, since the
 * creator picks the name), who decides over it, and whether the DAO itself said yes.
 */
export function DaoPayoutLine({
  dao,
  endorsed,
  governance,
  intentsKeys,
  className = "",
}: {
  dao: string;
  endorsed: boolean;
  /** From the DAO's policy now; null when it couldn't be read (nothing is claimed then). */
  governance: Governance | null;
  intentsKeys: number | null;
  className?: string;
}) {
  return (
    <div className={`flex w-fit max-w-full flex-col gap-1 rounded-2xl border border-line/70 bg-bg/70 px-3 py-2 text-sm backdrop-blur ${className}`}>
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
        <DaoMark size={18} className="text-accent" />
        <span>
          Donations go to the <b className="font-semibold">{daoLabel(dao)}</b> treasury
        </span>
        <span className="min-w-0 truncate font-mono text-xs text-muted">{dao}</span>
      </span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {endorsed ? <span className="whitespace-nowrap text-accent">Endorsed by the DAO ✓</span> : <span className="whitespace-nowrap text-amber-300">Not endorsed by the DAO yet</span>}
        {governance && intentsKeys !== null && <GovernanceText governance={governance} intentsKeys={intentsKeys} />}
        <a href={trezuUrl(dao)} target="_blank" rel="noreferrer" className="whitespace-nowrap text-muted underline decoration-line underline-offset-4 hover:text-text">
          View in Trezu ↗
        </a>
      </span>
    </div>
  );
}

/**
 * Studio, a DAO jar: whether the DAO endorsed it and how it does so, a FunctionCall proposal on
 * the NearJar contract pinned to the jar's revision (an edit after filing makes it fail rather
 * than endorse unseen content). The same kind of proposal with `dao_close_jar` is the DAO's stop button.
 */
export function DaoEndorse({ dao, endorsed, jarId, revision, contract }: { dao: string; endorsed: boolean; jarId: string; revision: string; contract: string }) {
  const args = JSON.stringify({ jar_id: jarId, revision });
  const closeArgs = JSON.stringify({ jar_id: jarId });
  return (
    <section className="flex flex-col gap-4 rounded-2xl bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-2 text-accent">
            <DaoMark />
          </span>
          <div className="min-w-0">
            <p className="font-semibold">Pays the {daoLabel(dao)} treasury</p>
            <p className="truncate font-mono text-xs text-muted">{dao}</p>
          </div>
        </div>
        {endorsed ? (
          <span className="rounded-full bg-accent/15 px-3 py-1 text-sm font-medium text-accent">Endorsed by the DAO ✓</span>
        ) : (
          <span className="rounded-full bg-amber-400/15 px-3 py-1 text-sm font-medium text-amber-300">Not endorsed yet</span>
        )}
      </div>
      <p className="text-sm text-muted">
        Donations land in the DAO&apos;s NEAR Intents balance. Members see them in Trezu and spend them by proposal, and the payout can&apos;t be changed.
        {endorsed
          ? " Editing the jar clears the endorsement: the DAO endorses each version its members have seen."
          : " Every edit starts a new revision, and the DAO endorses one revision."}
      </p>

      {!endorsed && (
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            Ask the DAO to endorse revision {revision}, so donors see that the treasury itself stands behind the jar: a member files a function-call request with
            these values and the DAO approves it. Both arguments are strings.
          </p>
          <ListCard>
            <CallRow label="Contract" value={contract} />
            <CallRow label="Method" value="endorse_jar" />
            <CallRow label="Arguments" value={args} />
            <CallRow label="Deposit" value="0" shown="0 NEAR" />
            <CallRow label="Gas" value={GAS} shown="30 Tgas" />
          </ListCard>
          <p className="text-xs text-muted">
            In Trezu: Settings → Developer → enable Custom Requests (once per treasury, by a member who can change its policy), then add a request template in
            code mode with the template below and file the request from it. With near-cli: call <span className="font-mono text-text">add_proposal</span> on{" "}
            <span className="font-mono text-text">{dao}</span> with the proposal JSON and the DAO&apos;s proposal bond attached.
          </p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <a href={trezuUrl(dao)} target="_blank" rel="noreferrer" className="btn-tactile-accent px-4 py-2 text-sm">
          Open {daoLabel(dao)} in Trezu ↗
        </a>
        {!endorsed && (
          <>
            <CopyButton value={trezuTemplate(contract, "endorse_jar", jarId, revision)} label="Copy Trezu template" className="px-4 py-2 text-sm" />
            <CopyButton
              value={addProposalArgs(contract, "endorse_jar", args, `Endorse NearJar jar #${jarId} (revision ${revision})`)}
              label="Copy near-cli proposal"
              className="px-4 py-2 text-sm"
            />
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <p>
          The DAO&apos;s stop button: method <span className="font-mono text-text">dao_close_jar</span> with{" "}
          <span className="font-mono text-text">{closeArgs}</span> closes the jar. Only this DAO can call either method.
        </p>
        <CopyButton value={trezuTemplate(contract, "dao_close_jar", jarId, revision)} label="Copy close template" />
      </div>
    </section>
  );
}

function CallRow({ label, value, shown }: { label: string; value: string; shown?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <span className="shrink-0 text-sm text-muted">{label}</span>
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate font-mono text-sm">{shown ?? value}</span>
        <CopyButton value={value} />
      </span>
    </div>
  );
}
