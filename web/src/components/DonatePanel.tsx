"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ReceiveAsset, SourceAsset } from "@/lib/assets";
import { PAYERS, evmPayer, familyOf, solanaPayer, type PayInstruction, type Payer } from "@/lib/pay";
import { DonationStatus, type PublicDonation } from "./DonationStatus";
import { ManualDeposit } from "./ManualDeposit";
import { PayWithSheet, amountText, heldKey, type Held } from "./PayWithSheet";
import { Modal } from "./Modal";
import { Chevron, Icon, ListCard, ListRow, Progress, money, shortAccount } from "./ui";
import { useWallet } from "./WalletProvider";

// shown as tiles; every other network is in "More networks"
const POPULAR = ["eip155:8453", "eip155:1", "eip155:42161", "solana:mainnet", "tron:728126428", "ton:-239", "near:mainnet", "bitcoin:mainnet"];

const QUICK_NOTES = ["Keep going!", "Love your work", "From a fan", "Thank you"];

const TERMINAL = new Set(["delivered", "refunded", "failed", "expired"]);

/** The donation this browser started on a jar, so leaving the page doesn't lose its status. */
interface Kept {
  id: string;
  at: number;
  pay?: PayInstruction; // a manual deposit still needs the address and amount
}

const keyOf = (jarId: string) => `nearjar:donation:${jarId}`;

function readKept(jarId: string): Kept | null {
  try {
    const k = JSON.parse(localStorage.getItem(keyOf(jarId)) ?? "null") as Kept | null;
    return k && typeof k.id === "string" ? k : null;
  } catch {
    return null;
  }
}

function writeKept(jarId: string, k: Omit<Kept, "at"> | null) {
  try {
    if (k) localStorage.setItem(keyOf(jarId), JSON.stringify({ ...k, at: Date.now() }));
    else localStorage.removeItem(keyOf(jarId));
  } catch {
    // private mode: the /d/ link still works
  }
}

type Quote = {
  amountInFormatted: string;
  amountOut: string;
  minAmountOut: string;
  feeUsd: number;
  etaSeconds: number;
};

/**
 * The donate card: amount and "Pay with" → review (route, what the creator gets, connect and
 * confirm, or send it yourself) → live status with the creator's thank-you note.
 */
