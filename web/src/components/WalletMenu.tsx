"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { WalletFamily } from "@/lib/wallet";
import { Icon, shortAccount } from "./ui";
import { useWallet } from "./WalletProvider";

const FAMILY: Record<WalletFamily, { title: string; icon: string; hint: string }> = {
  evm: {
    title: "EVM",
    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png",
    hint: "near.com account = your 0x address",
  },
  solana: {
    title: "Solana",
    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png",
    hint: "near.com account = your Solana key",
  },
  near: {
    title: "NEAR",
    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/near/info/logo.png",
    hint: "near.com account = your NEAR account",
  },
  ton: {
    title: "TON",
    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ton/info/logo.png",
    hint: "near.com account = your TON wallet key · Tonkeeper, MyTonWallet, Telegram Wallet…",
  },
};

const EMPTY: Record<WalletFamily, string> = {
  evm: "No EVM wallet found — install MetaMask or Rabby.",
  solana: "No Solana wallet found — install Phantom or Solflare.",
  near: "Loading NEAR wallets…",
  ton: "",
};

/** Network switch (EVM / Solana, with logos) over a grid of the wallets this browser has. */
export function WalletOptions({ families = ["evm", "solana", "near", "ton"], onPicked }: { families?: WalletFamily[]; onPicked?: () => void }) {
  const { options, connect, connecting, error, restoring } = useWallet();
  const [picked, setPicked] = useState<WalletFamily>(families[0]!);
  const family = families.includes(picked) ? picked : families[0]!;
  const list = options.filter((o) => o.family === family);
  return (
    <div className="flex flex-col gap-3">
      {families.length > 1 && (
        <div role="tablist" className={`grid gap-1 rounded-xl bg-surface-2 p-1 ${families.length > 2 ? "grid-cols-4" : "grid-cols-2"}`}>
          {families.map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={f === family}
              onClick={() => setPicked(f)}
              className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-sm ${f === family ? "bg-surface text-text shadow" : "text-muted hover:text-text"}`}
            >
              <Icon src={FAMILY[f].icon} alt={FAMILY[f].title} size={16} />
              {FAMILY[f].title}
            </button>
          ))}
        </div>
      )}
      <p className="px-1 text-xs text-muted">{FAMILY[family].hint}</p>
      {list.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-3 py-3 text-sm text-muted">
          {restoring ? "Looking for wallets…" : EMPTY[family]}
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {list.map((o) => (
            <button
              key={o.id}
              type="button"
              title={`Connect ${o.name}`}
              disabled={!!connecting}
              onClick={async () => {
                if (await connect(o.id)) onPicked?.();
              }}
              className="relative flex flex-col items-center gap-1.5 rounded-xl border border-line bg-surface-2/60 px-1 py-3 text-xs hover:border-accent/60 disabled:opacity-60"
            >
              <Icon src={o.icon} alt={o.name} size={30} />
              <span className="w-full truncate text-center">{o.name}</span>
              {connecting === o.id && (
                <span className="absolute right-1.5 top-1.5 size-3 animate-spin rounded-full border-2 border-line border-t-accent" />
              )}
            </button>
          ))}
        </div>
      )}
      {error && <p className="px-1 text-sm text-danger">{error}</p>}
      <p className="px-1 text-xs text-muted">Passkey near.com logins are coming next.</p>
    </div>
  );
}

/** Header button: connect with a wallet picker, or the connected near.com account with its menu. */
export function WalletMenu() {
  const { wallet, restoring, disconnect } = useWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex h-9 items-center gap-2 whitespace-nowrap rounded-full px-3.5 text-sm ${wallet ? "border border-line bg-surface hover:bg-surface-2" : "bg-accent font-medium text-accent-ink"}`}
      >
        {wallet ? (
          <>
            <Icon src={wallet.icon} alt={wallet.name} size={18} />
            <span className="font-mono">{shortAccount(wallet.account)}</span>
          </>
        ) : restoring ? (
          "…"
        ) : (
          <>
            <span className="sm:hidden">Connect</span>
            <span className="hidden sm:inline">Connect wallet</span>
          </>
        )}
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className={`transition ${open ? "rotate-180" : ""}`}>
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[340px] max-w-[calc(100vw-2rem)] rounded-2xl border border-line bg-surface p-3 shadow-2xl shadow-black/50">
          {wallet ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-3 px-2 py-2">
                <Icon src={wallet.icon} alt={wallet.name} size={32} />
                <div className="min-w-0">
                  <p className="text-sm text-muted">{wallet.name} · your near.com account</p>
                  <p className="break-all font-mono text-sm">nearcom:{wallet.account}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(`nearcom:${wallet.account}`);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-2"
              >
                {copied ? "Copied" : "Copy near.com address"}
              </button>
              <Link href="/me" onClick={() => setOpen(false)} className="rounded-xl px-3 py-2 text-sm hover:bg-surface-2">Creator studio</Link>
              <Link href="/new" onClick={() => setOpen(false)} className="rounded-xl px-3 py-2 text-sm hover:bg-surface-2">Create a jar</Link>
              <button
                type="button"
                onClick={() => {
                  disconnect();
                  setOpen(false);
                }}
                className="rounded-xl px-3 py-2 text-left text-sm text-danger hover:bg-surface-2"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <WalletOptions onPicked={() => setOpen(false)} />
          )}
        </div>
      )}
    </div>
  );
}
