import { checkDao } from "@/lib/dao";
import { parseDaoId, trezuUrl } from "@/lib/daoPolicy";
import { parseNearComAccount } from "@/lib/nearcom";

// per-instance throttle: each lookup costs a few RPC calls, which plain jars and quotes share
const hits = new Map<string, number[]>();
function throttled(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 600_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 60;
}

/**
 * GET ?id=<DAO name, id or trezu.app link>&account=<near.com account>
 * → { ok, dao, exists, members, roles, accountRoles, isMember, canSpendIntents, governance,
 * intentsKeys, problem, trezuUrl } for the editor's live check. Publishing runs the same check
 * again, this is only the preview.
 */
export async function GET(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (throttled(ip)) return Response.json({ ok: false, error: "Too many requests, try again later." }, { status: 429 });
  const q = new URL(request.url).searchParams;
  const dao = parseDaoId(q.get("id"));
  if (!dao) return Response.json({ ok: false, error: "That isn't a Sputnik DAO: use name.sputnik-dao.near or a trezu.app link." }, { status: 400 });
  const account = parseNearComAccount(q.get("account") ?? "");
  const r = await checkDao(dao, account.ok ? account.id : null);
  if (!r.ok) return Response.json({ ok: false, dao, error: r.error }, { status: r.status });
  return Response.json({ ok: true, ...r.check, trezuUrl: trezuUrl(dao) });
}
