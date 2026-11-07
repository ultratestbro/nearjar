# NearJar — flow and decisions

Agreed 2026-11-02. This is the spec the code follows; change it here first.

## Accounts

A near.com account is an account inside the `intents.near` contract, derived from the wallet the user signs in with:

| Login wallet | near.com account id |
|---|---|
| EVM | the lowercase `0x…` address (shown in near.com as `nearcom:0x…`) |
| Solana / TON | 64-hex implicit id from the ed25519 public key |
| NEAR | the NEAR account id (named or implicit) |
| Passkey | not supported yet (maybe at the end) |

Verified 2026-11-02: a dry 1Click quote with `recipient: 0x63428e70…a299`, `recipientType: INTENTS` (5 USDC Solana → USDC on NEAR) returns ~4.9995 USDC in ~20 s.

near.com keeps funds in the **Confidential** balance; an `INTENTS` credit shows there as a "legacy" balance the owner must move. `recipientType: CONFIDENTIAL_INTENTS` credits the Confidential balance directly. What 1Click answers (2026-11-02):

| Request | Answer |
|---|---|
| no auth | 401 "User authentication is required for confidential intent quotes" |
| the user's User-Session token in `Authorization` | "Invalid token" — that header is partner auth |
| 1Click **partner JWT** | quotes for the owner's account **and for an unrelated account** (third party); live donation $5 ETH (Ethereum) → USDT delivered `SUCCESS` and shown in the owner's Confidential near.com balance |

So confidential delivery to a jar owner needs NearJar's partner JWT (`ONE_CLICK_JWT`), not the owner's session. With it NearJar uses `CONFIDENTIAL_INTENTS`; without it, `INTENTS`.

Recipient rule (Any Wallet Kit near-intents ≥0.3.0, both modes, `destChain: near:mainnet`): a dotted name (`name.near`), a 64-hex implicit id or a lowercase `0x` + 40 hex id. NearJar canonicalises input (`nearcom:` prefix, any case) with `lib/nearcom.ts` and refuses top-level names before the owner signs.

## Creator

1. Connect the same wallet type used for near.com: EVM, Solana, NEAR or TON (all four in v1).
2. NearJar derives and shows the near.com account: "donations arrive here: nearcom:0x6…99, compare with Receive in near.com".
3. Fill in: title, description, image, optional goal in USD and end date, receive asset (USDC default; USDT, NEAR, BTC, ETH).
4. Sign one message (no gas). The relayer submits it; the contract verifies the signature (EVM `ecrecover`, ed25519 for Solana/NEAR/TON).
5. Get the link, QR and "share on X".
6. "My jars": donations list, edit/close (signed), hide messages, CSV export.

## DAO jars

Agreed 2026-11-08. A jar may pay a Sputnik DAO treasury instead of the creator's near.com account.

