import { SOURCE_ASSETS, receiveAsset } from "@/lib/assets";
import { deliveredFor } from "@/lib/donations";
import { getJarsByOwner } from "@/lib/jars";
import { parseNearComAccount } from "@/lib/nearcom";

const csv = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // quote everything; neutralise spreadsheet formulas in donor-supplied text
  return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};

/** GET ?owner= → CSV of every delivered donation to the owner's jars, one row per donation. */
export async function GET(request: Request) {
  const owner = parseNearComAccount(new URL(request.url).searchParams.get("owner") ?? "");
  if (!owner.ok) return new Response(owner.error, { status: 400 });
  const jars = await getJarsByOwner(owner.id).catch(() => null);
  if (!jars) return new Response("Could not read the contract.", { status: 502 });
  const titles = new Map(jars.map((j) => [j.id, j.title]));
  // the account the contract pays for each jar: its DAO treasury, or the owner
  const paidTo = new Map(jars.map((j) => [j.id, j.payout ?? j.owner]));
  const rows = await deliveredFor(jars.map((j) => j.id));

  const header = ["date_utc", "jar", "paid_to", "donor", "message", "paid_with", "network", "amount_paid", "received", "received_asset", "usd", "source_tx", "delivery_tx"];
  const lines = rows.map((d) => {
    const src = SOURCE_ASSETS.find((a) => a.chain === d.source_chain && a.symbol === d.source_symbol);
    const rec = receiveAsset(d.receive_asset);
    const fmt = (v: string | null, dec: number) => {
      if (!v) return "";
      const n = BigInt(v);
      const base = 10n ** BigInt(dec);
      return `${n / base}.${(n % base).toString().padStart(dec, "0")}`.replace(/\.?0+$/, "");
    };
    return [
      new Date(d.updated_at).toISOString().replace("T", " ").slice(0, 19),
      titles.get(d.jar_id) ?? d.jar_id,
      paidTo.get(d.jar_id) ?? "",
      d.donor_name ?? "Anonymous",
      d.hidden ? "" : (d.message ?? ""),
      d.source_symbol,
      src?.chainLabel ?? d.source_chain,
      src ? fmt(d.amount_in, src.decimals) : d.amount_in,
      rec ? fmt(d.amount_out, rec.decimals) : (d.amount_out ?? ""),
      rec?.symbol ?? d.receive_asset,
      ((d.delivered_usd_cents ?? d.usd_cents) / 100).toFixed(2),
      d.source_tx ?? "",
      d.delivery_tx ?? "",
    ].map(csv).join(",");
  });
  const body = [header.join(","), ...lines].join("\r\n") + "\r\n";
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="nearjar-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
