"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { FAMILIES, connectWallet, disconnectWallet, type ConnectedWallet, type WalletFamily } from "@/lib/wallet";

const STORAGE_KEY = "nearjar.wallet";

interface WalletState {
  wallet: ConnectedWallet | null;
  /** True until the silent reconnect after a reload has had its chance. */
  restoring: boolean;
  connecting: WalletFamily | null;
  error: string;
  /** Opens the family's wallet modal (AppKit, wallet-selector, TON Connect). */
  connect(family: WalletFamily): Promise<ConnectedWallet | null>;
  disconnect(): void;
}

const Ctx = createContext<WalletState | null>(null);

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet outside WalletProvider");
  return v;
}

function remembered(): WalletFamily | null {
  try {
    // older sessions stored a wallet id such as "evm:io.metamask"
    const f = localStorage.getItem(STORAGE_KEY)?.split(":")[0];
    return FAMILIES.find((x) => x === f) ?? null;
  } catch {
    return null;
  }
}

function remember(family: WalletFamily | null) {
  try {
    if (family) localStorage.setItem(STORAGE_KEY, family);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // private mode: the session just won't survive a reload
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [connecting, setConnecting] = useState<WalletFamily | null>(null);
  const [error, setError] = useState("");
  const tried = useRef(false);

  // pick the remembered wallet back up without a popup
  useEffect(() => {
    if (tried.current) return;
    tried.current = true;
    const family = remembered();
    (family ? connectWallet(family, { silent: true }) : Promise.reject(new Error("none")))
      .then(setWallet)
      .catch(() => remember(null))
      .finally(() => setRestoring(false));
  }, []);

  const connect = useCallback(async (family: WalletFamily) => {
    setError("");
    setConnecting(family);
    try {
      const w = await connectWallet(family);
      setWallet(w);
      remember(family);
      return w;
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(/cancel/i.test(m) ? "" : /reject|denied|4001/i.test(m) ? "You cancelled in the wallet." : m || "Could not connect.");
      return null;
    } finally {
      setConnecting(null);
    }
  }, []);

  const disconnect = useCallback(() => {
    if (wallet) void disconnectWallet(wallet);
    setWallet(null);
    remember(null);
  }, [wallet]);

  return <Ctx.Provider value={{ wallet, restoring, connecting, error, connect, disconnect }}>{children}</Ctx.Provider>;
}
