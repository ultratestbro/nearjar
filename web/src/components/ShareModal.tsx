"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { Modal } from "./Modal";

/** Share kit for one jar: QR, the X card it unfurls to, copy link, and an embed button. */
export function ShareModal({ path, title, raisedUsd, onClose }: { path: string; title: string; raisedUsd: number; onClose: () => void }) {
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState("");
  const url = typeof window === "undefined" ? "" : `${window.location.origin}${path}`;
  const embed = `<a href="${url}" target="_blank" rel="noopener" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#00ec97;color:#171717;font:600 15px system-ui;text-decoration:none">Donate from any chain</a>`;

  useEffect(() => {
    let live = true;
    QRCode.toString(url, { type: "svg", margin: 1, color: { dark: "#111111", light: "#ffffff" } }).then((s) => live && setQr(s), () => {});
    return () => {
      live = false;
    };
  }, [url]);

  const copy = (what: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied(""), 1500);
  };
  const xPost = `https://x.com/intent/post?text=${encodeURIComponent(`Chip in to "${title}" from any chain`)}&url=${encodeURIComponent(url)}`;
  const btn = "rounded-full border border-line px-4 py-2.5 text-sm hover:bg-surface-2";

  return (
    <Modal title={`Share “${title}”`} onClose={onClose} wide>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-[200px_minmax(0,1fr)]">
        <div className="mx-auto aspect-square w-full max-w-[200px] rounded-2xl bg-white p-3 sm:mx-0" dangerouslySetInnerHTML={{ __html: qr }} />
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-1.5 rounded-2xl bg-gradient-to-br from-[#1f4733] to-bg p-4">
            <span className="truncate text-xs text-[#b9d8c6]">{url.replace(/^https?:\/\//, "")}</span>
            <span className="break-words text-lg font-semibold">{title}</span>
            <span className="text-sm text-[#b9d8c6]">${raisedUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })} raised · chip in from any chain — USDC, ETH, SOL, BTC, TON…</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={xPost} target="_blank" rel="noreferrer" className="rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink">Post on X</a>
            <button type="button" className={btn} onClick={() => copy("link", url)}>{copied === "link" ? "Link copied" : "Copy link"}</button>
            <button type="button" className={btn} onClick={() => copy("embed", embed)}>{copied === "embed" ? "Embed copied" : "Copy embed button"}</button>
          </div>
          <p className="text-xs text-muted">The embed is a plain link styled as a button — paste it into any site or Linktree-style page.</p>
        </div>
      </div>
    </Modal>
  );
}
