"use client";

import Link from "next/link";
import { useState } from "react";
import type { ReceiveAsset } from "@/lib/assets";
import { Select } from "./Select";
import { Card, Icon, shortAccount } from "./ui";
import { WalletOptions } from "./WalletMenu";
import { useWallet } from "./WalletProvider";

type AssetWithIcon = ReceiveAsset & { icon: string };

export function CreateJar({ assets }: { assets: readonly AssetWithIcon[] }) {
  const { wallet, disconnect } = useWallet();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [goal, setGoal] = useState("");
  const [asset, setAsset] = useState<string>(assets[0]!.id);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ jarId: string; txHash: string } | null>(null);
  const receive = assets.find((a) => a.id === asset) ?? assets[0]!;

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

      setBusy(`Sign the message in ${wallet.name}…`);
      const signed = await wallet.sign(prep.message);

      setBusy("Creating the jar on NEAR…");
      const res = (await post("/api/jars", { signed })) as { ok: boolean; jarId?: string; txHash?: string; error?: string };
      if (!res.ok || !res.jarId) throw new Error(res.error ?? "The jar was not created.");
      setCreated({ jarId: res.jarId, txHash: res.txHash ?? "" });
    } catch (e) {
      const m = e instanceof Error ? e.message : "Something went wrong.";
      setError(/reject|denied|4001|cancel/i.test(m) ? "You cancelled in the wallet." : m);
    } finally {
      setBusy("");
    }
  }

  if (created) {
    const link = `${window.location.origin}/j/${created.jarId}`;
    return (
      <Card className="flex max-w-2xl flex-col gap-4">
        <span className="grid size-12 place-items-center rounded-full bg-accent/15 text-2xl text-accent">✓</span>
        <h2 className="text-2xl font-semibold">Your jar is live</h2>
        <p className="break-all rounded-xl bg-surface-2 px-3 py-2 font-mono text-sm">{link}</p>
        <div className="flex flex-wrap gap-3">
          <Link href={`/j/${created.jarId}`} className="rounded-full bg-accent px-5 py-2.5 font-medium text-accent-ink">Open jar</Link>
          <button type="button" onClick={() => navigator.clipboard.writeText(link)} className="rounded-full border border-line px-5 py-2.5">
            Copy link
          </button>
        </div>
      </Card>
    );
  }

  const field = "rounded-xl border border-line bg-surface-2 px-3 py-2.5 outline-none focus:border-accent";
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex flex-col gap-6">
        <Card className="flex flex-col gap-4">
          <Step n={1} title="Connect the wallet you use for near.com" done={!!wallet} />
          {wallet ? (
            <div className="flex items-center gap-3 rounded-2xl border border-accent/30 bg-accent/5 p-3">
              <Icon src={wallet.icon} alt={wallet.name} size={32} />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-muted">Donations arrive in — compare with Receive in near.com</p>
                <p className="break-all font-mono text-sm">nearcom:{wallet.account}</p>
              </div>
              <button type="button" onClick={disconnect} className="shrink-0 text-sm text-muted underline">Switch</button>
            </div>
          ) : (
            <WalletOptions />
          )}
        </Card>

        <Card className={`flex flex-col gap-4 ${wallet ? "" : "pointer-events-none opacity-50"}`}>
          <Step n={2} title="Describe the jar" done={!!title.trim()} />
          <label className="flex flex-col gap-1.5 text-sm text-muted">
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="Help Ana finish her film" className={`${field} text-text`} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-muted">
            What is it for? <span className="sr-only">(optional)</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={4} placeholder="A few lines donors will read" className={`${field} text-text`} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm text-muted">
              Goal, USD (optional)
              <span className={`flex items-center ${field}`}>
                <span className="text-muted">$</span>
                <input value={goal} onChange={(e) => setGoal(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder="1,000" className="w-full bg-transparent px-1 text-text outline-none" />
              </span>
            </label>
            <div className="flex flex-col gap-1.5 text-sm text-muted">
              Receive as
              <Select
                label="Receive as"
                value={asset}
                onChange={setAsset}
                options={assets.map((a) => ({ value: a.id, label: a.symbol, icon: a.icon, hint: "in near.com" }))}
              />
            </div>
          </div>
        </Card>

        {error && <p className="text-sm text-danger">{error}</p>}
        <button type="button" onClick={onCreate} disabled={!wallet || !title.trim() || !!busy}
          className="flex items-center justify-center gap-3 rounded-full bg-accent px-5 py-3.5 font-medium text-accent-ink disabled:opacity-50">
          {busy && <span className="size-4 animate-spin rounded-full border-2 border-accent-ink/30 border-t-accent-ink" />}
          {busy || "Sign and create jar"}
        </button>
        <p className="text-xs text-muted">
          You sign one message, no transaction and no gas. NearJar&apos;s relayer pays for the NEAR transaction; the contract only
          accepts it if near.com (intents.near) confirms the key belongs to your account.
        </p>
      </div>

      <aside className="flex flex-col gap-3 lg:sticky lg:top-6 lg:self-start">
        <p className="text-sm uppercase tracking-wider text-muted">Preview</p>
        <Card className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <span className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-accent/80 to-accent/20 text-xl font-semibold text-accent-ink">
              {(title.trim() || "J").slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate font-semibold">{title.trim() || "Your jar title"}</p>
              <p className="truncate font-mono text-xs text-muted">{wallet ? `nearcom:${shortAccount(wallet.account)}` : "nearcom:…"}</p>
            </div>
          </div>
          <p className="line-clamp-4 whitespace-pre-line text-sm text-muted">{description.trim() || "What the jar is for appears here."}</p>
          <div>
            <p className="text-2xl font-semibold">$0</p>
            <p className="text-xs text-muted">{goal ? `of $${Number(goal).toLocaleString("en-US")}` : "no goal"}</p>
          </div>
          {goal && <div className="h-2 rounded-full bg-surface-2" />}
          <p className="flex items-center gap-2 text-xs text-muted">
            <Icon src={receive.icon} alt={receive.symbol} size={16} /> Arrives as {receive.symbol} in near.com
          </p>
        </Card>
      </aside>
    </div>
  );
}

function Step({ n, title, done }: { n: number; title: string; done: boolean }) {
  return (
    <h2 className="flex items-center gap-3 font-semibold">
      <span className={`grid size-7 place-items-center rounded-full text-sm ${done ? "bg-accent text-accent-ink" : "bg-surface-2 text-muted"}`}>{done ? "✓" : n}</span>
      {title}
    </h2>
  );
}

async function post(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return res.json();
}
