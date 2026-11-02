"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

const jarUrl = (jarId: string) => `${window.location.origin}/j/${jarId}`;

export function ShareJar({ jarId, title }: { jarId: string; title: string }) {
  const [qr, setQr] = useState("");
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!showQr) return;
    let live = true;
    QRCode.toString(jarUrl(jarId), { type: "svg", margin: 1, color: { dark: "#111111", light: "#ffffff" } }).then(
      (svg) => live && setQr(svg),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [jarId, showQr]);

  const btn = "rounded-full border border-line px-4 py-2 text-sm hover:bg-surface-2";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={btn}
          onClick={() => {
            void navigator.clipboard.writeText(jarUrl(jarId));
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Link copied" : "Copy link"}
        </button>
        <button type="button" className={btn} onClick={() => setShowQr((v) => !v)}>
          {showQr ? "Hide QR" : "QR code"}
        </button>
        <button
          type="button"
          className={btn}
          onClick={() =>
            window.open(
              `https://x.com/intent/post?text=${encodeURIComponent(`Chip in to "${title}" from any chain`)}&url=${encodeURIComponent(jarUrl(jarId))}`,
              "_blank",
              "noopener",
            )
          }
        >
          Share on X
        </button>
      </div>
      {showQr && qr && <div className="w-40 rounded-xl bg-white p-2" dangerouslySetInnerHTML={{ __html: qr }} />}
    </div>
  );
}
