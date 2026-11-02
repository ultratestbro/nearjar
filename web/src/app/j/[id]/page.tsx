import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DonatePanel } from "@/components/DonatePanel";
import { RECEIVE_ASSETS, SOURCE_ASSETS, receiveAsset } from "@/lib/assets";
import { getJar } from "@/lib/jars";

export default function JarPage({ params }: PageProps<"/j/[id]">) {
  return (
    <Suspense fallback={<p className="text-muted">Loading jar…</p>}>
      <Jar params={params} />
    </Suspense>
  );
}

async function Jar({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jar = await getJar(id).catch(() => null);
  if (!jar) notFound();

  const asset = receiveAsset(jar.receive_asset) ?? RECEIVE_ASSETS[0];
  const raised = Number(jar.raised_usd_cents) / 100;
  const goal = jar.goal_usd_cents ? Number(jar.goal_usd_cents) / 100 : null;
  const pct = goal ? Math.min(100, (raised / goal) * 100) : null;

  return (
    <div className="grid gap-8 md:grid-cols-[1fr_420px]">
      <section className="flex flex-col gap-5">
        <h1 className="text-3xl font-semibold tracking-tight">{jar.title}</h1>
        <p className="whitespace-pre-line text-muted">{jar.description}</p>

        <div className="rounded-2xl border border-line bg-surface p-5">
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-semibold">${raised.toLocaleString("en-US")}</span>
            {goal && <span className="text-sm text-muted">of ${goal.toLocaleString("en-US")}</span>}
          </div>
          {pct !== null && (
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
            </div>
          )}
          <p className="mt-3 text-sm text-muted">{jar.donations_count} donations</p>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-5 text-sm">
          <p className="text-muted">Donations arrive in this near.com account as {asset.symbol}:</p>
          <p className="mt-1 break-all font-mono">nearcom:{jar.owner}</p>
        </div>
      </section>

      <DonatePanel jarId={jar.id} receive={asset} sources={SOURCE_ASSETS} open={jar.status === "Open"} />
    </div>
  );
}
