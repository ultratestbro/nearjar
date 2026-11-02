"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReceiveAsset, SourceAsset } from "@/lib/assets";
import { PAYERS, familyOf, type PayInstruction, type Payer } from "@/lib/pay";
import { DonationStatus, type PublicDonation } from "./DonationStatus";

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
    const seen = new Map<string, { chain: string; label: string }>();
    for (const s of props.sources) if (!seen.has(s.chain)) seen.set(s.chain, { chain: s.chain, label: s.chainLabel });
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

  const usdCents = Math.round(Number(usd) * 100);
  const amountError = usdCents > 0 && usdCents < 100 ? "Minimum is $1." : usdCents > 1_000_000 ? "Maximum is $10,000." : "";
  const quotable = !!token && usdCents >= 100 && usdCents <= 1_000_000;
  const family = token ? familyOf(token.chain) : "";
  const payerDef = PAYERS[family];
  const connected = payer && payer.family === family ? payer : null;

  useEffect(() => {
    if (!quotable || !token) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const data = (await post("/api/quote", { jarId: props.jarId, usdCents, sourceChain: token.chain, sourceSymbol: token.symbol, dry: true }, ctrl.signal)) as {
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
  }, [props.jarId, token, usdCents, quotable]);

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

  if (donation) return <DonationStatus initial={donation} receive={props.receive} />;

  const receiveOut = quote ? formatUnits(BigInt(quote.amountOut), props.receive.decimals) : null;

  return (
    <aside className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5">
      <h2 className="text-lg font-semibold">Donate</h2>

      <div className="flex flex-col gap-2">
        <label className="text-sm text-muted" htmlFor="usd">Amount (USD)</label>
        <div className="flex gap-2">
          {PRESETS.map((p) => (
            <button key={p} type="button" onClick={() => setUsd(String(p))}
              className={`rounded-full border px-3 py-1.5 text-sm ${usd === String(p) ? "border-accent text-accent" : "border-line"}`}>
              ${p}
            </button>
          ))}
        </div>
        <input id="usd" inputMode="decimal" value={usd} onChange={(e) => setUsd(e.target.value.replace(/[^\d.]/g, ""))}
          className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-lg outline-none focus:border-accent" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-sm text-muted">
          Pay on
          <select value={chain} onChange={(e) => setChain(e.target.value)} className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-text">
            {chains.map((c) => (
              <option key={c.chain} value={c.chain}>{c.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-muted">
          With
          <select value={token?.symbol ?? ""} onChange={(e) => setSymbol(e.target.value)} className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-text">
            {tokens.map((t) => (
              <option key={t.symbol} value={t.symbol}>{t.symbol}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="min-h-24 rounded-xl bg-surface-2 p-4 text-sm">
        {amountError && <p className="text-danger">{amountError}</p>}
        {!amountError && loading && <p className="text-muted">Getting a quote…</p>}
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
      {!props.open ? (
        <button type="button" disabled className="rounded-full bg-accent px-5 py-3 font-medium text-accent-ink opacity-50">Jar is closed</button>
      ) : !payerDef ? (
        <button type="button" disabled className="rounded-full bg-accent px-5 py-3 font-medium text-accent-ink opacity-50">
          Wallet payments from this chain land soon
        </button>
      ) : !connected ? (
        <button type="button" onClick={onConnect} className="rounded-full bg-accent px-5 py-3 font-medium text-accent-ink">
          Connect {payerDef.label}
        </button>
      ) : (
        <button type="button" onClick={onPay} disabled={!quote || !!busy}
          className="rounded-full bg-accent px-5 py-3 font-medium text-accent-ink disabled:opacity-50">
          {busy || `Pay ${quote?.amountInFormatted ?? ""} ${token?.symbol ?? ""}`}
        </button>
      )}
      {connected && <p className="break-all text-xs text-muted">Paying from {connected.address}. Refunds, if any, go back here.</p>}
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
