"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ReceiveAsset, SourceAsset } from "@/lib/assets";
import { PAYERS, evmPayer, familyOf, solanaPayer, type PayInstruction, type Payer } from "@/lib/pay";
import { DonationStatus, type PublicDonation } from "./DonationStatus";
import { ManualDeposit } from "./ManualDeposit";
import { Modal } from "./Modal";
import { Select } from "./Select";
import { Chevron, Icon, ListCard, ListRow, Progress, money, shortAccount } from "./ui";
import { WalletOptions } from "./WalletMenu";
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
  const [custom, setCustom] = useState(false);
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
  // EVM and Solana pay through the wallet picked in the shared picker (logos, remembered on reload)
  const { wallet } = useWallet();
  const [pickerOpen, setPickerOpen] = useState(false);
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

  const card = "flex flex-col gap-5 rounded-3xl border border-line bg-surface p-4 sm:p-6";

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

        <div className="flex items-start gap-1 rounded-2xl bg-panel p-3 text-xs">
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
            <button type="button" onClick={() => setPickerOpen((v) => !v)} aria-expanded={pickerOpen} className={primary}>
              Connect {family === "evm" ? "an EVM" : "a Solana"} wallet
            </button>
            {pickerOpen && (
              <div className="rounded-2xl border border-line bg-panel p-3">
                <WalletOptions families={[family as "evm" | "solana"]} onPicked={() => setPickerOpen(false)} />
              </div>
            )}
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
  return (
    <aside className={card}>
      <div className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-sm text-muted">Raised</p>
            <p className="text-4xl font-semibold tracking-tight">{money(raised)}</p>
          </div>
          {props.goalUsd && <p className="pb-1 text-sm text-muted">of {money(props.goalUsd, 0)}</p>}
        </div>
        {props.goalUsd && <Progress pct={(raised / props.goalUsd) * 100} />}
        <p className="text-xs text-muted">
          {props.supporters} supporter{props.supporters === 1 ? "" : "s"} · no platform fee
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <AmountPill key={p} on={!custom && usd === String(p)} onClick={() => { setCustom(false); setUsd(String(p)); }}>
              ${p}
            </AmountPill>
          ))}
          <AmountPill on={custom} onClick={() => setCustom(true)}>Other</AmountPill>
        </div>
        {custom && (
          <label className="flex items-center rounded-2xl border border-line bg-panel px-4 focus-within:border-accent" htmlFor="usd">
            <span className="text-3xl text-muted">$</span>
            <input id="usd" autoFocus inputMode="decimal" value={usd} onChange={(e) => setUsd(e.target.value.replace(/[^\d.]/g, ""))} aria-label="Amount in US dollars"
              className="w-full bg-transparent px-2 py-3 text-3xl font-semibold outline-none" />
            <span className="text-sm text-muted">USD</span>
          </label>
        )}
      </div>

      <ListCard>
        <ListRow
          onClick={() => setModal("pay")}
          icon={token ? <Icon src={token.icon} alt={token.symbol} size={32} /> : undefined}
          label="Pay with"
          hint={token ? `${token.symbol} on ${token.chainLabel}` : "Pick a network"}
          value={<span className="text-muted">Change</span>}
        />
        <ListRow
          onClick={() => setModal("note")}
          icon={<span className="grid size-8 place-items-center rounded-full bg-surface-2 text-muted" aria-hidden>✎</span>}
          label={name || message ? name || "Anonymous" : "Add a message"}
          hint={message || (name ? "No message" : "Optional: your name and a few words")}
        />
      </ListCard>

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

      <button type="button" onClick={() => setStep("review")} disabled={!props.open || !quote || !quotable || loading} className={primary}>
        {props.open ? `Continue · ${money(usdCents / 100)}` : "Jar is closed"}
      </button>
      <p className="-mt-2 text-center text-xs text-muted">Live quotes from NEAR Intents. Nothing is charged until you confirm.</p>

      {modal === "pay" && (
        <Modal title="Pay with" onClose={() => setModal(null)}>
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-4 gap-2">
              {POPULAR.map((id) => chains.find((c) => c.chain === id)).filter((c) => c !== undefined).map((c) => (
                <button key={c.chain} type="button" onClick={() => setChain(c.chain)} title={c.label}
                  className={`flex flex-col items-center gap-1.5 rounded-2xl border px-1 py-3 text-xs transition ${chain === c.chain ? "border-accent bg-accent/10" : "border-line bg-surface hover:bg-surface-2"}`}>
                  <Icon src={c.icon} alt={c.label} size={28} />
                  <span className="w-full truncate text-center">{c.label}</span>
                </button>
              ))}
            </div>
            <Select
              label="More networks"
              value={POPULAR.includes(chain) ? "" : chain}
              onChange={setChain}
              placeholder="More networks — Zcash, Litecoin, Doge, XRP…"
              options={chains.filter((c) => !POPULAR.includes(c.chain)).map((c) => ({ value: c.chain, label: c.label, icon: c.icon }))}
            />
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted">Token</p>
              <div className="flex flex-wrap gap-2">
                {tokens.map((t) => (
                  <button key={t.symbol} type="button" onClick={() => setSymbol(t.symbol)}
                    className={`flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3 text-sm transition ${token?.symbol === t.symbol ? "bg-pill text-bg" : "bg-surface-2 hover:bg-line"}`}>
                    <Icon src={t.icon} alt={t.symbol} size={22} />
                    {t.symbol}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted">
              {shared
                ? "You'll connect a wallet on the next step."
                : payerDef
                  ? `You'll connect ${payerDef.label} on the next step, or send it yourself.`
                  : "No browser wallet for this network: you'll get a one-time address to send to from any wallet or exchange."}
            </p>
            <button type="button" onClick={() => setModal(null)} className={primary}>Done</button>
          </div>
        </Modal>
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

const primary =
  "flex items-center justify-center gap-2 rounded-full bg-accent px-5 py-3.5 font-medium text-accent-ink transition hover:brightness-105 disabled:opacity-50";

function AmountPill({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition ${on ? "bg-pill text-bg" : "bg-surface-2 text-text hover:bg-line"}`}>
      {children}
    </button>
  );
}

function Spinner() {
  return <span className="size-4 animate-spin rounded-full border-2 border-accent-ink/30 border-t-accent-ink" />;
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
