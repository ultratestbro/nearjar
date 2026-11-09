"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FAMILIES, type WalletFamily } from "@/lib/wallet";
import { WalletIcon } from "./ButtonIcons";
import { Modal } from "./Modal";
import { Icon, shortAccount } from "./ui";
import { useWallet } from "./WalletProvider";

const FAMILY: Record<WalletFamily, { title: string; icon: string; hint: string }> = {
  evm: {
    title: "EVM",
    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png",
    hint: "MetaMask, Rabby, Coinbase or any phone wallet. One EVM wallet works on Ethereum, Base, Arbitrum and every other EVM network here; your near.com account is its 0x address.",
  },
  solana: {
    title: "Solana",
    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png",
    hint: "Phantom, Solflare, Backpack or any phone wallet. Your near.com account is your Solana key.",
  },
  near: {
    title: "NEAR",
    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/near/info/logo.png",
    hint: "Meteor, HERE or Intear. Your near.com account is your NEAR account.",
  },
  ton: {
    title: "TON",
    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ton/info/logo.png",
    hint: "Tonkeeper, MyTonWallet, Telegram Wallet… Your near.com account is your TON wallet key.",
  },
};

/**
 * Pick a network, then connect in its own wallet modal: AppKit for EVM and Solana (extensions,
 * phone wallets over WalletConnect, the wallet directory), wallet-selector for NEAR, TON Connect for TON.
 */
export function ConnectPanel({ families = FAMILIES, onConnected }: { families?: WalletFamily[]; onConnected?: () => void }) {
  const { wallet, connect, connecting, error } = useWallet();
  const [picked, setPicked] = useState<WalletFamily>(families[0]!);
  const family = families.includes(picked) ? picked : families[0]!;
  const busy = connecting === family;
  const mine = wallet?.family === family ? wallet : null;
  return (
    <div className="flex flex-col gap-3">
      {families.length > 1 && (
        <div role="tablist" aria-label="Network" className={`grid gap-2 ${families.length > 3 ? "grid-cols-4" : "grid-cols-3"}`}>
          {families.map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={f === family}
              onClick={() => setPicked(f)}
              className={`flex flex-col items-center gap-2 rounded-2xl border px-1 py-3 transition ${f === family ? "border-accent/60 bg-accent/10" : "border-line bg-surface-2/60 hover:border-muted/60"}`}
            >
              <Icon src={FAMILY[f].icon} alt="" size={32} />
              <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">{FAMILY[f].title}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface-2/60 py-2.5 pl-4 pr-2.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">{FAMILY[family].title} wallet</span>
        {mine ? (
          <span className="flex min-w-0 items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-sm">
            <Icon src={mine.icon} alt={mine.name} size={16} />
            <span className="truncate font-mono">{shortAccount(mine.address)}</span>
          </span>
        ) : (
          <button
            type="button"
            disabled={!!connecting}
            onClick={async () => {
              if (await connect(family)) onConnected?.();
            }}
            className="btn-tactile-accent px-4 py-2 text-sm"
          >
            {busy && <span className="size-3.5 animate-spin rounded-full border-2 border-accent-ink/30 border-t-accent-ink" />}
            {busy ? "Waiting for the wallet…" : `Connect ${FAMILY[family].title}`}
          </button>
        )}
      </div>
      <p className="px-1 text-xs text-muted">{FAMILY[family].hint}</p>
      {error && <p className="px-1 text-sm text-danger">{error}</p>}
      <p className="px-1 text-xs text-muted">Passkey near.com logins are not supported yet.</p>
    </div>
  );
}

/** The connect panel as a dialog (a bottom sheet on phones). */
export function ConnectModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title={
        <span className="flex flex-col">
          <span className="font-mono text-[11px] font-normal uppercase tracking-[0.12em] text-muted">Sign in with your near.com wallet</span>
          Connect a wallet
        </span>
      }
      onClose={onClose}
    >
      <ConnectPanel onConnected={onClose} />
    </Modal>
  );
}

/** Header button: the connect dialog, or the connected near.com account with its menu. */
export function WalletMenu() {
  const { wallet, restoring, disconnect } = useWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // the connected account's dropdown closes on a click elsewhere; the connect dialog stays open
  // while AppKit's own modal, which lives outside it, is in use
  useEffect(() => {
    if (!open || !wallet) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open, wallet]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={wallet ? open : undefined}
        aria-haspopup={wallet ? "menu" : "dialog"}
        className={`h-9 px-3.5 text-sm ${wallet ? "btn-tactile" : "btn-tactile-accent"}`}
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
            <WalletIcon />
            <span className="sm:hidden">Connect</span>
            <span className="hidden sm:inline">Connect wallet</span>
          </>
        )}
        {wallet && (
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className={`transition ${open ? "rotate-180" : ""}`}>
            <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        )}
      </button>

      {open && !wallet && <ConnectModal onClose={() => setOpen(false)} />}
      {open && wallet && (
        <div className="absolute right-0 z-50 mt-2 w-[340px] max-w-[calc(100vw-2rem)] rounded-2xl border border-line bg-surface p-3 shadow-2xl shadow-black/50">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3 px-2 py-2">
              <Icon src={wallet.icon} alt={wallet.name} size={32} />
              <div className="min-w-0">
                <p className="text-sm text-muted">{wallet.name} · your near.com account</p>
                <p className="truncate font-mono text-sm" title={`nearcom:${wallet.account}`}>nearcom:{shortAccount(wallet.account)}</p>
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
        </div>
      )}
    </div>
  );
}
