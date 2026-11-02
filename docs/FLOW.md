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

Verified 2026-11-02: a dry 1Click quote with `recipient: 0x63428e70…a299`, `recipientType: INTENTS` (5 USDC Solana → USDC on NEAR) returns ~4.9995 USDC in ~20 s. `CONFIDENTIAL_INTENTS` to a third party is refused (401, needs the recipient's session), so confidential donations are out of scope.

## Creator

1. Connect the same wallet type used for near.com: EVM, Solana, NEAR or TON (all four in v1).
2. NearJar derives and shows the near.com account: "donations arrive here: nearcom:0x6…99, compare with Receive in near.com".
3. Fill in: title, description, image, optional goal in USD and end date, receive asset (USDC default; USDT, NEAR, BTC, ETH).
4. Sign one message (no gas). The relayer submits it; the contract verifies the signature (EVM `ecrecover`, ed25519 for Solana/NEAR/TON).
5. Get the link, QR and "share on X".
6. "My jars": donations list, edit/close (signed), hide messages, CSV export.

## Donor

1. Open the jar link: creator, description, progress, recent donations, recipient account with a "verify" link.
2. Enter the amount in USD; a live quote shows what the creator receives.
3. Pay one of three ways:
   - **a) Wallet** — EVM / Solana / TON / Tron / NEAR / BTC via the Any Wallet Kit SDK, one signature.
   - **b) Manual** — one-time 1Click deposit address + QR on the chosen chain; donor gives a refund address.
   - **c) From near.com** — donor connects their near.com wallet, signs a gasless transfer from their `intents.near` balance carrying the jar id; the relayer submits it.
4. Optional name + message (≤280 chars, text only, shown only after delivery, creator can hide it).
5. Status: waiting for deposit → in progress → delivered (source tx + intents.near tx links) or refunded.
6. Receipt + "share on X".

## Attribution

- a, b: each donation gets its own 1Click quote and deposit address → stored as `deposit → jar`.
- c: the signed transfer carries the jar id.

## Storage

| Data | Where |
|---|---|
| Jars | NEAR contract (mainnet) |
| Delivered donations | NEAR contract — compact receipt written by the relayer: jar, USD amount, asset, tx hash |
| In-flight statuses | Turso |
| Names and messages | Turso (hideable) |

The contract cannot verify a payment on another chain, so receipts for a/b are relayer-attested and checkable via the tx hash. Method c settles inside `intents.near`.

## Money

- Service fee: 0. 1Click charges 0.2% without a partner JWT.
- Minimum donation: $1.
- Funds always go straight to the creator's near.com balance; NearJar never holds them.

## Architecture

- Next.js (App Router) on Vercel, Turso + Drizzle.
- Contract: Rust, near-sdk, mainnet, account `nearjar.near`.
- Relayer: `relayer.nearjar.near` with a function-call key limited to the contract (pays gas only). The full-access keys stay with the owner.
- Status tracking: polled while a page is open + Vercel cron backstop; the cron also writes receipts.
- UI: English, near.com-like style (dark, green accent), no near.com logo, "concept, not official" note.
- Domain: `*.vercel.app` until the owner buys one.

## Hackathon

- Track: Real-World Money (main), Social Money if DAO-treasury jars fit in time.
- Repo private until ~Nov 11–12, secret scan, then public before Nov 14 23:59 UTC.
- Dry-run mode so judges can walk the whole flow without funds.
- Second project (if time): NEAR staking from any chain on the Any Wallet Kit SDK. The READMEs must name each other.
