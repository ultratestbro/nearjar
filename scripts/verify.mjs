#!/usr/bin/env node
// Read-only check of NearJar's claims against NEAR mainnet and the live site. No install, no keys, nothing is signed.
//   node scripts/verify.mjs                          (Node 22+)
//   node scripts/verify.mjs --site http://localhost:3000
// Prints PASS / FAIL per claim and exits 1 if any claim fails.

const args = process.argv.slice(2);
const SITE = (args.includes("--site") ? args[args.indexOf("--site") + 1] : "https://nearjar.xyz").replace(/\/$/, "");
const RPC = ["https://free.rpc.fastnear.com", "https://rpc.mainnet.near.org"];
// old transactions are only on archival nodes
const ARCHIVAL = "https://archival-rpc.mainnet.fastnear.com";

const CONTRACT = "nearjar.near";
const RELAYER = "relayer.nearjar.near";
const CODE_HASH = "GxM9VeG6KT2uBAygcWP1mTRPVDDL9UpEZzFXBY1H6KzW"; // contract/ 0.2.0, see contract/README.md
const DAO = "nearjar-demo.sputnik-dao.near";
const DAO_JAR = "1";
// donors' payments, by the network name in the site's CSV export
const EVM_RPC = {
  Ethereum: "https://ethereum-rpc.publicnode.com",
  Base: "https://base-rpc.publicnode.com",
  Arbitrum: "https://arbitrum-one-rpc.publicnode.com",
  Optimism: "https://optimism-rpc.publicnode.com",
  Polygon: "https://polygon-bor-rpc.publicnode.com",
};

let failed = 0;
const pass = (claim, detail = "") => console.log(`PASS  ${claim}${detail ? `: ${detail}` : ""}`);
const fail = (claim, detail = "") => {
  failed++;
  console.log(`FAIL  ${claim}${detail ? `: ${detail}` : ""}`);
};

async function rpc(method, params, urls = RPC) {
  let last;
  for (const url of urls) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal: AbortSignal.timeout(15_000),
        });
        if (res.status === 429) {
          await new Promise((r) => setTimeout(r, 1_000 * (attempt + 1)));
          continue;
        }
        const body = await res.json();
        if (body.error) throw new Error(JSON.stringify(body.error).slice(0, 200));
        return body.result;
      } catch (e) {
        last = e;
        break;
      }
    }
  }
  throw last ?? new Error(`${method}: no RPC answered`);
}

const view = async (account, method, a = {}) => {
  const r = await rpc("query", {
    request_type: "call_function",
    finality: "final",
    account_id: account,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(a)).toString("base64"),
  });
  return JSON.parse(Buffer.from(r.result).toString());
};

async function check(claim, fn) {
  try {
    await fn();
  } catch (e) {
    fail(claim, e.message);
  }
}

console.log(`NearJar verify · contract ${CONTRACT} · site ${SITE}\n`);

await check("contract code", async () => {
  const acc = await rpc("query", { request_type: "view_account", finality: "final", account_id: CONTRACT });
  const cfg = await view(CONTRACT, "get_config");
  if (acc.code_hash !== CODE_HASH) return fail("contract code", `code_hash ${acc.code_hash}, README says ${CODE_HASH}`);
  pass("contract code", `${CONTRACT} runs ${CODE_HASH} (the build of contract/), version ${cfg.version}, ${cfg.jars_count} jars`);
});

await check("operator key", async () => {
  const { keys } = await rpc("query", { request_type: "view_access_key_list", finality: "final", account_id: CONTRACT });
  const full = keys.filter((k) => k.access_key.permission === "FullAccess").length;
  if (keys.length !== 1 || full !== 1) return fail("operator key", `${CONTRACT} has ${keys.length} keys, ${full} full-access; the README says one, the operator's`);
  pass("operator key", `${CONTRACT} has ${full} full-access key (the operator's): the contract can be upgraded, and an upgrade would change code_hash above`);
});

await check("relayer key", async () => {
  const { keys } = await rpc("query", { request_type: "view_access_key_list", finality: "final", account_id: RELAYER });
  const scoped = keys.filter((k) => {
    const fc = k.access_key.permission.FunctionCall;
    return fc && fc.receiver_id === CONTRACT && [...fc.method_names].sort().join() === "record_donation,submit";
  });
  if (!scoped.length) return fail("relayer key", `no FunctionCall key limited to submit and record_donation on ${CONTRACT}`);
  const cfg = await view(CONTRACT, "get_config");
  if (cfg.relayers?.length !== 1 || cfg.relayers[0] !== RELAYER) return fail("relayer key", `get_config relayers: ${JSON.stringify(cfg.relayers)}`);
  pass("relayer key", `${RELAYER}, the contract's only relayer, holds a FunctionCall key for ${CONTRACT} limited to submit and record_donation`);
});

