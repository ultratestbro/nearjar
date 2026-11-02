import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DonationStatus } from "@/components/DonationStatus";
import { RECEIVE_ASSETS, receiveAsset } from "@/lib/assets";
import { refreshDonation, toPublic } from "@/lib/donations";

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
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <DonationStatus initial={toPublic(row)} receive={asset} />
      <Link href={`/j/${row.jar_id}`} className="text-sm text-muted underline">Back to the jar</Link>
    </div>
  );
}
