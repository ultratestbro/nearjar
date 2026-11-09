import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { DaoPayoutLine } from "@/components/Dao";
import { DonatePanel } from "@/components/DonatePanel";
import { JarAvatar, JarCover } from "@/components/JarArt";
import { CopyAccount, DonateCta } from "@/components/JarMobile";
import { NewJarShare } from "@/components/ShareModal";
import { ChippedIn, JarAbout, JarLinkRow, JarSupporters, JustGave, Stat, StatusChip, type SupporterRow } from "@/components/JarSections";
import { Progress, money } from "@/components/ui";
import { RECEIVE_ASSETS, SOURCE_ASSETS, receiveAsset } from "@/lib/assets";
import { daoGovernance } from "@/lib/dao";
import { trezuUrl } from "@/lib/daoPolicy";
import { jarFeed, type FeedItem } from "@/lib/donations";
import { resolveJar } from "@/lib/jars";
import { getPage, trustedPage } from "@/lib/pages";
import { CONFIDENTIAL_DELIVERY } from "@/lib/quote";

// enough delivered donations for the full supporters list and an honest "networks used"
const FEED_LIMIT = 100;

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
  // /j/11, earlier links and other spellings land on the jar's current short link, from the contract
  const canonical = jar.slug ?? jar.id;
  if (decodeURIComponent(id) !== canonical) redirect(`/j/${canonical}`);
  const [feed, stored, dao] = await Promise.all([
    jarFeed(jar.id, FEED_LIMIT).catch(() => [] as FeedItem[]),
    getPage(jar.id).catch(() => null),
    // who decides over the treasury; unknown (and no claims about it) when NEAR can't be asked
    jar.payout ? daoGovernance(jar.payout).catch(() => null) : null,
  ]);
  const page = trustedPage(jar, stored);

  const asset = receiveAsset(jar.receive_asset) ?? RECEIVE_ASSETS[0];
  const raised = Number(jar.raised_usd_cents) / 100;
  const goal = jar.goal_usd_cents ? Number(jar.goal_usd_cents) / 100 : null;
  const open = jar.status === "Open";
  const supporters: SupporterRow[] = feed.map((f) => {
    const src = SOURCE_ASSETS.find((a) => a.chain === f.sourceChain && a.symbol === f.sourceSymbol);
    return { ...f, icon: src?.icon ?? "", chainIcon: src?.chainIcon ?? src?.icon ?? "", chainLabel: src?.chainLabel ?? f.sourceChain };
  });
  const count = Number(jar.donations_count);
  // counted over the loaded feed; "+" when there may be older donations beyond it
  const networks = new Set(feed.map((f) => f.sourceChain)).size;
  const networksText = `${networks}${feed.length >= FEED_LIMIT ? "+" : ""}`;
  const sharePath = `/j/${canonical}`;

  return (
    <div className={open ? "pb-24 lg:pb-0" : ""}>
      {/* The cover is a band with the title over its fade on desktop; on phones the title sits under
          it. Edge to edge up to the page's max width, a rounded frame beyond. */}
      <div className="relative">
        <div className="relative -mx-4 -mt-6 overflow-hidden sm:-mt-8 min-[81rem]:mx-0 min-[81rem]:mt-0 min-[81rem]:rounded-[28px]">
          <JarCover page={page} legacyImage={jar.image_url} className="aspect-video w-full lg:aspect-auto lg:h-[460px]" />
          <div aria-hidden className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-bg to-transparent lg:h-[260px]" />
          <StatusChip open={open} className="absolute right-4 top-3.5 inline-flex bg-bg/70 backdrop-blur lg:hidden" />
        </div>
        <header className="relative -mt-11 lg:absolute lg:inset-x-0 lg:bottom-0 lg:mt-0 lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-8 lg:px-6 lg:pb-8">
          <div className="flex flex-col gap-2.5 lg:flex-row lg:items-end lg:gap-5">
            <JarAvatar page={page} title={jar.title} size={88} className="border-4 border-bg" />
            <div className="min-w-0 flex-1">
              <StatusChip open={open} long className={`hidden lg:inline-flex ${open ? "bg-accent/15" : "bg-bg/70"}`} />
              <h1 className="break-words text-[32px] font-semibold leading-[1.05] tracking-tight lg:mt-2 lg:text-5xl xl:text-[56px] xl:leading-[1.02]">{jar.title}</h1>
              {page.tagline && <p className="mt-1.5 text-text/85 lg:text-lg">{page.tagline}</p>}
              {/* from the contract, like the delivery itself: a DAO jar's payout never comes from the page */}
              {jar.payout && <DaoPayoutLine dao={jar.payout} endorsed={jar.endorsed} governance={dao?.governance ?? null} intentsKeys={dao?.intentsKeys ?? null} className="mt-3" />}
            </div>
          </div>
        </header>
      </div>

      {/* Phones: the donate widget right under the title, then the rest. Desktop: the card is a
          sticky right column that rides up over the cover. */}
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 lg:mt-2 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-8 lg:px-6">
        <div id="donate" className="-mx-4 scroll-mt-4 lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1 lg:mx-0 lg:-mt-[150px] lg:self-start">
          <DonatePanel
            jarId={jar.id}
            jarTitle={jar.title}
            receive={asset}
            sources={SOURCE_ASSETS}
            open={open}
            raisedUsd={raised}
            goalUsd={goal}
            supporters={count}
            presets={page.presets}
            thanks={page.thanks}
            confidential={CONFIDENTIAL_DELIVERY}
            payoutDao={jar.payout}
            sharePath={sharePath}
            footer={<ChippedIn rows={supporters} count={count} />}
          />
        </div>

        <section className="flex min-w-0 flex-col gap-4 lg:col-start-1 lg:row-start-1 lg:gap-6 lg:pt-2">
          <div className="hidden flex-col gap-6 lg:flex">
            {/* 2 × 2 (or 3 across) while the column is narrow, one row once there is room */}
            <div className={`grid gap-2.5 xl:flex ${networks > 0 ? "grid-cols-2" : "grid-cols-3"}`}>
              <Stat value={money(raised, 0)} label={goal ? `raised of ${money(goal, 0)}` : "raised"} />
              <Stat value={String(count)} label={count === 1 ? "supporter" : "supporters"} />
              {networks > 0 && <Stat value={networksText} label={networks === 1 ? "network used" : "networks used"} />}
              <Stat value="0%" label="platform fee" />
            </div>
            {goal && <Progress pct={(raised / goal) * 100} />}
          </div>
          {supporters[0] && <JustGave row={supporters[0]} />}
          <div className="flex gap-2 lg:hidden">
            <Stat size="sm" value={String(count)} label={count === 1 ? "supporter" : "supporters"} />
            {networks > 0 && <Stat size="sm" value={networksText} label={networks === 1 ? "network" : "networks"} />}
            <Stat size="sm" value="0%" label="platform fee" />
          </div>
          <div className="lg:hidden">
            <JarLinkRow links={page.links} sharePath={sharePath} title={jar.title} raisedUsd={raised} />
          </div>

          <JarAbout story={jar.description} links={page.links} milestones={page.milestones} raisedUsd={raised} sharePath={sharePath} title={jar.title} />
          <JarSupporters rows={supporters} count={count} open={open} />

          {jar.payout ? (
            <p className="text-[13px] text-muted lg:text-sm">
              Donations arrive as {asset.symbol} in the public NEAR Intents balance of the DAO treasury{" "}
              <a href={trezuUrl(jar.payout)} target="_blank" rel="noreferrer" className="font-mono text-text underline decoration-line underline-offset-4 hover:decoration-accent">
                {jar.payout}
              </a>
              . Its members see them in Trezu and spend them by proposal
              {dao && !dao.governance.solo && dao.intentsKeys === 0 && dao.governance.spend && dao.governance.spend.approvals > 1
                ? `; no single member can move them (${dao.governance.spend.approvals} approvals needed)`
                : ""}
              . The jar was created by <CopyAccount account={jar.owner} />, and the payout is fixed in the NearJar contract.
            </p>
          ) : (
            <p className="text-[13px] text-muted lg:text-sm">
              Donations arrive as {asset.symbol} in <CopyAccount account={jar.owner} />.{" "}
              {CONFIDENTIAL_DELIVERY
                ? "They land in the owner's Confidential near.com balance, ready to use."
                : "They land in the public (legacy) balance; the owner moves them to Confidential in near.com."}
            </p>
          )}
        </section>
      </div>

      {open && <DonateCta raisedUsd={raised} goalUsd={goal} />}
      <NewJarShare path={sharePath} title={jar.title} raisedUsd={raised} />
    </div>
  );
}
