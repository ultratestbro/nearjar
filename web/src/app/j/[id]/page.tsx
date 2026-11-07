import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { DonatePanel } from "@/components/DonatePanel";
import { JarAvatar, JarCover } from "@/components/JarArt";
import { CopyAccount, DonateCta } from "@/components/JarMobile";
import { JarTabs, type SupporterRow } from "@/components/JarTabs";
import { Panel, Pill } from "@/components/ui";
import { RECEIVE_ASSETS, SOURCE_ASSETS, receiveAsset } from "@/lib/assets";
import { jarFeed, type FeedItem } from "@/lib/donations";
import { resolveJar } from "@/lib/jars";
import { EMPTY_PAGE } from "@/lib/pageData";
import { getPage } from "@/lib/pages";
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
  const jar = await resolveJar(decodeURIComponent(id)).catch(() => null);
  if (!jar) notFound();
  const [feed, stored] = await Promise.all([jarFeed(jar.id).catch(() => [] as FeedItem[]), getPage(jar.id).catch(() => null)]);
  const page = stored?.page ?? EMPTY_PAGE;
  // /j/11 and the old numbered links land on the jar's short link, the one it is shared as
  if (page.slug && decodeURIComponent(id) !== page.slug) redirect(`/j/${page.slug}`);

  const asset = receiveAsset(jar.receive_asset) ?? RECEIVE_ASSETS[0];
  const raised = Number(jar.raised_usd_cents) / 100;
  const goal = jar.goal_usd_cents ? Number(jar.goal_usd_cents) / 100 : null;
  const open = jar.status === "Open";
  const supporters: SupporterRow[] = feed.map((f) => {
    const src = SOURCE_ASSETS.find((a) => a.chain === f.sourceChain && a.symbol === f.sourceSymbol);
    return { ...f, icon: src?.icon ?? "", chainLabel: src?.chainLabel ?? f.sourceChain };
  });

  return (
    <Panel className="overflow-hidden pb-20 lg:pb-0">
      {/* Phones: jar, then the donate card, then the tabs. Desktop: the card is a sticky right column
          and the 16:9 cover sits in the left one, so it stays the frame the owner picked without
          pushing the card below the fold. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_420px] lg:grid-rows-[auto_1fr] lg:gap-10 lg:p-8">
        <section className="flex flex-col gap-4 lg:col-start-1">
          <JarCover page={page} legacyImage={jar.image_url}
            className="-mx-4 -mt-4 aspect-video w-[calc(100%+2rem)] max-w-none sm:-mx-6 sm:-mt-6 sm:w-[calc(100%+3rem)] lg:m-0 lg:w-full lg:rounded-2xl" />
          <div className="-mt-14 flex flex-col gap-4 sm:-mt-16">
            <JarAvatar page={page} title={jar.title} size={80} className="relative border-4 border-panel lg:ml-6" />
            <div className="flex flex-col gap-2">
              <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
                <CopyAccount account={jar.owner} />
                {!open && <Pill>Closed</Pill>}
              </p>
              <h1 className="break-words text-3xl font-semibold tracking-tight sm:text-4xl">{jar.title}</h1>
              {page.tagline && <p className="text-lg text-muted">{page.tagline}</p>}
            </div>
          </div>
        </section>

        <div id="donate" className="scroll-mt-4 lg:sticky lg:top-6 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
          <DonatePanel
            jarId={jar.id}
            jarTitle={jar.title}
            receive={asset}
            sources={SOURCE_ASSETS}
            open={open}
            raisedUsd={raised}
            goalUsd={goal}
            supporters={Number(jar.donations_count)}
            presets={page.presets}
            thanks={page.thanks}
            confidential={CONFIDENTIAL_DELIVERY}
            sharePath={`/j/${page.slug ?? jar.id}`}
          />
        </div>

        <section className="flex flex-col gap-6 lg:col-start-1">
          <JarTabs story={jar.description} milestones={page.milestones} links={page.links} raisedUsd={raised} supporters={supporters} count={Number(jar.donations_count)} />
          <p className="text-sm text-muted">
            Donations arrive as {asset.symbol} in <CopyAccount account={jar.owner} />.{" "}
            {CONFIDENTIAL_DELIVERY
              ? "They land in the owner's Confidential near.com balance, ready to use."
              : "They land in the public (legacy) balance; the owner moves them to Confidential in near.com."}
          </p>
        </section>
      </div>

      {open && <DonateCta />}
    </Panel>
  );
}
