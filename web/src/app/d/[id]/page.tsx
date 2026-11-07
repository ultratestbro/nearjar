import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DonationStatus } from "@/components/DonationStatus";
import { RECEIVE_ASSETS, assetIcon, receiveAsset, sourceAsset } from "@/lib/assets";
import { refreshDonation, toPublic } from "@/lib/donations";
import { getPage } from "@/lib/pages";

/** A donation's live status, shareable and safe to reopen after closing the tab. */
export default function DonationPage({ params }: PageProps<"/d/[id]">) {
  return (
    <Suspense fallback={<p className="text-muted">Loading donation…</p>}>
      <Donation params={params} />
    </Suspense>
  );
}

async function Donation({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const row = await refreshDonation(id);
  if (!row) notFound();
  const asset = receiveAsset(row.receive_asset) ?? RECEIVE_ASSETS[0];
  const page = (await getPage(row.jar_id).catch(() => null))?.page;
  const jarPath = `/j/${page?.slug ?? row.jar_id}`;
  const donation = toPublic(row);
  const src = sourceAsset(donation.sourceChain, donation.sourceSymbol);
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <div className="rounded-3xl border border-line bg-surface p-5 sm:p-6">
        <DonationStatus initial={donation} receive={asset} thanks={page?.thanks ?? ""} sharePath={jarPath}
          art={{ icon: src?.icon ?? "", chainIcon: src?.chainIcon ?? "", chainLabel: src?.chainLabel ?? donation.sourceChain, receiveIcon: assetIcon(asset.id) }} />
      </div>
      <Link href={jarPath} className="text-sm text-muted underline">Back to the jar</Link>
    </div>
  );
}
