# NearJar

**Donation jars for near.com accounts, payable from any chain.**

A near.com user creates a jar and shares a link. Donors pay from the wallet and chain they already use (EVM chains, Solana, TON, Tron, Bitcoin, NEAR, Zcash and more, 26 networks in all) or send from an exchange. NEAR Intents delivers every donation straight into the creator's near.com balance, in the asset the creator picked (USDC by default). The creator signs one message to create a jar: no gas, no new account.

- **Live:** https://nearjar.xyz (NEAR mainnet)
- **Contract:** [`nearjar.near`](https://nearblocks.io/address/nearjar.near) · relayer [`relayer.nearjar.near`](https://nearblocks.io/address/relayer.nearjar.near)
- **Built at the [NEAR Hackathon](https://nearhackathon.com)** (Nov 2026) · tracks: Real-World Money, Social Money, Open Innovation

> NearJar is an independent concept, not an official near.com product. It is designed as a feature near.com could embed.

## The problem

A near.com account has an internal address (`nearcom:0x…`) that only works between near.com users. near.com warns: *"Your funds will be lost if you send to this address on any blockchain."* So a creator who lives in near.com has no simple way to take money from a supporter holding USDT on Tron, SOL or BTC.

NearJar turns that account into a payment link that works from any chain.

## Try it in 2 minutes (no wallet, no money)

1. Open https://nearjar.xyz → the hero shows every network donors can pay from, with coins dropping into the jar.
2. Open https://nearjar.xyz/j/support → a jar page: cover, goal, supporters and a donate card.
3. In the donate card type `5`, press **Pay with** and pick **Solana → USDC** → under the button you see a live NEAR Intents quote: what you send, what the creator gets and the ETA. It is a *dry* quote: no deposit address is created and nothing is charged.
4. Press **Donate $5** → the review step shows the route (USDC on Solana → NEAR Intents → USDC in the creator's near.com balance), the fee (NearJar takes nothing) and the wallet to connect. Stop here unless you want to really donate.
5. The same quote from a terminal:
   ```sh
   curl -s -X POST https://nearjar.xyz/api/quote -H 'content-type: application/json' \
     -d '{"jarId":"demo","usdCents":500,"sourceChain":"solana:mainnet","sourceSymbol":"USDC"}'
   ```
   → `{"ok":true,"quote":{"dry":true,"amountInFormatted":"5.00…","amountOut":"…","etaSeconds":…,"depositAddress":""}}`

The jar at `/j/support` is real: donations to it go to the NearJar developer's near.com account.

## Create a jar (needs the wallet you use for near.com)

1. Open https://nearjar.xyz/new and press **Connect** → pick the network of your near.com wallet (EVM, Solana, NEAR or TON) → NearJar shows your near.com account (`nearcom:0x…`, a 64-hex implicit account or a `name.near`).
2. Fill in the page (title, story, cover, goal, payout asset, short link) → the live preview updates as you type.
3. Press **Publish** → the modal shows exactly what you sign → sign one message in your wallet. It is not a transaction and costs nothing.
4. The relayer submits it to `nearjar.near`. The contract verifies the signature itself and asks `intents.near` whether that key belongs to your near.com account (`has_public_key`); only then is the jar stored. You get the jar link, a QR code and a share card.

## Donate for real (optional)

On any jar page: pick an amount and a token, press **Donate**, then either connect a wallet and approve one transaction (EVM, Solana, TON, Tron, NEAR, Bitcoin) or send to a one-time deposit address from any of the 26 networks or an exchange. The status screen follows the donation leg by leg; once NEAR Intents delivers it, the relayer writes a receipt to the contract and the jar total updates. Minimum $1.

## DAO jars (Social Money track)

A jar can pay a community's **Sputnik DAO treasury** instead of its creator. Donors still pay from any chain; the money lands in the DAO's NEAR Intents balance, which Trezu shows under *Intents* and the members spend by proposal. The creator can't take it out. Whether one member could is the DAO's own policy, so the jar page reads it and says it plainly: *9 members · Spending needs 3 of the 9 members of “council”*, or *One member can approve spending alone*.

**The payout is enforced on chain, not by NearJar's database.**

- The creator signs the DAO next to the jar fields: `"payout": "shitzu.sputnik-dao.near"`, so the wallet shows where the money goes. `nearjar.near` stores it (`get_jar` returns `payout` and `endorsed`) and accepts only `<name>.sputnik-dao.near`: only the factory `sputnik-dao.near` can create such accounts, and look-alikes like `x.sputnik-dao.near.evil.near` are refused.
- The payout never changes: an `update_jar` that signs a different one (or drops it) fails with `payout cannot change`. A creator can't switch a DAO jar, its total and its link, to themselves.
- Every quote reads the recipient from `get_jar` and asks 1Click for `recipientType: INTENTS` to the DAO. Short links resolve in the contract too (`get_jar_by_slug`, unique and signed by the owner), and a jar page stored off chain is shown only while it hashes to the fingerprint the contract keeps. So whoever can write to NearJar's database can't send donors of a jar, or of its link, anywhere else, and can't change what the page says under the DAO's name.
- Donation receipts are written to the contract only for what 1Click itself confirms: a finished swap credited to that jar's on-chain payout account.
- Before the relayer submits a new DAO jar, NearJar checks what was actually signed: the contract stores DAO payouts, the DAO exists, the signer is listed in one of its group roles (the open "Everyone" role doesn't count), the DAO can spend NEAR Intents funds (the signer may file FunctionCall requests and a group role can pass them; Sputnik never counts "Everyone" votes), and no key is registered for the DAO on `intents.near` (a key could spend its Intents balance without a proposal). Any RPC error refuses. Every quote checks the account and the keys again, because 1Click would credit a name nobody has created yet.

**The DAO has the last word.** Being in a DAO's roles lets you make a jar for it, but that isn't the DAO's approval, so the jar page says *Not endorsed by the DAO yet* until the DAO votes. It does so through an approved FunctionCall proposal:

| Contract | Method | Args (strings) | Deposit | Gas | Effect |
|---|---|---|---|---|---|
| `nearjar.near` | `endorse_jar` | `{"jar_id":"<id>","revision":"<revision>"}` | 0 | 30 Tgas | the page shows *Endorsed by the DAO ✓* |
| `nearjar.near` | `dao_close_jar` | `{"jar_id":"<id>"}` | 0 | 30 Tgas | the DAO's stop button: closes the jar |

Only the jar's payout DAO can call them. Every edit by the creator starts a new `revision` and clears the endorsement, and an `endorse_jar` that names an older revision fails, so the badge always covers what the page shows now. The studio shows these values for each DAO jar with copy buttons, a ready Trezu request template (in Trezu: Settings → Developer → enable Custom Requests, once per treasury, by a member who can change its policy) and the `add_proposal` JSON for near-cli.

**Try it**

1. Without a wallet, the live check the editor uses:
   ```sh
   curl -s 'https://nearjar.xyz/api/dao?id=shitzu&account=sealteam666.near'
   ```
   → `{"ok":true,"dao":"shitzu.sputnik-dao.near","exists":true,"members":9,"accountRoles":["council"],"isMember":true,"canSpendIntents":true,"governance":{"members":9,"spend":{"role":"council","approvals":3,"of":9},"solo":null},"intentsKeys":0,…}`. With `account=random-outsider.near` it answers `isMember: false` and why; `id=x.sputnik-dao.near.evil.near` is refused.
2. With a DAO you're in (or a new treasury from [trezu.app](https://trezu.app)): open https://nearjar.xyz/new with the NEAR wallet the DAO lists → **Payout & link** → **A DAO treasury (Sputnik DAO)** → paste the DAO's name or Trezu link. The card shows its members, your roles and whether it can spend NEAR Intents funds; publishing stays off until all three check out.
3. **Publish**: the modal and the wallet show `"payout": "<dao>"` in the signed text.
4. The jar page says *Donations go to the … treasury* with a Trezu link, and the donate review shows *Lands in: … treasury (NEAR Intents)*.
5. In the studio, open the jar → copy the Trezu template, file the `endorse_jar` request → once approved the page shows *Endorsed by the DAO ✓*.

Limits: mainnet `*.sputnik-dao.near` DAOs only; public treasuries only (a confidential Trezu treasury wouldn't see an `INTENTS` credit); token-weighted (`Member`) roles don't count as membership and token-weighted votes don't count as approvals; a named NEAR account needs its key registered in `intents.near`, which the contract checks (implicit accounts have it by default). Membership is checked by NearJar's relay, not by the contract, so every relayer must run the same checks (there is one).

## Run it locally

No secrets are needed to run the site and get live quotes:

```sh
cd web
pnpm install
NEARJAR_DEMO_OWNER=0x63428e70a8016d10e8e2f7da440c898063afa299 pnpm dev   # http://localhost:3000
```

→ `/`, `/j/support`, `/new` and `/api/quote` work against mainnet. Reading jars uses a public NEAR RPC, quotes use the public 1Click API, statuses go to a local SQLite file (`local.db`).

What needs configuration (see [`web/.env.example`](web/.env.example)):

| Variable | Needed for |
|---|---|
| `RELAYER_ACCOUNT_ID`, `RELAYER_PRIVATE_KEY` | creating jars and writing receipts (a function-call key limited to the contract) |
| `ONE_CLICK_JWT` | delivery into the **Confidential** near.com balance and no 1Click fee; without it donations land in the public intents.near balance and 1Click charges 0.2% |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | a hosted database instead of `local.db` |
| `NEXT_PUBLIC_REOWN_PROJECT_ID` | phone wallets over WalletConnect (EVM, Solana) |
| `SOLANA_RPC_URL`, `TON_RPC_URL` | sending Solana and TON donations through a private node |

Web unit tests (vitest; the DAO checks, signed-message parsing and payout routing):

```sh
cd web && pnpm test
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
- **Donor** pays with a wallet (transactions built by the Any Wallet Kit SDK) or to a one-time 1Click deposit address.
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

- **Any Wallet Kit** (`@anywalletkit/*` on npm, https://anywallet.tech), an open wallet SDK by the same author, predates the hackathon and is used as a library: `core` 0.8.0, `protocol-swap2-core` 0.10.0, `protocol-swap2-near-intents` 0.3.0, `swap2-assets` 0.2.2, `wallet-solana` 0.6.0. During the window the author added `recipientType: "INTENTS" | "CONFIDENTIAL_INTENTS"` to `protocol-swap2-near-intents` (released in 0.3.0) so donations can be credited to an intents.near account.
- **Third-party:** `defuse-core` from near/intents (pinned commit) for signature verification, near-sdk, Next.js, React, Tailwind, Reown AppKit with wagmi/viem, NEAR Wallet Selector, TON Connect, `@solana/kit` and `@solana/web3.js`, sats-connect, near-api-js, libSQL/Turso.
- **AI assistance:** built with Claude Code as a pair programmer; commits it co-wrote carry a `Co-Authored-By: Claude` trailer.
- **Other hackathon project by the same author: [NearAnyStake](https://nearanystake.xyz)** ([github.com/ultratestbro/nearanystake](https://github.com/ultratestbro/nearanystake)), stake NEAR from any chain through NEAR Intents. The two projects are independent and submitted separately; NearAnyStake reuses some of NearJar's wallet and UI code.

## License

[Apache-2.0](LICENSE)
