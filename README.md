# NearJar

**Donation jars for near.com accounts, payable from any chain.**

A near.com user creates a jar and shares a link. Donors pay from the wallet and chain they already use (EVM chains, Solana, TON, Tron, Bitcoin, NEAR, Zcash and more, 26 networks in all) or send from an exchange. NEAR Intents delivers every donation straight into the creator's near.com balance, in the asset the creator picked (USDC by default). The creator signs one message to create a jar: no gas, no new account.

- **Live:** https://nearjar.xyz (NEAR mainnet)
- **Contract:** [`nearjar.near`](https://nearblocks.io/address/nearjar.near) · relayer [`relayer.nearjar.near`](https://nearblocks.io/address/relayer.nearjar.near)
- **Built at the [NEAR Hackathon](https://nearhackathon.com)** (Nov 2026) · tracks: Real-World Money, Social Money, Open Innovation

> NearJar is an independent concept, not an official near.com product. It is designed as a feature near.com could embed.

nearblocks.io answers scripted requests with a Cloudflare 403. The same facts over NEAR RPC (needs `curl` and `jq`):

```sh
# the deployed code: GxM9VeG6KT2uBAygcWP1mTRPVDDL9UpEZzFXBY1H6KzW, the bs58 SHA-256 that `cargo near build` prints for contract/ (0.2.0)
curl -s https://free.rpc.fastnear.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_account","finality":"final","account_id":"nearjar.near"}}' \
  | jq -r .result.code_hash

# the relayer's keys
curl -s https://free.rpc.fastnear.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_access_key_list","finality":"final","account_id":"relayer.nearjar.near"}}' \
  | jq -c '.result.keys[].access_key.permission'
```

→ `{"FunctionCall":{"allowance":null,"method_names":["submit","record_donation"],"receiver_id":"nearjar.near"}}` is the key the server holds. The other key, `"FullAccess"`, stays with the operator and is not on the server.

## The problem

A near.com account has an internal address (`nearcom:0x…`) that only works between near.com users. near.com warns: *"Your funds will be lost if you send to this address on any blockchain."* So a creator who lives in near.com has no simple way to take money from a supporter holding USDT on Tron, SOL or BTC.

NearJar turns that account into a payment link that works from any chain.

## Try it in 2 minutes (no wallet, no money)

1. Open https://nearjar.xyz → the hero shows every network donors can pay from, with coins dropping into the jar.
2. Open https://nearjar.xyz/j/support → a jar page: cover, goal, supporters and a donate card.
3. In the donate card type `5`, press **Pay with**, pick **Solana** in the network list, then **USDC** → above the **Donate $5** button a live NEAR Intents quote appears: `<amount> USDC · creator gets ≈ <amount> USDC · ~<n> min`. It is a *dry* quote: no deposit address is created and nothing is charged.
4. Press **Donate $5** → *Review · $5* shows the route (USDC on Solana → NEAR Intents → USDC on near.com), then *You send*, *Creator gets*, *Route fee* (*NEAR Intents · NearJar takes nothing*: the quote's USD in minus USD out, 1Click's own fee included), *Arrives* and *Lands in* (*Confidential balance*), and a **Connect a Solana wallet** button. Stop here unless you want to really donate.
5. The same quote from a terminal:
   ```sh
   curl -s -X POST https://nearjar.xyz/api/quote -H 'content-type: application/json' \
     -d '{"jarId":"demo","usdCents":500,"sourceChain":"solana:mainnet","sourceSymbol":"USDC"}'
   ```
   → `{"ok":true,"quote":{"dry":true,"amountIn":"…","amountInFormatted":"5.00…","amountOut":"…",…,"etaSeconds":…,"depositAddress":"",…}}`

`/j/support` is the developer's own jar: donations to it really reach the NearJar developer's near.com account. It is not stored in `nearjar.near`. The web app serves it from `NEARJAR_DEMO_OWNER` under the id `demo` (the `jarId` in the curl above) and counts its total from the delivered donations in its database. The open jars stored on chain are `/j/masya` (jar `"2"`) and the DAO jar `/j/nearjar-dao` (jar `"1"`, pays `nearjar-demo.sputnik-dao.near`, *Endorsed by the DAO ✓* as of 2026-11-09). `/api/quote` takes a numeric jar id (`"2"`) or `demo`, not a short link.

Read a jar straight from the contract (`args_base64` is `{"slug":"masya"}`):

```sh
curl -s https://free.rpc.fastnear.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"nearjar.near","method_name":"get_jar_by_slug","args_base64":"eyJzbHVnIjoibWFzeWEifQ=="}}' \
  | jq -c '.result.result | implode | fromjson | {id, owner, payout, slug, status, raised_usd_cents}'
```

→ `{"id":"2","owner":"0x63428e70a8016d10e8e2f7da440c898063afa299","payout":null,"slug":"masya","status":"Open","raised_usd_cents":"…"}`. With `{"slug":"support"}` (`eyJzbHVnIjoic3VwcG9ydCJ9`) the contract returns `null`.

## Create a jar (needs the wallet you use for near.com)

1. Open https://nearjar.xyz/new → *Creator studio* asks for a wallet. Pick your near.com wallet's network on the **EVM** / **Solana** / **NEAR** / **TON** tabs and press **Connect EVM** (or **Connect Solana**, …) → NearJar shows your near.com account in the header and under **Payout & link** → *Where donations go*: `nearcom:0x…`, a 64-hex implicit account or a `name.near`.
2. Fill in the editor tabs **Page**, **Goal & amounts**, **Payout & link** (receive asset, where donations go, short link) and **After donation** → the live preview updates as you type.
3. Press **Publish** → the modal shows exactly what you sign → sign one message in your wallet. It is not a transaction and costs nothing.
4. The relayer submits it to `nearjar.near`. The contract verifies the signature itself and asks `intents.near` whether that key belongs to your near.com account (`has_public_key`); only then is the jar stored. You get the jar link, a QR code and a share card.

## Donate for real (optional)

On any jar page: pick an amount and a token, press **Donate**, then either connect a wallet and approve one transaction (EVM, Solana, TON, Tron, NEAR, Bitcoin) or send to a one-time deposit address from any of the 26 networks or an exchange. Minimum $1. The status screen follows the donation leg by leg. Once NEAR Intents delivers it, the relayer writes a receipt to the contract and the jar total updates.

The receipt is written on the next status check after delivery: the status screen polls every 5 s, `/d/<id>` checks when it loads, and a jar page, when it loads, rechecks that jar's open donations from the last two days. There is no cron job. Until one of those pages is opened, a delivered donation is already in the creator's balance but not yet in the jar total.

## DAO jars (Social Money track)

A jar can pay a community's **Sputnik DAO treasury** instead of its creator. Donors still pay from any chain. The money lands in the DAO's NEAR Intents balance, which Trezu shows under *Intents* and the members spend by proposal. The creator can't take it out.

Whether one member could is the DAO's own policy, so the jar page reads it and shows it next to the treasury, for example `9 members · Spending: 3 of 9 approvals` for `shitzu.sputnik-dao.near`. The full rule is in the hover text (*Spending needs 3 of the 9 members of “council”*). When one member can approve spending alone, the hover text adds *One member can approve spending alone*. The project's own DAO, `nearjar-demo`, has a single approver and showed `2 members · Spending: 1 approval` on 2026-11-09.

**The payout is enforced on chain, not by NearJar's database.**

- The creator signs the DAO together with the jar fields (`"payout": "shitzu.sputnik-dao.near"`), so the wallet shows where the money goes. `nearjar.near` stores it; `get_jar` returns `payout` and `endorsed`. The contract accepts only `<name>.sputnik-dao.near`, because only the factory `sputnik-dao.near` can create such accounts. Look-alikes like `x.sputnik-dao.near.evil.near` are refused.
- The payout never changes. An `update_jar` that signs a different payout, or none, fails with `payout cannot change`. So a creator can't move a DAO jar, with its total and its link, to themselves.
- Every quote reads the recipient from `get_jar` and asks 1Click for `recipientType: INTENTS` to the DAO. Short links resolve in the contract too (`get_jar_by_slug`); each is unique and signed by the owner. A jar page stored off chain is shown only while it hashes to the fingerprint the contract keeps. So write access to NearJar's database is not enough to send a jar's donors elsewhere or to change what its page says under the DAO's name.
- Donation receipts are written to the contract only for what 1Click itself confirms: a finished swap credited to that jar's on-chain payout account.
- Before the relayer submits a new DAO jar, NearJar checks the signed message itself:
  1. the deployed contract stores DAO payouts;
  2. the DAO account exists;
  3. the signer is listed in one of its group roles (the open "Everyone" role doesn't count);
  4. the DAO can spend NEAR Intents funds: the signer may file FunctionCall requests and a group role can pass them (Sputnik never counts "Everyone" votes);
  5. no key is registered for the DAO on `intents.near`, since such a key could spend its Intents balance without a proposal.

  Any RPC error refuses the jar. Every quote checks the account and its keys again, because 1Click would credit a name nobody has created yet.

**The DAO has the last word.** Being in a DAO's roles lets you make a jar for it, but that isn't the DAO's approval. So the jar page says *Not endorsed by the DAO yet* until the DAO votes, through an approved FunctionCall proposal:

| Contract | Method | Args (strings) | Deposit | Gas | Effect |
|---|---|---|---|---|---|
| `nearjar.near` | `endorse_jar` | `{"jar_id":"<id>","revision":"<revision>"}` | 0 | 30 Tgas | the page shows *Endorsed by the DAO ✓* |
| `nearjar.near` | `dao_close_jar` | `{"jar_id":"<id>"}` | 0 | 30 Tgas | the DAO's stop button: closes the jar |

Only the jar's payout DAO can call them. Every edit by the creator starts a new `revision` and clears the endorsement. An `endorse_jar` that names an older revision fails, so the badge always covers what the page shows now. For each DAO jar the studio shows these values with copy buttons, a ready Trezu request template and the `add_proposal` JSON for near-cli. Trezu needs Custom Requests enabled once per treasury (Settings → Developer), by a member who can change its policy.

**Try it**

1. Without a wallet, the live check the editor uses (responses from 2026-11-09):
   ```sh
   curl -s 'https://nearjar.xyz/api/dao?id=shitzu&account=sealteam666.near'
   ```
   → `{"ok":true,"dao":"shitzu.sputnik-dao.near","exists":true,"members":9,"roles":["council","all"],"accountRoles":["council"],"isMember":true,"canSpendIntents":true,"governance":{"members":9,"spend":{"role":"council","approvals":3,"of":9},"solo":null},"intentsKeys":0,"problem":null,"trezuUrl":"https://trezu.app/shitzu.sputnik-dao.near"}`

   The project's own DAO, `nearjar-demo.sputnik-dao.near`, with a member of its *Requestor* role (the owner of jar `"1"`):
   ```sh
   curl -s 'https://nearjar.xyz/api/dao?id=nearjar-demo&account=f96174da29b5e15203f350d036e428eac766d69a0cc268ec289b2aa4666df664'
   ```
   → `{"ok":true,"dao":"nearjar-demo.sputnik-dao.near","exists":true,"members":2,"roles":["Requestor","Admin","Approver"],"accountRoles":["Requestor"],"isMember":true,"canSpendIntents":true,"governance":{"members":2,"spend":{"role":"Approver","approvals":1,"of":1},"solo":"spend"},"intentsKeys":0,"problem":null,"trezuUrl":"https://trezu.app/nearjar-demo.sputnik-dao.near"}`

   With `id=shitzu&account=random-outsider.near` it answers `"isMember":false` and the reason in `problem`; `id=x.sputnik-dao.near.evil.near` is refused (`"ok":false`).
2. With a DAO you're in (or a new treasury from [trezu.app](https://trezu.app)): open https://nearjar.xyz/new with the NEAR wallet the DAO lists → **Payout & link** → **A DAO treasury (Sputnik DAO)** → paste the DAO's name or Trezu link. The card shows its members, your roles and whether it can spend NEAR Intents funds; publishing stays off until all three check out.
3. **Publish**: the modal and the wallet show `"payout": "<dao>"` in the signed text.
4. The jar page says *Donations go to the … treasury* with a Trezu link, and the donate review shows *Lands in: … treasury (NEAR Intents)*.
5. In the studio, open the jar → copy the Trezu template, file the `endorse_jar` request → once approved the page shows *Endorsed by the DAO ✓*.

Limits:

- Mainnet `*.sputnik-dao.near` DAOs only.
- Public treasuries only: a confidential Trezu treasury wouldn't see an `INTENTS` credit.
- Token-weighted (`Member`) roles don't count as membership, and token-weighted votes don't count as approvals.
- A named NEAR account needs its key registered in `intents.near`, which the contract checks. Implicit accounts have it by default.
- Membership is checked by NearJar's relay, not by the contract, so every relayer must run the same checks. There is one relayer.

## Run it locally

Prerequisites:

- Node.js 24 (tested with 24.22.1) or 22.22.2+. Node 20 is not enough: near-api-js 7.4.0 declares `node >=22.22.2`, Any Wallet Kit `>=22`, and vite 8 (used by vitest 4 for `pnpm test`) `^20.19.0 || >=22.12.0`.
- pnpm 10: `corepack enable` picks the version in `web/package.json` (`packageManager`, pnpm 10.30.2).
- For the contract: rustup (`contract/rust-toolchain.toml` pins Rust 1.97.1 with the `wasm32-unknown-unknown` target; rustup installs it on the first `cargo` call) and cargo-near ≥ 0.22 for the wasm build.

No secrets are needed to run the site and get live quotes:

```sh
cd web
pnpm install --frozen-lockfile
NEARJAR_DEMO_OWNER=0x63428e70a8016d10e8e2f7da440c898063afa299 pnpm dev   # http://localhost:3000
```

pnpm prints an *Ignored build scripts* warning (for example for `@reown/appkit`). It is expected; nothing needs to be approved.

→ `/`, `/j/support`, `/new` and `/api/quote` work against mainnet. Jars are read over NEAR RPC: `https://rpc.mainnet.near.org` by default (`web/src/lib/near.ts`), or `NEAR_RPC_URL`, which `.env.example` sets to `https://free.rpc.fastnear.com`. Quotes use the public 1Click API, statuses go to a local SQLite file (`local.db`).

What needs configuration (copy [`web/.env.example`](web/.env.example) to `web/.env.local`):

| Variable | Needed for |
|---|---|
| `NEARJAR_DEMO_OWNER` | the support jar (`/j/support`, id `demo`) and the near.com account it pays |
| `RELAYER_ACCOUNT_ID`, `RELAYER_PRIVATE_KEY` | creating jars and writing receipts (a function-call key limited to the contract) |
| `ONE_CLICK_JWT` | delivery into the **Confidential** near.com balance (`CONFIDENTIAL_INTENTS`, which 1Click quotes only with a partner JWT); without it donations land in the public intents.near balance (`INTENTS`) and the review's *Lands in* says *Public balance*. 1Click's fee was the same either way on 2026-11-09: 0.2%, or 0.01% on stablecoin pairs ([how to check](docs/FLOW.md#money)) |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | a hosted database instead of `local.db` |
| `NEXT_PUBLIC_REOWN_PROJECT_ID` | connecting any EVM or Solana wallet: browser extensions and phone wallets both go through Reown AppKit, which doesn't load without it (`web/src/lib/appkit.ts`). NEAR, TON, Tron and Bitcoin wallets and deposit addresses work without it |
| `SOLANA_RPC_URL`, `TON_RPC_URL` | sending Solana and TON donations through a private node |

Web checks (vitest unit tests cover the DAO checks, signed-message parsing and payout routing):

```sh
cd web && pnpm test && pnpm lint && pnpm build
```

Contract:

```sh
cd contract
cargo test                                         # real ed25519 / secp256k1 signatures, DAO payout rules
cargo near build non-reproducible-wasm --no-abi    # → target/near/nearjar.wasm
```

## How it works

- **Creator** connects the same wallet they use for near.com. NearJar derives their near.com account, they fill in the jar and sign one message in the envelope `intents.near` itself accepts (`erc191`, `raw_ed25519`, `nep413`, `ton_connect`, …). The page (cover, milestones, links, …) is stored off chain; its sha256 fingerprint is part of the signed message and kept by the contract, and the page is shown only while it matches, so nobody can change it without the owner. The short link is signed and kept unique by the contract too.
- **Contract** `nearjar.near` verifies the signature with the `intents.near` code (`defuse-core`) and checks the key with `intents.near.has_public_key`. So ownership follows near.com's own rules: rotate a key in near.com and NearJar follows.
- **Relayer** `relayer.nearjar.near` pays gas with a function-call key that can call only `submit` and `record_donation` on the contract. It cannot forge or redirect a jar; it records only donations 1Click confirms delivered to the jar's payout account.
- **DAO jars** pay a Sputnik DAO treasury fixed in the contract at creation; the DAO endorses or closes its jar by proposal (see [DAO jars](#dao-jars-social-money-track)).
- **Donor** pays with a wallet or to a one-time 1Click deposit address. Solana transfers are built with Any Wallet Kit's `@anywalletkit/wallet-solana` (`web/src/lib/pay/solana.ts`). EVM, TON, Tron, NEAR and Bitcoin payments are this repo's own code (`web/src/lib/pay/`) on EIP-1193, TON Connect, TronLink's `tronWeb`, NEAR Wallet Selector and sats-connect.
- **Delivery** runs through NEAR Intents (1Click API) with recipient type `CONFIDENTIAL_INTENTS` (or `INTENTS`): the donation is swapped and credited to the creator's near.com balance, or with `INTENTS` to the jar's DAO treasury. A donation counts only after delivery; then the relayer records a receipt (jar, USD amount, asset, delivery tx) in the contract.

Full flow and decisions: [docs/FLOW.md](docs/FLOW.md) · contract details: [contract/README.md](contract/README.md).

### Where NEAR is used

- **NEAR Intents (1Click)** quotes and settles every donation from 26 networks into one near.com balance.
- **`intents.near`** is the source of truth for who owns a near.com account.
- **`nearjar.near`** (Rust, near-sdk) stores jars (with their DAO payout and endorsement), used signature nonces and delivered-donation receipts.
- **Sputnik DAO and Trezu**: DAO jars pay a `*.sputnik-dao.near` treasury; its `get_policy` decides who may create one, and its FunctionCall proposals endorse or close it.
- **A relayer with a function-call key** makes jar creation gasless for the creator.

## Repository

| Path | What |
|---|---|
| `web/` | Next.js 16 app: landing, jar pages, donate flow, status tracking, creator studio, relayer API routes |
| `contract/` | NearJar contract (Rust, near-sdk 5.29) and tests |
| `docs/FLOW.md` | product flow, storage and money decisions |

## Baseline and disclosure

Hackathon rules allow pre-existing libraries and AI-written code if they are listed. Everything in this repo was written during the hackathon window (first commit 2026-11-02).

- **Any Wallet Kit** ([github.com/ultratestbro/anywalletkit](https://github.com/ultratestbro/anywalletkit), `@anywalletkit/*` on npm, https://anywallet.tech), an open wallet SDK by the same author, used here as a library. The pre-hackathon baseline is SDK commit [`77df2e37`](https://github.com/ultratestbro/anywalletkit/tree/77df2e3747adc8d8c7badccd81ddaaa3200c8038) (2026-10-18), the last one before the 2026-10-19 announcement; its packages were then named `@forgewallet/*`. The SDK kept being developed during the window ([changes since the baseline](https://github.com/ultratestbro/anywalletkit/compare/77df2e37...main)): the `@anywalletkit/*` packages were first published to npm on 2026-10-24, and the versions used here were published on 2026-11-02 (`swap2-assets` 0.2.2 on 2026-10-27).
  - `protocol-swap2-near-intents` 0.3.0: NEAR Intents 1Click quotes and deposit addresses (`web/src/lib/quote.ts`). The change NearJar needed was made in it on 2026-11-02 and released in 0.3.0: `recipientType: "INTENTS" | "CONFIDENTIAL_INTENTS"`, so donations can be credited to an intents.near account (at the baseline the provider paid out only to an address on the destination chain).
  - `swap2-assets` 0.2.2: the networks and tokens donors can pay with.
  - `wallet-solana` 0.6.0: Solana transfer builders for donor payments.
  - `core` 0.8.0 and `protocol-swap2-core` 0.10.0 are in `web/package.json` but not imported by this repo: they come in as dependencies of the near-intents provider (`core` is its peer dependency, `protocol-swap2-core` a dependency). `tx-preview-evm` 0.5.0 is installed transitively through `protocol-swap2-core`.
- **Third-party:**
  - contract: `defuse-core` from near/intents (pinned commit) for signature verification, near-sdk; tests and examples use ed25519-dalek, k256, sha3, bs58 and hex.
  - web: Next.js, React, Tailwind CSS, Reown AppKit (with `@walletconnect/universal-provider`), wagmi, `@wagmi/core` and viem, `@tanstack/react-query` (wagmi's peer), NEAR Wallet Selector (Meteor, HERE, Intear, modal UI), TON Connect UI and `@ton/core`, `@solana/kit` and `@solana/web3.js`, sats-connect, `qrcode`, `buffer`, the libSQL client (Turso), `server-only`; vitest, ESLint and TypeScript for development.
  - near-api-js: 7.4.0, installed under the alias `near-api-js-v7`, signs the relayer's transactions (`web/src/lib/near.ts`). 6.5.1 is not imported by this repo; it is the peer dependency of Meteor Wallet's SDK (`@meteorwallet/sdk`, used by the wallet selector's Meteor module).
- **AI assistance:** All commits were co-written with Claude Code (each carries a `Co-Authored-By: Claude` trailer); the author directed, reviewed and tested the work.
- **Other hackathon project by the same author: [NearAnyStake](https://nearanystake.xyz)** ([github.com/ultratestbro/nearanystake](https://github.com/ultratestbro/nearanystake)), stake NEAR from any chain through NEAR Intents. The two projects are independent and submitted separately; NearAnyStake reuses some of NearJar's wallet and UI code.

## License

[Apache-2.0](LICENSE)
