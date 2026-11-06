import { ADDRESS, balancesOf, type BalanceFamily } from "@/lib/balances";

/** GET ?family=evm|solana|near&address= → the address's balances of the tokens a donor can pay with. */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const family = q.get("family") as BalanceFamily;
  const address = q.get("address") ?? "";
  if (!(family in ADDRESS) || !ADDRESS[family].test(address)) return Response.json({ ok: false, error: "Bad address." }, { status: 400 });
  const balances = await balancesOf(family, address).catch(() => []);
  return Response.json({ ok: true, balances }, { headers: { "cache-control": "private, max-age=20" } });
}