- **Where the payout lives.** In the contract: `SignedJar.payout` (optional, `<label>.sputnik-dao.near` only), stored on the jar at creation. `update_jar` must sign the same value (absent = none) or the contract panics `payout cannot change`. `get_jar` returns `payout`, `endorsed` and `revision`.
- **Why not page data.** Page data sits in Turso; a payout there would let whoever writes to the database redirect donations. Every quote takes the recipient from `get_jar` (`lib/quote.ts` `payoutOf`), nothing else.
- **Nothing in Turso points donors anywhere** (amended 2026-11-08 after the security review). The short link is a signed jar field the contract keeps unique (`get_jar_by_slug`; a link once claimed keeps pointing at its jar, also after a rename or close), so a database writer can't move `/j/<slug>` to another jar. The page's `sha256` fingerprint is stored on chain and the page is shown only when its stored text hashes to it (`lib/pages.ts` `trustedPage`); images are served only when their bytes hash to their id. Receipts are recorded only for what 1Click's `/status` confirms: `SUCCESS` with `quoteRequest.recipient` = the jar's payout account (`INTENTS` for a DAO). What stays in Turso unverified: donor names and messages, and in-flight statuses.
- **Delivery.** `recipientType: INTENTS` to the DAO: its public intents.near balance, which Trezu lists as *Intents* and spends by FunctionCall proposal (`mt_transfer` / `ft_withdraw` on intents.near). Not `CONFIDENTIAL_INTENTS`: a public treasury can't see confidential credits. The partner JWT, when set, is sent with it too (no fee); JWT + `INTENTS` is still to be confirmed on a live quote.
- **Who may create one.** Checked in `/api/jars/prepare` (for the editor) and again in `/api/jars` on the signed message itself, before the relayer pays (all seven standards: the JSON is `payload`, `payload.message` for NEP-413, `payload.text` for TON Connect):
  1. the contract stores DAO payouts (`get_config` has `version`; an older build would make the jar pay the signer);
  2. the DAO account exists with a contract (own code or the factory's global contract) and `get_policy` reads;
  3. the signer is in a `Group` role with permissions (`Everyone` never counts, token-weighted `Member` roles aren't supported);
  4. the DAO can spend Intents funds: the signer's roles allow `call:AddProposal` (or `call:*`, `*:AddProposal`, `*:*`) and a `Group` role can pass a `call` proposal: it allows `call:VoteApprove` (or the same wildcards), has members, and its role-weighted rule max(quorum, threshold) fits its size. `Everyone` never approves: Sputnik's `proposal_status` skips it. Token-weighted votes aren't counted;
  5. `intents.near.public_keys_of(dao)` is empty: a registered key could spend the Intents balance without a proposal.
  Any RPC or parse error refuses. Lookups are cached for 60 s (an existing DAO account and a contract with DAO payouts for an hour; at most 500 entries). Quotes re-check that the account exists and has no intents key, because 1Click credits even a name nobody has created. A Sputnik DAO has no way to delete itself, and its code can only change to a version the factory stores (`upgrade_self` goes through `sputnik-dao.near.update`), so a name taken over after deletion would need the factory owner.
- **Who decides over the money.** The jar page and the editor show the DAO's members and the fewest approvals that pass a FunctionCall proposal (`lib/daoPolicy.ts` `governance`), and warn when one account can act alone: one approval spends, or one approval changes the policy, roles, code, vote token or factory info. Two of the five recorded DAOs (agentic, webassemblymusic-treasury) are like that; NearJar still allows them and says so to donors.
- **Updates.** Prepare always signs the jar's on-chain payout; the relay route refuses an update whose signed payout differs before relaying. Membership isn't re-checked on updates: the money can't move, every edit clears the endorsement, and the DAO has its own stop button.
- **Endorsement.** Membership is not consent (anyone can create a DAO listing anyone), so the page shows *Not endorsed by the DAO yet* until the DAO calls `endorse_jar(jar_id, revision)` through an approved FunctionCall proposal (deposit 0, 30 Tgas, both ids as strings). Every owner edit bumps `revision` and sets `endorsed = false`; an `endorse_jar` naming an older revision fails, so a proposal filed before an edit can't endorse content the DAO never saw. `dao_close_jar(jar_id)` is its stop button. Both accept only `predecessor == jar.payout`. The DAO has no "unendorse": its stop button is closing the jar.
- **UI.** Editor: *Where donations go* → near.com balance or *A DAO treasury (Sputnik DAO)*, a live check via `GET /api/dao` and a "can't be changed after publishing" warning; existing DAO jars show it read-only. The jar page, donate review and donation status name the treasury; the studio marks DAO jars and shows the endorse request with copy buttons.

## Donor

1. Open the jar link: creator, description, progress, recent donations, recipient account with a "verify" link.
2. Enter the amount in USD; a live quote shows what the creator receives.
3. Pay one of three ways:
   - **a) Wallet** — EVM / Solana / TON / Tron / NEAR / BTC via the Any Wallet Kit SDK, one signature.
   - **b) Manual** — one-time 1Click deposit address + QR on the chosen chain; donor gives a refund address.
   - **c) From near.com** — planned, not built yet: the donor signs a gasless transfer from their `intents.near` balance carrying the jar id; the relayer submits it.
4. Optional name + message (≤280 chars, text only, shown only after delivery, creator can hide it).
5. Status: waiting for deposit → in progress → delivered (source tx + intents.near tx links) or refunded.
6. Receipt + "share on X".

## Attribution

- a, b: each donation gets its own 1Click quote and deposit address → stored as `deposit → jar`.
- c (planned): the signed transfer would carry the jar id.

## Storage

| Data | Where |
|---|---|
| Jars, their short links and page fingerprints | NEAR contract (mainnet) |
| Page data and images | Turso, shown only when they match the fingerprint / image hash |
| Delivered donations | NEAR contract — compact receipt written by the relayer: jar, USD amount, asset, tx hash |
| In-flight statuses | Turso |
| Names and messages | Turso (hideable) |

The contract cannot verify a payment on another chain, so receipts are relayer-attested and checkable via the delivery tx hash.

## Money

- Service fee: 0. 1Click charges 0.2% without a partner JWT; NearJar uses one, so there is no 1Click fee either.
- Minimum donation: $1.
- Funds always go straight to the creator's near.com balance, or to the jar's DAO treasury; NearJar never holds them.

## Architecture

- Next.js (App Router) on Vercel, Turso (libSQL).
- Contract: Rust, near-sdk, mainnet, account `nearjar.near`.
- Relayer: `relayer.nearjar.near` with a function-call key limited to the contract (pays gas only). The full-access keys stay with the owner.
- Status tracking: polled while a donation status or jar page is open (`/api/donations/[id]`, `/api/jars/[id]/sync`); the same polling writes the receipts.
- UI: English, near.com-like style (dark, green accent), no near.com logo, "concept, not official" note.
- Domain: https://nearjar.xyz.

## Hackathon

- Tracks: Real-World Money, Social Money (DAO jars), Open Innovation.
- Judges can walk the flow without funds: live dry quotes on https://nearjar.xyz and `POST /api/quote` (see the README).