let jars = [];
await check("jars", async () => {
  jars = await view(CONTRACT, "get_jars", { from: "0", limit: 100 });
  const total = jars.reduce((s, j) => s + Number(j.raised_usd_cents ?? 0), 0);
  pass("jars", `${jars.length} jars, $${(total / 100).toFixed(2)} raised in total`);
  for (const j of jars) console.log(`      #${j.id} /j/${j.slug} ${j.status}${j.payout ? ` → ${j.payout}` : ""} $${(Number(j.raised_usd_cents ?? 0) / 100).toFixed(2)}`);
});

await check("DAO jar", async () => {
  const j = jars.find((x) => x.id === DAO_JAR) ?? (await view(CONTRACT, "get_jar", { jar_id: DAO_JAR }));
  if (j?.payout !== DAO) return fail("DAO jar", `jar ${DAO_JAR} pays ${j?.payout}, expected ${DAO}`);
  if (j.endorsed !== true) return fail("DAO jar", `jar ${DAO_JAR} is not endorsed`);
  pass("DAO jar", `jar ${DAO_JAR} pays the treasury ${DAO} (fixed in the contract) and is endorsed`);
});

await check("DAO vote", async () => {
  const p = await view(DAO, "get_proposal", { id: 1 });
  const fc = p.kind?.FunctionCall;
  const call = fc?.actions?.find((a) => a.method_name === "endorse_jar");
  const callArgs = call ? JSON.parse(Buffer.from(call.args, "base64").toString()) : null;
  if (p.status !== "Approved" || fc?.receiver_id !== CONTRACT || callArgs?.jar_id !== DAO_JAR)
    return fail("DAO vote", `proposal 1 is ${p.status}, ${fc?.receiver_id} ${call?.method_name} ${JSON.stringify(callArgs)}`);
  const viaTrezu = /trezu/i.test(p.description ?? "");
  pass("DAO vote", `${DAO} proposal 1 (${p.status}) called ${CONTRACT}.endorse_jar(${JSON.stringify(callArgs)})${viaTrezu ? ", filed from a Trezu request template" : ""}`);
  const policy = await view(DAO, "get_policy");
  const roles = policy.roles.map((r) => `${r.name}: ${r.kind.Group ? r.kind.Group.length : r.kind === "Everyone" ? "everyone" : "?"}`).join(", ");
  console.log(`      its roles today: ${roles}`);
});

// "5.002446" and "5002446" (base units) carry the same digits
const digits = (v) => String(v).replace(".", "").replace(/^0+/, "").replace(/0+$/, "");

