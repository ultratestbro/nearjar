"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { connectWallet, disconnectWallet, discoverWallets, type ConnectedWallet, type WalletOption } from "@/lib/wallet";

const STORAGE_KEY = "nearjar.wallet";

interface WalletState {
  /** Wallets this browser offers, with names and icons. */
  options: WalletOption[];
  wallet: ConnectedWallet | null;
  /** True until discovery and the silent reconnect after a reload have had their chance. */
  restoring: boolean;
  connecting: string | null;
  error: string;
  connect(id: string): Promise<ConnectedWallet | null>;
  disconnect(): void;
}

const Ctx = createContext<WalletState | null>(null);

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet outside WalletProvider");
  return v;
}

function remembered(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function remember(id: string | null) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // private mode: the session just won't survive a reload
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<WalletOption[]>([]);
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState("");
  const tried = useRef(false);

  useEffect(() => {
    const stop = discoverWallets(setOptions);
    // extensions announce within a few hundred ms; then try the remembered wallet without a popup
    const t = setTimeout(async () => {
      const id = remembered();
      if (id && !tried.current) {
        tried.current = true;
        try {
          setWallet(await connectWallet(id, { silent: true }));
        } catch {
          remember(null);
        }
      }
      setRestoring(false);
    }, 600);
    return () => {
      stop();
      clearTimeout(t);
    };
  }, []);

  const connect = useCallback(async (id: string) => {
    setError("");
    setConnecting(id);
    try {
      const w = await connectWallet(id);
      setWallet(w);
      remember(id);
      return w;
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(/reject|denied|4001|cancel/i.test(m) ? "You cancelled in the wallet." : m || "Could not connect.");
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

  return <Ctx.Provider value={{ options, wallet, restoring, connecting, error, connect, disconnect }}>{children}</Ctx.Provider>;
}