export function DonatePanel(props: {
  jarId: string;
  jarTitle: string;
  receive: ReceiveAsset;
  sources: SourceAsset[];
  open: boolean;
  raisedUsd: number;
  goalUsd: number | null;
  supporters: number;
  presets: number[];
  thanks: string;
  sharePath: string;
  confidential: boolean;
  /** Under the Donate button, e.g. who already chipped in. */
  footer?: ReactNode;
}) {
  const chains = useMemo(() => {
    const seen = new Map<string, { chain: string; label: string; icon: string }>();
    for (const s of props.sources) if (!seen.has(s.chain)) seen.set(s.chain, { chain: s.chain, label: s.chainLabel, icon: s.chainIcon });
    return [...seen.values()];
  }, [props.sources]);

  const presets = props.presets.length ? props.presets : [5, 10, 25, 50];
  const firstAmount = presets.includes(10) ? 10 : presets[Math.min(1, presets.length - 1)]!;
  const [step, setStep] = useState<"form" | "review">("form");
  const [usd, setUsd] = useState(String(firstAmount));
  const [chain, setChain] = useState(chains.find((c) => c.chain === "eip155:8453")?.chain ?? chains[0]?.chain ?? "");
  const tokens = props.sources.filter((s) => s.chain === chain);
  const [symbol, setSymbol] = useState("USDC");
  const token = tokens.find((t) => t.symbol === symbol) ?? tokens[0];
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [modal, setModal] = useState<"pay" | "note" | null>(null);

  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [payer, setPayer] = useState<Payer | null>(null);
  const [busy, setBusy] = useState("");
  const [donation, setDonation] = useState<PublicDonation | null>(null);
  const [manualPay, setManualPay] = useState<PayInstruction | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [refund, setRefund] = useState("");
  // delivered in this visit, so the total moves before the contract has it; a fresh total from
  // the server already includes it
  const [given, setGiven] = useState(0);
  const [seenRaised, setSeenRaised] = useState(props.raisedUsd);
  if (seenRaised !== props.raisedUsd) {
    setSeenRaised(props.raisedUsd);
    setGiven(0);
  }
  const router = useRouter();

  // Back on the jar: pick up the donation started here, and settle anyone's open donations so
  // the total doesn't wait for the donor's tab.
  useEffect(() => {
    const jarId = props.jarId;
    const kept = readKept(jarId);
    if (kept) {
      void fetch(`/api/donations/${kept.id}`)
        .then((r) => r.json() as Promise<{ ok: boolean; donation?: PublicDonation }>)
        .then((res) => {
          const d = res.ok ? res.donation : undefined;
          if (d && (!TERMINAL.has(d.status) || Date.now() - kept.at < 30 * 60_000)) {
            setDonation(d);
            if (kept.pay && d.status === "awaiting_deposit") setManualPay(kept.pay);
          } else writeKept(jarId, null);
        })
        .catch(() => {});
    }
    void post(`/api/jars/${jarId}/sync`, {})
      .then((res) => {
        if ((res as { changed?: number }).changed) router.refresh();
      })
      .catch(() => {});
  }, [props.jarId, router]);

  const usdCents = Math.round(Number(usd) * 100);
  const amountError = usdCents > 0 && usdCents < 100 ? "Minimum is $1." : usdCents > 1_000_000 ? "Maximum is $10,000." : "";
  const quotable = !!token && usdCents >= 100 && usdCents <= 1_000_000;
  const family = token ? familyOf(token.chain) : "";
  const payerDef = PAYERS[family];
  // EVM and Solana pay through the shared wallet (AppKit's modal, remembered on reload)
  const { wallet, connect, connecting, error: connectError } = useWallet();
  const shared = family === "evm" || family === "solana";
  const walletPayer = useMemo<Payer | null>(() => {
    if (!wallet) return null;
    try {
      if (wallet.evm) return evmPayer(wallet.evm, wallet.address, wallet.name);
      if (wallet.solanaSend) return solanaPayer(wallet.address, wallet.name, wallet.solanaSend);
    } catch {
      // a wallet that can sign messages but not send transactions: fall back to the picker
    }
    return null;
  }, [wallet]);
  const sharedPayer = walletPayer?.family === family ? walletPayer : null;
  const connected = shared ? sharedPayer : payer && payer.family === family ? payer : null;

  // the connected wallet's balances of every payable token, for the picker and the Pay with row
  const holder = wallet && ["evm", "solana", "near"].includes(wallet.family) ? `${wallet.family}:${wallet.address}`
    : payer?.family === "near" ? `near:${payer.address}` : "";
  const [held, setHeld] = useState<{ holder: string; map: Map<string, Held> } | null>(null);
  useEffect(() => {
    if (!holder) return;
    const i = holder.indexOf(":");
    const ctrl = new AbortController();
    fetch(`/api/balances?family=${holder.slice(0, i)}&address=${encodeURIComponent(holder.slice(i + 1))}`, { signal: ctrl.signal })
      .then((r) => r.json() as Promise<{ ok: boolean; balances?: { chain: string; symbol: string; amount: string; usd: number | null }[] }>)
      .then((res) => {
        if (res.ok && res.balances) setHeld({ holder, map: new Map(res.balances.map((b) => [heldKey(b.chain, b.symbol), { amount: b.amount, usd: b.usd }])) });
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [holder]);
  const balances = useMemo(() => (held && held.holder === holder ? held.map : new Map<string, Held>()), [held, holder]);
  const tokenHeld = token ? balances.get(heldKey(token.chain, token.symbol)) : undefined;
  // chains without a browser wallet (Zcash, Litecoin, Doge, XRP…) are paid by sending manually
  const manual = manualOpen || (!shared && !payerDef);

  // depend on strings: `token` is a fresh object every render and would restart (and abort) the quote forever
  const srcChain = token?.chain ?? "";
  const srcSymbol = token?.symbol ?? "";
  useEffect(() => {
    if (!quotable || !srcChain) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const data = (await post("/api/quote", { jarId: props.jarId, usdCents, sourceChain: srcChain, sourceSymbol: srcSymbol, dry: true }, ctrl.signal)) as {
          ok: boolean;
          quote?: Quote;
          error?: string;
        };
        if (data.ok && data.quote) setQuote(data.quote);
        else {
          setQuote(null);
          setError(data.error ?? "No route right now.");
        }
      } catch {
        if (!ctrl.signal.aborted) setError("Could not reach the quote service.");
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 400);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [props.jarId, srcChain, srcSymbol, usdCents, quotable]);

  async function onConnect() {
    if (!payerDef) return;
    setError("");
    try {
      setPayer(await payerDef.connect());
    } catch (e) {
      setError(errText(e, "Could not connect the wallet."));
    }
  }

  async function onPay() {
    if (!connected || !token) return;
    setError("");
    try {
      setBusy("Getting a fresh quote…");
      const res = (await post("/api/donations", {
        jarId: props.jarId,
        usdCents,
        sourceChain: token.chain,
        sourceSymbol: token.symbol,
        refundAddress: connected.address,
        method: "Wallet",
        name,
        message,
      })) as { ok: boolean; donation?: PublicDonation; pay?: PayInstruction; error?: string };
      if (!res.ok || !res.donation || !res.pay) throw new Error(res.error ?? "Could not start the donation.");

      setBusy(`Confirm in ${connected.label}…`);
      const txHash = await connected.pay(res.pay);
      writeKept(props.jarId, { id: res.donation.id });
      await post(`/api/donations/${res.donation.id}/submitted`, { txHash });
      setDonation({ ...res.donation, sourceTx: txHash });
    } catch (e) {
      setError(errText(e, "The payment did not go through."));
    } finally {
      setBusy("");
    }
  }

  async function onManual() {
    if (!token) return;
    setError("");
    try {
      setBusy("Getting a deposit address…");
      const res = (await post("/api/donations", {
        jarId: props.jarId,
        usdCents,
        sourceChain: token.chain,
        sourceSymbol: token.symbol,
        refundAddress: refund.trim(),
        method: "Manual",
        name,
        message,
      })) as { ok: boolean; donation?: PublicDonation; pay?: PayInstruction; error?: string };
      if (!res.ok || !res.donation || !res.pay) throw new Error(res.error ?? "Could not start the donation.");
      writeKept(props.jarId, { id: res.donation.id, pay: res.pay });
      setManualPay(res.pay);
      setDonation(res.donation);
    } catch (e) {
      setError(errText(e, "Could not start the donation."));
    } finally {
      setBusy("");
    }
  }

  function giveAgain(deliveredUsd: number) {
    writeKept(props.jarId, null);
    setGiven((g) => g + deliveredUsd);
    if (deliveredUsd) router.refresh();
    setDonation(null);
    setManualPay(null);
    setStep("form");
    setMessage("");
  }

  // phones: edge to edge, only hairlines above and below; desktop: a floating card
  const card =
    "flex flex-col gap-4 border-y border-line bg-panel px-4 py-5 lg:gap-5 lg:rounded-[28px] lg:border lg:p-6 lg:shadow-[0_24px_60px_-20px_rgba(0,0,0,0.7)]";

  if (donation) {
    return (
      <aside className={card}>
        {manualPay && (
          <ManualDeposit pay={manualPay} chainLabel={props.sources.find((s) => s.chain === manualPay.chain)?.chainLabel ?? manualPay.chain} />
        )}
        <DonationStatus
          initial={donation}
          receive={props.receive}
          {...(quote ? { etaSeconds: quote.etaSeconds } : {})}
          thanks={props.thanks}
          sharePath={props.sharePath}
          jarTitle={props.jarTitle}
          onAgain={giveAgain}
          art={donationArt(props.sources, donation, props.receive.id)}
        />
      </aside>
    );
  }

  const receiveOut = quote ? formatUnits(BigInt(quote.amountOut), props.receive.decimals) : null;
  const eta = quote ? `~${Math.max(1, Math.round(quote.etaSeconds / 60))} min` : "";

  if (step === "review" && token) {
    return (
      <aside className={card}>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setStep("form")} aria-label="Back" className="grid size-9 place-items-center rounded-full bg-surface-2 hover:bg-line">
            <Chevron dir="left" />
          </button>
          <div>
            <h2 className="text-lg font-semibold leading-tight">Review · {money(usdCents / 100)}</h2>
            <p className="text-xs text-muted">to {props.jarTitle}</p>
          </div>
        </div>

        <div className="flex items-start gap-1 rounded-2xl bg-bg p-3 text-xs">
          <RouteNode icon={<Icon src={token.icon} alt={token.symbol} size={28} />} title={token.symbol} sub={token.chainLabel} />
          <RouteArrow />
          <RouteNode icon={<span className="grid size-7 place-items-center rounded-full bg-text font-semibold text-bg">N</span>} title="NEAR Intents" sub="swap + route" />
          <RouteArrow />
          <RouteNode icon={<span className="grid size-7 place-items-center rounded-full bg-accent font-semibold text-accent-ink">{props.jarTitle.slice(0, 1).toUpperCase()}</span>} title={props.receive.symbol} sub="near.com" />
        </div>

        <ListCard>
          <ListRow label="You send" value={quote ? `${quote.amountInFormatted} ${token.symbol}` : loading ? "…" : "—"} />
          <ListRow label="Creator gets" value={receiveOut ? `≈ ${receiveOut} ${props.receive.symbol}` : "—"} />
          <ListRow label="Route fee" hint="NEAR Intents · NearJar takes nothing" value={quote ? money(quote.feeUsd) : "—"} />
          <ListRow label="Arrives" value={eta || "—"} />
          <ListRow label="Lands in" value={props.confidential ? "Confidential balance" : "Public balance"} />
          {(name || message) && <ListRow label={name || "Anonymous"} hint={message || undefined} />}
        </ListCard>

        {error && <p className="text-sm text-danger">{error}</p>}

        {!props.open ? (
          <button type="button" disabled className={`${primary} opacity-50`}>Jar is closed</button>
        ) : manual ? (
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1.5 text-sm text-muted">
              Your {token.chainLabel} address for refunds
              <input value={refund} onChange={(e) => setRefund(e.target.value)} placeholder="Where a failed donation goes back"
                className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 font-mono text-sm text-text outline-none focus:border-accent" />
            </label>
            <p className="text-xs text-muted">Use a wallet you control, not an exchange deposit address.</p>
            <button type="button" onClick={onManual} disabled={!quote || !refund.trim() || !!busy} className={primary}>
              {busy && <Spinner />}
              {busy || "Get a deposit address"}
            </button>
            {(shared || payerDef) && (
              <button type="button" onClick={() => setManualOpen(false)} className="text-sm text-muted underline">
                Pay with a wallet instead
              </button>
            )}
          </div>
        ) : !connected && shared ? (
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => void connect(family as "evm" | "solana")} disabled={!!connecting} className={primary}>
              {connecting === family && <Spinner />}
              {connecting === family ? "Waiting for the wallet…" : `Connect ${family === "evm" ? "an EVM" : "a Solana"} wallet`}
            </button>
            {connectError && <p className="text-sm text-danger">{connectError}</p>}
          </div>
        ) : !connected ? (
          <button type="button" onClick={onConnect} className={primary}>
            Connect {payerDef?.label ?? "wallet"}
          </button>
        ) : (
          <button type="button" onClick={onPay} disabled={!quote || !!busy} className={primary}>
            {busy && <Spinner />}
            {busy || `Confirm in ${connected.label}`}
          </button>
        )}
        {connected && !manual && (
          <p className="flex items-center gap-2 text-xs text-muted">
            {shared && wallet && <Icon src={wallet.icon} alt={wallet.name} size={16} />}
            From {connected.label} <span className="font-mono">{shortAccount(connected.address)}</span>. Refunds, if any, go back here.
          </p>
        )}
        {props.open && !manual && (
          <button type="button" onClick={() => setManualOpen(true)} className="text-sm text-muted underline">
            Or send it yourself from any wallet or exchange
          </button>
        )}
      </aside>
    );
  }

  const raised = props.raisedUsd + given;
  const pct = props.goalUsd ? (raised / props.goalUsd) * 100 : 0;
  return (
    <aside className={card}>
      {/* phones show the total here; desktop has it in the stat cards beside the card */}
      <div className="flex flex-col gap-2 lg:hidden">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-3xl font-bold tracking-tight">{money(raised)}</span>
          <span className="text-sm text-muted">
            {props.goalUsd
              ? `of ${money(props.goalUsd, 0)} · ${pct > 0 && pct < 1 ? "<1" : Math.round(pct)}%`
              : `raised · ${props.supporters} supporter${props.supporters === 1 ? "" : "s"}`}
          </span>
        </div>
        {props.goalUsd && <Progress pct={pct} />}
      </div>
      <h2 className="hidden text-lg font-semibold lg:block">Support this jar</h2>

      <div className="flex flex-col gap-3.5 lg:gap-3">
        <label className="mt-1.5 flex items-center gap-2 rounded-2xl bg-bg px-4 focus-within:ring-1 focus-within:ring-accent lg:mt-0 lg:rounded-[18px] lg:border lg:border-line lg:focus-within:border-accent lg:focus-within:ring-0" htmlFor="usd">
          <span className="text-3xl text-muted lg:text-[28px]">$</span>
          <input id="usd" inputMode="decimal" value={usd} placeholder="0" onChange={(e) => setUsd(e.target.value.replace(/[^\d.]/g, ""))} aria-label="Amount in US dollars"
            className="w-full min-w-0 bg-transparent py-3.5 text-3xl font-semibold outline-none lg:py-3 lg:text-[28px]" />
          <span className="text-sm text-muted">USD</span>
        </label>
        {/* quick amounts: a tap fills the field above */}
        <div className={`grid gap-2 ${GRID[presets.length] ?? "grid-cols-4"}`}>
          {presets.map((p) => (
            <AmountPill key={p} on={Number(usd) === p} onClick={() => setUsd(String(p))}>
              ${p}
            </AmountPill>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <button type="button" onClick={() => setModal("pay")}
          className="flex items-center gap-3 rounded-2xl bg-surface px-3.5 py-3 text-left transition hover:bg-surface-2 lg:rounded-[18px] lg:border lg:border-line">
          {token ? <Icon src={token.icon} alt={token.symbol} size={34} /> : null}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-medium">
              <span className="lg:hidden">{token ? `${token.symbol} on ${token.chainLabel}` : "Pay with"}</span>
              <span className="hidden lg:inline">Pay with</span>
            </span>
            <span className="truncate text-[13px] text-muted">
              <span className="lg:hidden">Pay with{tokenHeld && token ? ` · ${amountText(tokenHeld.amount, token.decimals)} available` : ""}</span>
              <span className="hidden lg:inline">
                {token ? `${token.symbol} on ${token.chainLabel}${tokenHeld ? ` · ${amountText(tokenHeld.amount, token.decimals)} available` : ""}` : "Pick a network"}
              </span>
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1 text-sm text-muted">
            Change <Chevron />
          </span>
        </button>
        <button type="button" onClick={() => setModal("note")} className="flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-left text-sm transition hover:bg-surface">
          <span className="grid size-[34px] shrink-0 place-items-center text-muted" aria-hidden>✎</span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{name || message ? name || "Anonymous" : "Add a message"}</span>
            <span className="truncate text-xs text-muted">{message || (name ? "No message" : "Optional: your name and a few words")}</span>
          </span>
        </button>
      </div>

      <div className="min-h-5 text-sm">
        {amountError ? (
          <p className="text-danger">{amountError}</p>
        ) : loading ? (
          <p className="flex items-center gap-2 text-muted">
            <span className="size-3.5 animate-spin rounded-full border-2 border-line border-t-accent" />
            Finding the best route on NEAR Intents…
          </p>
        ) : quote && token && quotable ? (
          <p className="text-muted">
            {quote.amountInFormatted} {token.symbol} · creator gets ≈ {receiveOut} {props.receive.symbol} · {eta}
          </p>
        ) : error && quotable ? (
          <p className="text-danger">{error}</p>
        ) : null}
      </div>

      <button type="button" onClick={() => setStep("review")} disabled={!props.open || !quote || !quotable || loading} className={`${primary} h-[54px] text-[17px] lg:h-auto lg:text-base`}>
        {props.open ? `Donate ${money(usdCents / 100)}` : "Jar is closed"}
      </button>
      <p className="-mt-2 text-center text-xs text-muted">Live quotes from NEAR Intents. Nothing is charged until you confirm.</p>
      {props.footer}

      {modal === "pay" && (
        <PayWithSheet
          sources={props.sources}
          pinned={POPULAR}
          chain={chain}
          symbol={token?.symbol ?? ""}
          balances={balances}
          hint={
            shared
              ? "You'll connect a wallet on the next step."
              : payerDef
                ? `You'll connect ${payerDef.label} on the next step, or send it yourself.`
                : "No browser wallet for this network: you'll get a one-time address to send to from any wallet or exchange."
          }
          onPick={(t) => {
            setChain(t.chain);
            setSymbol(t.symbol);
            setModal(null);
          }}
          onClose={() => setModal(null)}
        />
      )}

      {modal === "note" && (
        <Modal title="Add a message" onClose={() => setModal(null)}>
          <div className="flex flex-col gap-3">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Your name (optional)"
              className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 outline-none focus:border-accent" />
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={280} rows={3} placeholder="A few words for the creator"
              className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 outline-none focus:border-accent" />
            <div className="flex flex-wrap gap-2">
              {QUICK_NOTES.map((q) => (
                <button key={q} type="button" onClick={() => setMessage(q)} className="rounded-full bg-surface-2 px-3 py-1.5 text-sm hover:bg-line">{q}</button>
              ))}
            </div>
            <p className="text-xs text-muted">Shown on the jar page next to your donation. Leave the name empty to give anonymously.</p>
            <button type="button" onClick={() => setModal(null)} className={primary}>Save</button>
          </div>
        </Modal>
      )}
    </aside>
  );
}

// six quick amounts read better as two rows of three than as 4 + 2
const GRID: Record<number, string> = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4", 5: "grid-cols-3", 6: "grid-cols-3" };

const primary =
  "flex items-center justify-center gap-2 rounded-full bg-accent px-5 py-3.5 font-medium text-accent-ink transition hover:brightness-105 disabled:opacity-50";

function AmountPill({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`h-12 rounded-[14px] text-base font-medium transition lg:h-auto lg:rounded-full lg:py-2.5 lg:text-sm ${on ? "bg-pill text-bg" : "bg-surface-2 text-text hover:bg-line"}`}>
      {children}
    </button>
  );
}

function Spinner() {
  return <span className="size-4 animate-spin rounded-full border-2 border-accent-ink/30 border-t-accent-ink" />;
}

/** The route strip's logos, from the catalog the panel already has. */
function donationArt(sources: SourceAsset[], d: PublicDonation, receiveId: string) {
  const src = sources.find((s) => s.chain === d.sourceChain && s.symbol === d.sourceSymbol);
  return {
    icon: src?.icon ?? "",
    chainIcon: src?.chainIcon ?? "",
    chainLabel: src?.chainLabel ?? d.sourceChain,
    receiveIcon: sources.find((s) => s.assetId === receiveId)?.icon ?? "",
  };
}

function RouteNode({ icon, title, sub }: { icon: ReactNode; title: string; sub: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center">
      {icon}
      <span className="w-full truncate font-medium">{title}</span>
      <span className="w-full truncate text-muted">{sub}</span>
    </div>
  );
}

function RouteArrow() {
  return (
    <svg width="18" height="28" viewBox="0 0 18 28" aria-hidden className="shrink-0 text-muted">
      <path d="M2 14h12m-4-4 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

async function post(url: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), ...(signal ? { signal } : {}) });
  return res.json();
}

function errText(e: unknown, fallback: string): string {
  const m = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : "";
  if (/user (rejected|denied)|rejected the request|4001/i.test(m)) return "You cancelled in the wallet.";
  return m || fallback;
}

export function formatUnits(v: bigint, decimals: number, maxFrac = 6): string {
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}