/** The site's CSV export for an owner: payment network, token, amount and tx for each delivered donation. */
async function exportRows(owner) {
  const text = await (await fetch(`${SITE}/api/jars/export?owner=${owner}`, { signal: AbortSignal.timeout(30_000) })).text();
  const [head, ...lines] = text.trim().split(/\r?\n/);
  const cols = head.split(",");
  return lines.map((l) => Object.fromEntries([...l.matchAll(/"((?:[^"]|"")*)"/g)].map((m, i) => [cols[i], m[1].replace(/""/g, '"')])));
}

async function evmPayment(row, depositAddress) {
  const url = EVM_RPC[row.network];
  if (!url) return `payment on ${row.network} not checked (no RPC for it in this script)`;
  const [receipt, tx] = await Promise.all([
    rpc("eth_getTransactionReceipt", [row.source_tx], [url]),
    rpc("eth_getTransactionByHash", [row.source_tx], [url]),
  ]);
  if (receipt?.status !== "0x1") throw new Error(`payment ${row.source_tx} on ${row.network} did not succeed`);
  const to = depositAddress.toLowerCase();
  const native = tx.to?.toLowerCase() === to && digits(BigInt(tx.value).toString()) === digits(row.amount_paid);
  const token = receipt.logs.some(
    (l) => l.topics[0] === "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" && `0x${l.topics[2]?.slice(26)}` === to && digits(BigInt(l.data).toString()) === digits(row.amount_paid),
  );
  if (!native && !token) throw new Error(`payment ${row.source_tx} doesn't send ${row.amount_paid} ${row.paid_with} to the deposit address ${depositAddress}`);
  return `${row.amount_paid} ${row.paid_with} on ${row.network} to 1Click's deposit address (${row.source_tx})`;
}

await check("donations", async () => {
  let n = 0;
  const rows = new Map();
  for (const owner of new Set(jars.map((j) => j.owner))) for (const r of await exportRows(owner)) rows.set(r.delivery_tx, r);
  for (const j of jars) {
    const ds = await view(CONTRACT, "get_donations", { jar_id: j.id, from: "0", limit: 100 });
    for (const d of ds) {
      n++;
      const claim = `donation to jar ${j.id}`;
      const usd = `$${(Number(d.usd_cents) / 100).toFixed(2)}`;
      const row = rows.get(d.delivery_tx);
      if (!row) {
        fail(claim, `${usd}: ${SITE}/api/jars/export has no row for ${d.delivery_tx}`);
        continue;
      }
      try {
        const paid = await evmPayment(row, d.source_id);
        const tx = await rpc("tx", { tx_hash: d.delivery_tx, sender_account_id: "intents.near", wait_until: "NONE" }, [ARCHIVAL]);
        if (Object.keys(tx.status)[0] !== "SuccessValue") throw new Error(`settlement ${d.delivery_tx} did not succeed`);
        const moved = tx.receipts_outcome
          .flatMap((o) => o.outcome.logs)
          .filter((l) => l.startsWith("EVENT_JSON:"))
          .map((l) => JSON.parse(l.slice(11)))
          .filter((e) => e.event === "mt_transfer")
          .flatMap((e) => e.data.flatMap((m) => m.token_ids.map((t, i) => ({ to: m.new_owner_id, token: t, amount: m.amounts[i] }))));
        let settled;
        if (j.payout) {
          // a DAO jar is paid with INTENTS: the settlement names the treasury, the asset and the amount
          if (!moved.some((m) => m.to === j.payout && m.token === d.asset && m.amount === d.amount))
            throw new Error(`settlement ${d.delivery_tx} doesn't credit ${d.amount} ${d.asset} to ${j.payout}`);
          settled = `${d.amount} ${d.asset} credited to ${j.payout}`;
        } else {
          // CONFIDENTIAL_INTENTS: on chain only the paid asset entering the confidential balance shows; the recipient doesn't
          if (!moved.some((m) => digits(m.amount) === digits(row.amount_paid)))
            throw new Error(`settlement ${d.delivery_tx} doesn't move the paid ${row.amount_paid} ${row.paid_with}`);
          settled = `the paid ${row.amount_paid} ${row.paid_with} entered the Confidential Intents balance (recipient not shown on chain)`;
        }
        pass(claim, `${usd}: ${paid} → settlement ${d.delivery_tx}: ${settled} → receipt of ${row.received} ${row.received_asset}`);
      } catch (e) {
        fail(claim, `${usd}: ${e.message}`);
      }
    }
  }
  if (!n) fail("donations", "no receipts on the contract");
});

await check("live quote", async () => {
  const res = await fetch(`${SITE}/api/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jarId: "3", usdCents: 500, sourceChain: "solana:mainnet", sourceSymbol: "USDC" }),
    signal: AbortSignal.timeout(30_000),
  });
  const b = await res.json();
  if (!b.ok || !b.quote?.dry || b.quote.depositAddress) return fail("live quote", JSON.stringify(b).slice(0, 200));
  pass("live quote", `$5 of USDC on Solana (${b.quote.amountInFormatted} USDC) → ${(Number(b.quote.amountOut) / 1e6).toFixed(6)} USDC to jar 3's owner, ETA ${b.quote.etaSeconds} s: a dry NEAR Intents quote, no deposit address, nothing charged`);
});

await check("live DAO check", async () => {
  const owner = jars.find((x) => x.id === DAO_JAR)?.owner;
  if (!owner) return fail("live DAO check", `jar ${DAO_JAR} not read`);
  const res = await fetch(`${SITE}/api/dao?id=nearjar-demo&account=${owner}`, { signal: AbortSignal.timeout(30_000) });
  const b = await res.json();
  const out = await (await fetch(`${SITE}/api/dao?id=nearjar-demo&account=random-outsider.near`, { signal: AbortSignal.timeout(30_000) })).json();
  if (!b.ok || !b.isMember || !b.canSpendIntents || out.ok !== true || out.isMember !== false)
    return fail("live DAO check", JSON.stringify({ member: b, outsider: out }).slice(0, 300));
  pass("live DAO check", `${DAO}: the jar owner is a member (${b.accountRoles.join(", ")}), an outsider is not, the DAO can spend NEAR Intents funds`);
});

console.log(failed ? `\n${failed} claim(s) failed` : "\nAll claims hold.");
process.exit(failed ? 1 : 0);
