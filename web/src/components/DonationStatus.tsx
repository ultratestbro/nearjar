"use client";

import { useEffect, useState, type ReactNode } from "react";
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
    { label: "Sent from your wallet", hint: "", state: d.sourceTx ? "done" : "active" },
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

export function DonationStatus({
  initial,
  receive,
  etaSeconds,
  thanks,
  sharePath,
  jarTitle,
  onAgain,
  art,
}: {
  initial: PublicDonation;
  receive: ReceiveAsset;
  etaSeconds?: number;
  /** The creator's note, shown once the donation lands. */
  thanks?: string;
  sharePath?: string;
  jarTitle?: string;
  onAgain?: (deliveredUsd: number) => void;
  /** Logos for the route strip: the token paid with, its network, and the token the creator gets. */
  art?: { icon: string; chainIcon: string; chainLabel: string; receiveIcon: string };
}) {
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
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
  const seen = d.status !== "awaiting_deposit";
  const spent = now - startedAt;
  const eta = etaSeconds ? etaSeconds * 1000 : 0;
  const usd = `$${(d.usdCents / 100).toFixed(2)}`;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{done ? "Thank you!" : bad ? "Donation didn't go through" : "Donation on its way"}</h2>
        <p className={`text-sm ${done ? "text-accent" : bad ? "text-danger" : "text-muted"}`}>
          {done && jarTitle ? `${usd} landed in ${jarTitle}` : LABEL[d.status]}
        </p>
      </div>

      {/* the route at a glance: your token → NEAR Intents → the creator's near.com balance */}
      <div className="flex items-start rounded-2xl bg-bg px-3 py-4 text-xs">
        <Node
          icon={
            <span className="relative">
              <Logo src={art?.icon} alt={d.sourceSymbol} />
              {art?.chainIcon && art.chainIcon !== art.icon && (
                <img src={art.chainIcon} alt="" className="absolute -bottom-0.5 -right-0.5 size-4 rounded-full ring-2 ring-panel" />
              )}
            </span>
          }
          title={`${usd} ${d.sourceSymbol}`}
          sub={art?.chainLabel ?? "your wallet"}
        />
        <Track state={seen ? (bad && d.status === "expired" ? "failed" : "done") : d.status === "expired" ? "failed" : "moving"} />
        <Node icon={<span className="grid size-9 place-items-center rounded-full bg-text text-sm font-semibold text-bg">N</span>} title="NEAR Intents" sub="swap + route" />
        <Track state={done ? "done" : bad && seen ? "failed" : seen ? "moving" : "idle"} />
        <Node
          icon={
            <span className="relative">
              <Logo src={art?.receiveIcon} alt={receive.symbol} />
              {done && <span className="absolute -bottom-1 -right-1 grid size-4 place-items-center rounded-full bg-accent text-[9px] text-accent-ink ring-2 ring-panel">✓</span>}
            </span>
          }
          title={receive.symbol}
          sub="near.com"
        />
      </div>

      {done && thanks && (
        <figure className="rounded-2xl bg-accent/10 p-4">
          <p className="text-xs text-accent">A note from the creator</p>
          <blockquote className="mt-1 whitespace-pre-line">{thanks}</blockquote>
        </figure>
      )}

      {/* once it lands the route strip already shows every leg done */}
      {!done && <ol className="flex flex-col">
        {steps(d, receive).map((s, i, all) => (
          <li key={s.label} className="flex gap-3">
            <div className="flex flex-col items-center">
              <StepIcon state={s.state} />
              {i < all.length - 1 && <span className={`my-1 w-px flex-1 ${s.state === "done" ? "bg-accent/60" : "bg-line"}`} />}
            </div>
            <div className="flex flex-col pb-4">
              <span className={s.state === "todo" ? "text-muted" : s.state === "failed" ? "text-danger" : s.state === "active" ? "font-medium text-text" : "text-text"}>{s.label}</span>
              {s.hint && <span className="text-xs text-muted">{s.hint}</span>}
              {i === 0 && d.sourceTx && <TxLink chain={d.sourceChain} hash={d.sourceTx} className="text-xs" />}
            </div>
          </li>
        ))}
      </ol>}
      {!TERMINAL.has(d.status) && (
        <div className="-mt-2 flex flex-col gap-1.5">
          {eta > 0 && (
            <div className="h-1 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-accent transition-[width] duration-1000 ease-linear" style={{ width: `${Math.min(95, (spent / eta) * 100)}%` }} />
            </div>
          )}
          <p className="text-sm text-muted">
            {elapsed(spent)}
            {eta > 0 && (spent > eta * 1.5 ? " · taking longer than usual, your money is safe" : ` · usually ~${Math.max(1, Math.round(etaSeconds! / 60))} min`)}
          </p>
        </div>
      )}

      <dl className="flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line text-sm">
        <Row label="Amount">${(d.usdCents / 100).toFixed(2)} in {d.sourceSymbol}</Row>
        {d.amountOut && <Row label="Creator got">{fmt(d.amountOut, receive.decimals)} {receive.symbol}</Row>}
        {d.deliveryTx && <Row label="Delivery"><TxLink chain="near:mainnet" hash={d.deliveryTx} /></Row>}
        {d.recordedTx && d.recordedTx !== "already-recorded" && <Row label="Jar receipt"><span className="font-mono">{short(d.recordedTx)}</span></Row>}
      </dl>

      {done && (onAgain || sharePath) && (
        <div className="grid grid-cols-2 gap-2">
          {sharePath && (
            <button
              type="button"
              onClick={() => {
                const url = `${window.location.origin}${sharePath}`;
                if (navigator.share) void navigator.share({ title: jarTitle ?? "NearJar", url }).catch(() => {});
                else {
                  void navigator.clipboard.writeText(url);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }
              }}
              className="btn-tactile justify-center px-4 py-3 text-sm font-medium"
            >
              {copied ? "Link copied" : "Share the jar"}
            </button>
          )}
          {onAgain && (
            <button type="button" onClick={() => onAgain((d.usdCents ?? 0) / 100)} className="btn-tactile-accent justify-center px-4 py-3 text-sm">
              Give again
            </button>
          )}
        </div>
      )}
      {bad && onAgain && (
        <button type="button" onClick={() => onAgain(0)} className="btn-tactile justify-center px-4 py-3 text-sm font-medium">
          Try again
        </button>
      )}
      {!TERMINAL.has(d.status) && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-line px-4 py-3">
          <p className="text-xs text-muted">Safe to close: the donation keeps going. Its status link opens it again.</p>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(`${window.location.origin}/d/${d.id}`);
              setLinkCopied(true);
              setTimeout(() => setLinkCopied(false), 1500);
            }}
            className="btn-tactile shrink-0 px-3 py-1.5 text-xs font-medium"
          >
            {linkCopied ? "Copied" : "Copy link"}
          </button>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right">{children}</dd>
    </div>
  );
}

