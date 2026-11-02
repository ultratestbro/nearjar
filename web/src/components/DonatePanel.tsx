"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReceiveAsset, SourceAsset } from "@/lib/assets";

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
  const [chain, setChain] = useState(chains.find((c) => c.chain === "solana:mainnet")?.chain ?? chains[0]?.chain ?? "");
  const tokens = props.sources.filter((s) => s.chain === chain);
  const [symbol, setSymbol] = useState("USDC");
  const token = tokens.find((t) => t.symbol === symbol) ?? tokens[0];

  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const usdCents = Math.round(Number(usd) * 100);
  const amountError = usdCents > 0 && usdCents < 100 ? "Minimum is $1." : usdCents > 1_000_000 ? "Maximum is $10,000." : "";
  const quotable = !!token && usdCents >= 100 && usdCents <= 1_000_000;

  useEffect(() => {
    if (!quotable || !token) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/quote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jarId: props.jarId, usdCents, sourceChain: token.chain, sourceSymbol: token.symbol, dry: true }),
          signal: ctrl.signal,
        });
        const data = (await res.json()) as { ok: boolean; quote?: Quote; error?: string };
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

  const receiveOut = quote ? formatUnits(BigInt(quote.amountOut), props.receive.decimals) : null;

  return (
    <aside className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5">
      <h2 className="text-lg font-semibold">Donate</h2>

      <div className="flex flex-col gap-2">
        <label className="text-sm text-muted" htmlFor="usd">Amount (USD)</label>
        <div className="flex gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setUsd(String(p))}
              className={`rounded-full border px-3 py-1.5 text-sm ${usd === String(p) ? "border-accent text-accent" : "border-line"}`}
            >
              ${p}
            </button>
          ))}
        </div>
        <input
          id="usd"
          inputMode="decimal"
          value={usd}
          onChange={(e) => setUsd(e.target.value.replace(/[^\d.]/g, ""))}
          className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-lg outline-none focus:border-accent"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-sm text-muted">
          Pay on
          <select
            value={chain}
            onChange={(e) => setChain(e.target.value)}
            className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-text"
          >
            {chains.map((c) => (
              <option key={c.chain} value={c.chain}>{c.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-muted">
          With
          <select
            value={token?.symbol ?? ""}
            onChange={(e) => setSymbol(e.target.value)}
            className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-text"
          >
            {tokens.map((t) => (
              <option key={t.symbol} value={t.symbol}>{t.symbol}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="min-h-24 rounded-xl bg-surface-2 p-4 text-sm">
        {amountError && <p className="text-danger">{amountError}</p>}
        {!amountError && loading && <p className="text-muted">Getting a quote…</p>}
        {quotable && !loading && error && <p className="text-danger">{error}</p>}
        {quotable && !loading && !error && quote && token && (
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

      <button
        type="button"
        disabled
        className="rounded-full bg-accent px-5 py-3 font-medium text-accent-ink opacity-50"
        title="Wallet payments land next"
      >
        {props.open ? "Connect wallet to pay" : "Jar is closed"}
      </button>
      <p className="text-xs text-muted">Quotes are live from NEAR Intents. Nothing is charged until you sign.</p>
    </aside>
  );
}

function formatUnits(v: bigint, decimals: number, maxFrac = 6): string {
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}
