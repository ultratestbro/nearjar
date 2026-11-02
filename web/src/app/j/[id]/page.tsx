import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DonatePanel } from "@/components/DonatePanel";
import { ShareJar } from "@/components/ShareJar";
import { Card, Icon, Pill, shortAccount } from "@/components/ui";
import { RECEIVE_ASSETS, SOURCE_ASSETS, receiveAsset } from "@/lib/assets";
import { jarFeed, type FeedItem } from "@/lib/donations";
import { getJar } from "@/lib/jars";
import { CONFIDENTIAL_DELIVERY } from "@/lib/quote";

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
  const feed = await jarFeed(jar.id).catch(() => [] as FeedItem[]);

  const asset = receiveAsset(jar.receive_asset) ?? RECEIVE_ASSETS[0];
  const raised = Number(jar.raised_usd_cents) / 100;
  const goal = jar.goal_usd_cents ? Number(jar.goal_usd_cents) / 100 : null;
  const pct = goal ? Math.min(100, (raised / goal) * 100) : null;
  const open = jar.status === "Open";

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_440px]">
      <section className="flex flex-col gap-6">
        <div className="flex items-start gap-4">
          {jar.image_url ? (
            <img src={jar.image_url} alt="" className="size-16 shrink-0 rounded-2xl object-cover" />
          ) : (
            <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-accent/80 to-accent/20 text-2xl font-semibold text-accent-ink">
              {jar.title.slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{jar.title}</h1>
              <Pill tone={open ? "accent" : "muted"}>{open ? "Open" : "Closed"}</Pill>
            </div>
            <p className="text-sm text-muted">
              by <span className="font-mono">nearcom:{shortAccount(jar.owner)}</span>
            </p>
          </div>
        </div>

        {jar.description && <p className="whitespace-pre-line text-lg text-muted">{jar.description}</p>}

        <Card className="flex flex-col gap-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-sm text-muted">Raised</p>
              <p className="text-4xl font-semibold tracking-tight">${raised.toLocaleString("en-US", { maximumFractionDigits: 2 })}</p>
            </div>
            <div className="text-right text-sm text-muted">
              {goal && <p>goal ${goal.toLocaleString("en-US")}</p>}
              <p>{jar.donations_count} donations</p>
            </div>
          </div>
          {pct !== null && (
            <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(pct, 1)}%` }} />
            </div>
          )}
          <ShareJar jarId={jar.id} title={jar.title} />
        </Card>

        <Card className="flex flex-col gap-4">
          <h2 className="font-semibold">Recent supporters</h2>
          {feed.length === 0 ? (
            <p className="text-muted">No donations yet. Be the first.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {feed.map((f) => (
                <FeedRow key={f.id} f={f} />
              ))}
            </ul>
          )}
        </Card>

        <p className="text-sm text-muted">
          Donations arrive as {asset.symbol} in <span className="break-all font-mono">nearcom:{jar.owner}</span>.{" "}
          {CONFIDENTIAL_DELIVERY
            ? "They land in the owner's Confidential near.com balance, ready to use."
            : "They land in the public (legacy) balance; the owner moves them to Confidential in near.com."}
        </p>
      </section>

      <div className="lg:sticky lg:top-6 lg:self-start">
        <DonatePanel jarId={jar.id} receive={asset} sources={SOURCE_ASSETS} open={open} />
      </div>
    </div>
  );
}

function FeedRow({ f }: { f: FeedItem }) {
  const src = SOURCE_ASSETS.find((a) => a.chain === f.sourceChain && a.symbol === f.sourceSymbol);
  return (
    <li className="flex items-start gap-3 py-3">
      <Icon src={src?.icon} alt={f.sourceSymbol} size={28} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate font-medium">{f.name ?? "Anonymous"}</span>
          <span className="shrink-0 font-semibold">${(f.usdCents / 100).toFixed(2)}</span>
        </div>
        {f.message && <p className="whitespace-pre-line break-words text-muted">{f.message}</p>}
        <span className="text-xs text-muted">
          {f.sourceSymbol} on {src?.chainLabel ?? f.sourceChain} · {ago(f.at)}
        </span>
      </div>
    </li>
  );
}

function ago(ms: number): string {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}
