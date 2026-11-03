"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReceiveAsset, SourceAsset } from "@/lib/assets";
import { PAYERS, evmPayer, familyOf, solanaPayer, type PayInstruction, type Payer } from "@/lib/pay";
import { DonationStatus, type PublicDonation } from "./DonationStatus";
import { ManualDeposit } from "./ManualDeposit";
import { Select } from "./Select";
import { Icon, shortAccount } from "./ui";
import { WalletOptions } from "./WalletMenu";
import { useWallet } from "./WalletProvider";

// shown as tiles; every other network is in "More"
const POPULAR = ["eip155:8453", "eip155:1", "eip155:42161", "solana:mainnet", "tron:728126428", "ton:-239", "near:mainnet", "bitcoin:mainnet"];

const PRESETS = [5, 10, 25, 50];

type Quote = {
  amountInFormatted: string;
  amountOut: string;
  minAmountOut: string;
  feeUsd: number;
  etaSeconds: number;
};

export function DonatePanel(props: { jarId: string; receive: ReceiveAsset; sources: SourceAsset[]; open: boolean }) {
  const chains = useMemo(() => {
    const seen = new Map<string, { chain: string; label: string; icon: string }>();
    for (const s of props.sources) if (!seen.has(s.chain)) seen.set(s.chain, { chain: s.chain, label: s.chainLabel, icon: s.chainIcon });
    return [...seen.values()];
  }, [props.sources]);

  const [usd, setUsd] = useState("10");
  const [chain, setChain] = useState(chains.find((c) => c.chain === "eip155:8453")?.chain ?? chains[0]?.chain ?? "");
  const tokens = props.sources.filter((s) => s.chain === chain);
  const [symbol, setSymbol] = useState("USDC");
  const token = tokens.find((t) => t.symbol === symbol) ?? tokens[0];
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");

  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [payer, setPayer] = useState<Payer | null>(null);
  const [busy, setBusy] = useState("");
  const [donation, setDonation] = useState<PublicDonation | null>(null);
  const [manualPay, setManualPay] = useState<PayInstruction | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [refund, setRefund] = useState("");

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
      if (wallet.solana) return solanaPayer(wallet.solana.wallet, wallet.solana.account);
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

      setBusy("Confirm the payment in your wallet…");
      const txHash = await connected.pay(res.pay);
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
      setManualPay(res.pay);
      setDonation(res.donation);
    } catch (e) {
      setError(errText(e, "Could not start the donation."));
    } finally {
      setBusy("");
    }
  }

  if (donation) {
    const status = <DonationStatus initial={donation} receive={props.receive} {...(quote ? { etaSeconds: quote.etaSeconds } : {})} />;
    if (!manualPay || !token) return status;
    return (
      <div className="flex flex-col gap-4">
        <ManualDeposit pay={manualPay} chainLabel={token.chainLabel} />
        {status}
      </div>
    );
  }

  const receiveOut = quote ? formatUnits(BigInt(quote.amountOut), props.receive.decimals) : null;

  return (
    <aside className="flex flex-col gap-5 rounded-3xl border border-line bg-surface p-6">
      <h2 className="text-xl font-semibold">Donate</h2>

      <div className="flex flex-col gap-2">
        <label className="flex items-center rounded-2xl border border-line bg-surface-2 px-4 focus-within:border-accent" htmlFor="usd">
          <span className="text-3xl text-muted">$</span>
          <input id="usd" inputMode="decimal" value={usd} onChange={(e) => setUsd(e.target.value.replace(/[^\d.]/g, ""))} aria-label="Amount in US dollars"
            className="w-full bg-transparent px-2 py-3 text-3xl font-semibold outline-none" />
          <span className="text-sm text-muted">USD</span>
        </label>
        <div className="grid grid-cols-4 gap-2">
          {PRESETS.map((p) => (
            <button key={p} type="button" onClick={() => setUsd(String(p))}
              className={`rounded-xl border py-2 text-sm ${usd === String(p) ? "border-accent bg-accent/10 text-accent" : "border-line hover:bg-surface-2"}`}>
              ${p}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted">Pay from</p>
        <div className="grid grid-cols-4 gap-2">
          {POPULAR.map((id) => chains.find((c) => c.chain === id)).filter((c) => c !== undefined).map((c) => (
            <button key={c.chain} type="button" onClick={() => setChain(c.chain)} title={c.label}
              className={`flex flex-col items-center gap-1 rounded-xl border px-1 py-2 text-xs ${chain === c.chain ? "border-accent bg-accent/10" : "border-line hover:bg-surface-2"}`}>
              <Icon src={c.icon} alt={c.label} size={24} />
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
      </div>

      <div className="flex flex-wrap gap-2">
        {tokens.map((t) => (
          <button key={t.symbol} type="button" onClick={() => setSymbol(t.symbol)}
            className={`flex items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-3 text-sm ${token?.symbol === t.symbol ? "border-accent bg-accent/10" : "border-line hover:bg-surface-2"}`}>
            <Icon src={t.icon} alt={t.symbol} size={22} />
            {t.symbol}
          </button>
        ))}
      </div>

      <div className="min-h-28 rounded-2xl bg-surface-2 p-4 text-sm">
        {amountError && <p className="text-danger">{amountError}</p>}
        {!amountError && loading && (
          <div className="flex items-center gap-3 text-muted">
            <span className="size-4 animate-spin rounded-full border-2 border-line border-t-accent" />
            Finding the best route on NEAR Intents…
          </div>
        )}
        {quotable && !loading && !quote && error && <p className="text-danger">{error}</p>}
        {quotable && !loading && quote && token && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted">You pay</dt>
            <dd className="text-right">{quote.amountInFormatted} {token.symbol} on {token.chainLabel}</dd>
            <dt className="text-muted">Creator gets</dt>
            <dd className="text-right">≈ {receiveOut} {props.receive.symbol} in near.com</dd>
            <dt className="text-muted">Route fee</dt>
            <dd className="text-right">${quote.feeUsd.toFixed(2)}</dd>
            <dt className="text-muted">Arrives in</dt>
            <dd className="text-right">~{Math.max(1, Math.round(quote.etaSeconds / 60))} min</dd>
          </dl>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Your name (optional)"
          className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent" />
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={280} rows={2} placeholder="Message (optional)"
          className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent" />
      </div>

      {error && (quote || !quotable) && <p className="text-sm text-danger">{error}</p>}
      {props.open && manual ? (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-sm text-muted">
            Your {token?.chainLabel ?? ""} address for refunds
            <input value={refund} onChange={(e) => setRefund(e.target.value)} placeholder="Where a failed donation goes back"
              className="rounded-xl border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-text outline-none focus:border-accent" />
          </label>
          <p className="text-xs text-muted">Use a wallet you control, not an exchange deposit address.</p>
          <button type="button" onClick={onManual} disabled={!quote || !refund.trim() || !!busy}
            className="rounded-full bg-accent px-5 py-3.5 font-medium text-accent-ink transition hover:brightness-105 disabled:opacity-50">
            {busy || "Get deposit address"}
          </button>
          {(shared || payerDef) && (
            <button type="button" onClick={() => setManualOpen(false)} className="text-sm text-muted underline">
              Pay with a wallet instead
            </button>
          )}
        </div>
      ) : !props.open ? (
        <button type="button" disabled className="rounded-full bg-accent px-5 py-3.5 font-medium text-accent-ink transition hover:brightness-105 opacity-50">Jar is closed</button>
      ) : !connected && shared ? (
        <div className="flex flex-col gap-2">
          <button type="button" onClick={() => setPickerOpen((v) => !v)} aria-expanded={pickerOpen}
            className="rounded-full bg-accent px-5 py-3.5 font-medium text-accent-ink transition hover:brightness-105">
            Connect a {family === "evm" ? "EVM" : "Solana"} wallet
          </button>
          {pickerOpen && (
            <div className="rounded-2xl border border-line bg-surface-2/40 p-3">
              <WalletOptions families={[family as "evm" | "solana"]} onPicked={() => setPickerOpen(false)} />
            </div>
          )}
        </div>
      ) : !connected ? (
        <button type="button" onClick={onConnect} className="rounded-full bg-accent px-5 py-3.5 font-medium text-accent-ink transition hover:brightness-105">
          Connect {payerDef?.label ?? "wallet"}
        </button>
      ) : (
        <button type="button" onClick={onPay} disabled={!quote || !!busy}
          className="flex items-center justify-center gap-2 rounded-full bg-accent px-5 py-3.5 font-medium text-accent-ink transition hover:brightness-105 disabled:opacity-50">
          {busy && <span className="size-4 animate-spin rounded-full border-2 border-accent-ink/30 border-t-accent-ink" />}
          {busy || `Pay ${quote?.amountInFormatted ?? ""} ${token?.symbol ?? ""}`}
        </button>
      )}
      {connected && !manual && (
        <p className="flex items-center gap-2 text-xs text-muted">
          {shared && wallet && <Icon src={wallet.icon} alt={wallet.name} size={16} />}
          Paying from {connected.label} <span className="font-mono">{shortAccount(connected.address)}</span>. Refunds, if any, go back here.
        </p>
      )}
      {props.open && !manual && (
        <button type="button" onClick={() => setManualOpen(true)} className="text-sm text-muted underline">
          Or send it yourself (any wallet or exchange)
        </button>
      )}
      <p className="text-xs text-muted">Quotes are live from NEAR Intents. Nothing is charged until you confirm in your wallet.</p>
    </aside>
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