function StepIcon({ state }: { state: StepState }) {
  if (state === "active")
    return <span aria-label="in progress" className="size-5 shrink-0 animate-spin rounded-full border-2 border-line border-t-accent" />;
  if (state === "done")
    return <span aria-label="done" className="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-xs text-accent-ink">✓</span>;
  if (state === "failed")
    return <span aria-label="failed" className="grid size-5 shrink-0 place-items-center rounded-full bg-danger text-xs text-bg">!</span>;
  return <span aria-hidden className="size-5 shrink-0 rounded-full border-2 border-line" />;
}

function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function TxLink({ chain, hash, className = "" }: { chain: string; hash: string; className?: string }) {
  const base = EXPLORERS[chain];
  return base ? (
    <a className={`font-mono text-muted underline decoration-line underline-offset-2 hover:text-text ${className}`} href={base + hash} target="_blank" rel="noreferrer" title={hash}>
      {short(hash)} ↗
    </a>
  ) : (
    <span className={`font-mono text-muted ${className}`} title={hash}>{short(hash)}</span>
  );
}

/** "0x68771450d2…" → "0x6877…3f95": enough to recognise a hash, the full one is in the link. */
function short(hash: string): string {
  return hash.length > 16 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash;
}

function Logo({ src, alt }: { src?: string; alt: string }) {
  return src ? (
    <img src={src} alt={alt} className="size-9 rounded-full bg-surface-2" />
  ) : (
    <span className="grid size-9 place-items-center rounded-full bg-surface-2 text-sm font-semibold">{alt.slice(0, 1)}</span>
  );
}

function Node({ icon, title, sub }: { icon: ReactNode; title: string; sub: string }) {
  return (
    <div className="flex w-[30%] min-w-0 flex-col items-center gap-1.5 text-center">
      {icon}
      <span className="w-full truncate font-medium">{title}</span>
      <span className="w-full truncate text-muted">{sub}</span>
    </div>
  );
}

/** The line between two route nodes; a coin travels along it while that leg is under way. */
function Track({ state }: { state: "idle" | "moving" | "done" | "failed" }) {
  return (
    <div className="relative mt-[17px] h-0.5 min-w-4 flex-1 rounded-full bg-line">
      {state === "done" && <div className="absolute inset-0 rounded-full bg-accent" />}
      {state === "failed" && <div className="absolute inset-0 rounded-full bg-danger/70" />}
      {state === "moving" && <span className="travel absolute -top-[3px] size-2 rounded-full bg-accent shadow-[0_0_8px_var(--accent)]" />}
    </div>
  );
}

function fmt(v: string, decimals: number): string {
  const n = BigInt(v);
  const base = 10n ** BigInt(decimals);
  const frac = (n % base).toString().padStart(decimals, "0").slice(0, 6).replace(/0+$/, "");
  return frac ? `${n / base}.${frac}` : (n / base).toString();
}
