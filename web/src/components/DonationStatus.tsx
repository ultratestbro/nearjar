"use client";

import { useEffect, useState } from "react";
import type { ReceiveAsset } from "@/lib/assets";

export interface PublicDonation {
  id: string;
  jarId: string;
  status: "awaiting_deposit" | "processing" | "delivered" | "refunded" | "failed" | "expired";
  sourceChain: string;
  sourceSymbol: string;
  amountIn: string;
  usdCents: number;
  amountOut: string | null;
  depositAddress: string;
  sourceTx: string | null;
  deliveryTx: string | null;
  recordedTx: string | null;
}

const LABEL: Record<PublicDonation["status"], string> = {
  awaiting_deposit: "Waiting for your deposit",
  processing: "On its way to near.com",
  delivered: "Delivered to the creator's near.com balance",
  refunded: "Refunded to your wallet",
  failed: "Failed — 1Click will refund to your wallet",
  expired: "Expired — no deposit arrived",
};

const TERMINAL = new Set(["delivered", "refunded", "failed", "expired"]);

const EXPLORERS: Record<string, string> = {
  "eip155:1": "https://etherscan.io/tx/",
  "eip155:8453": "https://basescan.org/tx/",
  "eip155:42161": "https://arbiscan.io/tx/",
  "eip155:10": "https://optimistic.etherscan.io/tx/",
  "eip155:56": "https://bscscan.com/tx/",
  "eip155:137": "https://polygonscan.com/tx/",
  "eip155:43114": "https://snowtrace.io/tx/",
  "eip155:100": "https://gnosisscan.io/tx/",
  "solana:mainnet": "https://solscan.io/tx/",
  "tron:728126428": "https://tronscan.org/#/transaction/",
  "ton:-239": "https://tonviewer.com/transaction/",
  "near:mainnet": "https://nearblocks.io/txns/",
  "bitcoin:mainnet": "https://mempool.space/tx/",
  "zcash:mainnet": "https://blockchair.com/zcash/transaction/",
};

type StepState = "done" | "active" | "todo" | "failed";

/** Where the donation is, as the donor sees it: wallet → NEAR Intents → swap → near.com. */
function steps(d: PublicDonation, receive: ReceiveAsset): { label: string; hint: string; state: StepState }[] {
  const seen = d.status !== "awaiting_deposit";
  const settled = d.status === "delivered";
  const bad = d.status === "refunded" || d.status === "failed" || d.status === "expired";
  return [
    { label: "Sent from your wallet", hint: d.sourceSymbol, state: d.sourceTx ? "done" : "active" },
    {
      label: "Deposit received by NEAR Intents",
      hint: seen ? "" : "waiting for network confirmations",
      state: seen ? "done" : d.status === "expired" ? "failed" : d.sourceTx ? "active" : "todo",
    },
    {
      label: `Swapping into ${receive.symbol}`,
      hint: d.status === "refunded" ? "refunded to your wallet" : d.status === "failed" ? "1Click refunds to your wallet" : "",
      state: settled ? "done" : bad && seen ? "failed" : d.status === "processing" ? "active" : "todo",
    },
    { label: "In the creator's near.com balance", hint: "", state: settled ? "done" : "todo" },
  ];
}

export function DonationStatus({ initial, receive, etaSeconds }: { initial: PublicDonation; receive: ReceiveAsset; etaSeconds?: number }) {
  const [d, setD] = useState(initial);
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (TERMINAL.has(d.status)) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [d.status]);

  useEffect(() => {
    if (TERMINAL.has(d.status) && d.recordedTx) return;
    const t = setTimeout(async () => {
      try {
        const res = (await (await fetch(`/api/donations/${d.id}`)).json()) as { ok: boolean; donation?: PublicDonation };
        if (res.ok && res.donation) setD(res.donation);
        else setD({ ...d });
      } catch {
        setD({ ...d });
      }
    }, 5000);
    return () => clearTimeout(t);
  }, [d]);

  const done = d.status === "delivered";
  const bad = d.status === "refunded" || d.status === "failed" || d.status === "expired";
  return (
    <aside className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5">
      <h2 className="text-lg font-semibold">{done ? "Thank you!" : "Donation in progress"}</h2>
      <p className={done ? "text-accent" : bad ? "text-danger" : "text-text"}>{LABEL[d.status]}</p>
      <ol className="flex flex-col gap-3">
        {steps(d, receive).map((s) => (
          <li key={s.label} className="flex items-start gap-3">
            <StepIcon state={s.state} />
            <div className="flex flex-col">
              <span className={s.state === "todo" ? "text-muted" : s.state === "failed" ? "text-danger" : "text-text"}>{s.label}</span>
              {s.hint && <span className="text-xs text-muted">{s.hint}</span>}
            </div>
          </li>
        ))}
      </ol>
      {!TERMINAL.has(d.status) && (
        <p className="text-sm text-muted">
          {elapsed(now - startedAt)} elapsed{etaSeconds ? ` · usually ~${Math.max(1, Math.round(etaSeconds / 60))} min` : ""}
        </p>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted">Amount</dt>
        <dd className="text-right">${(d.usdCents / 100).toFixed(2)} in {d.sourceSymbol}</dd>
        {d.amountOut && (
          <>
            <dt className="text-muted">Creator got</dt>
            <dd className="text-right">{fmt(d.amountOut, receive.decimals)} {receive.symbol}</dd>
          </>
        )}
        {d.sourceTx && (
          <>
            <dt className="text-muted">Your tx</dt>
            <dd className="truncate text-right"><TxLink chain={d.sourceChain} hash={d.sourceTx} /></dd>
          </>
        )}
        {d.deliveryTx && (
          <>
            <dt className="text-muted">Delivery</dt>
            <dd className="truncate text-right"><TxLink chain="near:mainnet" hash={d.deliveryTx} /></dd>
          </>
        )}
        {d.recordedTx && d.recordedTx !== "already-recorded" && (
          <>
            <dt className="text-muted">Jar receipt</dt>
            <dd className="truncate text-right font-mono">{d.recordedTx}</dd>
          </>
        )}
      </dl>
      {!TERMINAL.has(d.status) && (
        <p className="text-xs text-muted">
          This updates by itself. You can close it — the donation continues;{" "}
          <a className="underline" href={`/d/${d.id}`}>this link</a> shows its status later.
        </p>
      )}
    </aside>
  );
}

function StepIcon({ state }: { state: StepState }) {
  if (state === "active")
    return <span aria-label="in progress" className="mt-0.5 size-5 shrink-0 animate-spin rounded-full border-2 border-line border-t-accent" />;
  if (state === "done")
    return <span aria-label="done" className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-accent text-xs text-accent-ink">✓</span>;
  if (state === "failed")
    return <span aria-label="failed" className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-danger text-xs text-bg">!</span>;
  return <span aria-hidden className="mt-0.5 size-5 shrink-0 rounded-full border-2 border-line" />;
}

function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function TxLink({ chain, hash }: { chain: string; hash: string }) {
  const base = EXPLORERS[chain];
  return base ? (
    <a className="font-mono underline" href={base + hash} target="_blank" rel="noreferrer">{hash}</a>
  ) : (
    <span className="font-mono">{hash}</span>
  );
}

function fmt(v: string, decimals: number): string {
  const n = BigInt(v);
  const base = 10n ** BigInt(decimals);
  const frac = (n % base).toString().padStart(decimals, "0").slice(0, 6).replace(/0+$/, "");
  return frac ? `${n / base}.${frac}` : (n / base).toString();
}
