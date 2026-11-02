"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import type { PayInstruction } from "@/lib/pay";

/** Send-it-yourself instructions: exact amount + one-time deposit address (+ memo), with a QR. */
export function ManualDeposit({ pay, chainLabel }: { pay: PayInstruction; chainLabel: string }) {
  const [qr, setQr] = useState("");
  const amount = formatUnits(BigInt(pay.amount), pay.decimals);

  useEffect(() => {
    // BIP-21 style URI where wallets understand it, otherwise the bare address
    const scheme = pay.chain.startsWith("bitcoin:") ? "bitcoin" : pay.chain.startsWith("zcash:") ? "zcash" : null;
    const text = scheme && !pay.contract ? `${scheme}:${pay.to}?amount=${amount}` : pay.to;
    QRCode.toString(text, { type: "svg", margin: 1, color: { dark: "#111111", light: "#ffffff" } }).then(setQr, () => setQr(""));
  }, [pay, amount]);

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-surface-2 p-4 text-sm">
      <p>
        Send <b>exactly</b> this amount on <b>{chainLabel}</b> within 60 minutes. Any wallet or exchange works.
      </p>
      {qr && <div className="mx-auto w-44 rounded-lg bg-white p-2" dangerouslySetInnerHTML={{ __html: qr }} />}
      <Field label="Amount" value={`${amount} ${pay.symbol}`} copy={amount} />
      <Field label="To address" value={pay.to} copy={pay.to} mono />
      {pay.memo && (
        <>
          <Field label="Memo / comment (required)" value={pay.memo} copy={pay.memo} mono />
          <p className="text-danger">Without this memo the deposit can&apos;t be matched and will be refunded.</p>
        </>
      )}
      {pay.contract && <p className="text-xs text-muted">Token contract: <span className="break-all font-mono">{pay.contract}</span></p>}
      <p className="text-xs text-muted">A different amount or a late deposit is refunded to your refund address, minus network fees.</p>
    </div>
  );
}

function Field({ label, value, copy, mono }: { label: string; value: string; copy: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs text-muted">{label}</p>
        <p className={`break-all ${mono ? "font-mono" : ""}`}>{value}</p>
      </div>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(copy);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="shrink-0 rounded-full border border-line px-3 py-1 text-xs"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function formatUnits(v: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${v / base}.${frac}` : (v / base).toString();
}
