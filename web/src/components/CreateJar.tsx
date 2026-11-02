"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReceiveAsset } from "@/lib/assets";
import { availableWallets, connect, type ConnectedWallet, type WalletKind } from "@/lib/wallet";

const WALLET_NAMES: Record<WalletKind, string> = { evm: "EVM wallet (MetaMask, Rabby…)", solana: "Solana wallet (Phantom…)" };

export function CreateJar({ assets }: { assets: readonly ReceiveAsset[] }) {
  const [kinds, setKinds] = useState<WalletKind[] | null>(null);
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [goal, setGoal] = useState("");
  const [asset, setAsset] = useState<string>(assets[0]!.id);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ jarId: string; txHash: string } | null>(null);

  // wallet extensions inject after hydration
  useEffect(() => {
    const t = setTimeout(() => setKinds(availableWallets()), 300);
    return () => clearTimeout(t);
  }, []);

  async function onConnect(kind: WalletKind) {
    setError("");
    try {
      setWallet(await connect(kind));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect.");
    }
  }

  async function onCreate() {
    if (!wallet) return;
    setError("");
    try {
      setBusy("Preparing…");
      const prep = (await post("/api/jars/prepare", {
        signerId: wallet.account,
        action: "create_jar",
        jar: { title, description, goal_usd: goal || null, receive_asset: asset },
      })) as { ok: boolean; message?: string; error?: string };
      if (!prep.ok || !prep.message) throw new Error(prep.error ?? "Could not prepare the jar.");

      setBusy("Sign the message in your wallet…");
      const signed = await wallet.sign(prep.message);

      setBusy("Creating the jar on NEAR…");
      const res = (await post("/api/jars", { signed })) as { ok: boolean; jarId?: string; txHash?: string; error?: string };
      if (!res.ok || !res.jarId) throw new Error(res.error ?? "The jar was not created.");
      setCreated({ jarId: res.jarId, txHash: res.txHash ?? "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy("");
    }
  }

  if (created) {
    const link = `${window.location.origin}/j/${created.jarId}`;
    return (
      <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6">
        <h2 className="text-xl font-semibold">Your jar is live</h2>
        <p className="break-all font-mono text-sm">{link}</p>
        <div className="flex gap-3">
          <Link href={`/j/${created.jarId}`} className="rounded-full bg-accent px-5 py-2.5 font-medium text-accent-ink">Open jar</Link>
          <button type="button" onClick={() => navigator.clipboard.writeText(link)} className="rounded-full border border-line px-5 py-2.5">
            Copy link
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <section className="flex flex-col gap-3 rounded-3xl border border-line bg-surface p-6">
        <h2 className="font-semibold">1. Connect the wallet you use for near.com</h2>
        {wallet ? (
          <div className="text-sm">
            <p className="text-muted">Donations will arrive in this near.com account — compare it with Receive in near.com:</p>
            <p className="mt-1 break-all font-mono">nearcom:{wallet.account}</p>
          </div>
        ) : kinds === null ? (
          <p className="text-sm text-muted">Looking for wallets…</p>
        ) : kinds.length === 0 ? (
          <p className="text-sm text-muted">No browser wallet found. Install MetaMask, Rabby or Phantom.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {kinds.map((k) => (
              <button key={k} type="button" onClick={() => onConnect(k)} className="rounded-full border border-line px-4 py-2 text-sm hover:border-accent">
                {WALLET_NAMES[k]}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className={`flex flex-col gap-3 rounded-3xl border border-line bg-surface p-6 ${wallet ? "" : "opacity-50"}`}>
        <h2 className="font-semibold">2. Describe the jar</h2>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="Title"
          className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 outline-none focus:border-accent" />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={4} placeholder="What is it for?"
          className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 outline-none focus:border-accent" />
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-sm text-muted">
            Goal, USD (optional)
            <input value={goal} onChange={(e) => setGoal(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal"
              className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-text outline-none focus:border-accent" />
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted">
            Receive as
            <select value={asset} onChange={(e) => setAsset(e.target.value)} className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-text">
              {assets.map((a) => (
                <option key={a.id} value={a.id}>{a.symbol}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {error && <p className="text-sm text-danger">{error}</p>}
      <button type="button" onClick={onCreate} disabled={!wallet || !title.trim() || !!busy}
        className="rounded-full bg-accent px-5 py-3 font-medium text-accent-ink disabled:opacity-50">
        {busy || "Sign and create jar"}
      </button>
      <p className="text-xs text-muted">
        You sign one message, no transaction and no gas. NearJar&apos;s relayer pays for the NEAR transaction; the contract only
        accepts it if near.com (intents.near) confirms the key belongs to your account.
      </p>
    </div>
  );
}

async function post(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return res.json();
}
