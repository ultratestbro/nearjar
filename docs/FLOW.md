# NearJar — flow and decisions

Product flow and design decisions, kept in sync with the code.

## Accounts

A near.com account is an account inside the `intents.near` contract, derived from the wallet the user signs in with:

| Login wallet | near.com account id |
|---|---|
| EVM | the lowercase `0x…` address (shown in near.com as `nearcom:0x…`) |
| Solana / TON | 64-hex implicit id from the ed25519 public key |
| NEAR | the NEAR account id (named or implicit) |
| Passkey | not supported |

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

1. Connect the same wallet type used for near.com: EVM, Solana, NEAR or TON.
2. NearJar derives the near.com account and shows it in the header (its menu shows `nearcom:…`) and in the editor under **Payout & link** → *Where donations go* → *My near.com balance* (`nearcom:0x6342…a299` · the wallet you signed in with).
3. Fill in: cover, photo or logo, title, one line about you, story; optional goal in USD, milestones and suggested amounts; receive asset (USDC default; USDT, NEAR, BTC, ETH), where donations go and an optional short link; a thank-you note and links. The contract has an `ends_at` field, but the editor doesn't set it.
4. Sign one message (no gas). The relayer submits it; the contract verifies the signature (EVM `ecrecover`, ed25519 for Solana/NEAR/TON).
5. Get the link, QR and "share on X".
6. Creator studio: each jar's total, supporters and donations, edit (signed), CSV export. Closing is a signed `close_jar` that the prepare and relay routes accept; the studio has no close button.

## DAO jars

A jar may pay a Sputnik DAO treasury instead of the creator's near.com account.

- **Where the payout lives.** In the contract: `SignedJar.payout` (optional, `<label>.sputnik-dao.near` only), stored on the jar at creation. `update_jar` must sign the same value (absent = none) or the contract panics `payout cannot change`. `get_jar` returns `payout`, `endorsed` and `revision`.
- **Why not page data.** Page data sits in Turso; a payout there would let whoever writes to the database redirect donations. Every quote takes the recipient from `get_jar` (`lib/quote.ts` `payoutOf`), nothing else.
- **Nothing in Turso points donors anywhere.** The short link is a signed jar field the contract keeps unique (`get_jar_by_slug`; a link once claimed keeps pointing at its jar, also after a rename or close), so a database writer can't move `/j/<slug>` to another jar. The page's `sha256` fingerprint is stored on chain and the page is shown only when its stored text hashes to it (`lib/pages.ts` `trustedPage`); images are served only when their bytes hash to their id. Receipts are recorded only for what 1Click's `/status` confirms: `SUCCESS` with `quoteRequest.recipient` = the jar's payout account (`INTENTS` for a DAO). What stays in Turso unverified: donor names and messages, and in-flight statuses.
- **Delivery.** `recipientType: INTENTS` to the DAO: its public intents.near balance, which Trezu lists as *Intents* and spends by FunctionCall proposal (`mt_transfer` / `ft_withdraw` on intents.near). Not `CONFIDENTIAL_INTENTS`: a public treasury can't see confidential credits. The partner JWT, when set, is sent with it too; `INTENTS` doesn't need it, and the JWT doesn't change 1Click's fee (see [Money](#money)).
- **Who may create one.** Checked in `/api/jars/prepare` (for the editor) and again in `/api/jars` on the signed message itself, before the relayer pays (all seven standards: the JSON is `payload`, `payload.message` for NEP-413, `payload.text` for TON Connect):
  1. the contract stores DAO payouts (`get_config` has `version`; an older build would make the jar pay the signer);
  2. the DAO account exists with a contract (own code or the factory's global contract) and `get_policy` reads;
  3. the signer is in a `Group` role with permissions (`Everyone` never counts, token-weighted `Member` roles aren't supported);
  4. the DAO can spend Intents funds: the signer's roles allow `call:AddProposal` (or `call:*`, `*:AddProposal`, `*:*`) and a `Group` role can pass a `call` proposal: it allows `call:VoteApprove` (or the same wildcards), has members, and its role-weighted rule max(quorum, threshold) fits its size. `Everyone` never approves: Sputnik's `proposal_status` skips it. Token-weighted votes aren't counted;
  5. `intents.near.public_keys_of(dao)` is empty: a registered key could spend the Intents balance without a proposal.
  Any RPC or parse error refuses. Lookups are cached for 60 s (an existing DAO account and a contract with DAO payouts for an hour; at most 500 entries). Quotes re-check that the account exists and has no intents key, because 1Click credits even a name nobody has created. A Sputnik DAO has no way to delete itself, and its code can only change to a version the factory stores (`upgrade_self` goes through `sputnik-dao.near.update`), so a name taken over after deletion would need the factory owner.
- **Who decides over the money.** The jar page and the editor show the DAO's members and the fewest approvals that pass a FunctionCall proposal (`lib/daoPolicy.ts` `governance`). The jar page's line is short: `9 members · Spending: 3 of 9 approvals` (`spendShort`). The full rule (`spendText`) and any one-member warning (`soloText`) are in its hover text. When one approval spends, the line shows that count (`Spending: 1 approval`, or `Spending: 1 of 2 approvals`) and the hover adds *One member can approve spending alone*. When one approval changes the policy, roles, code, vote token or factory info, the line adds `Rules: 1 approval`; token-weighted votes add `Token-weighted votes`. The editor shows the warning as a sentence. Some of the DAO policies recorded in `web/src/lib/__fixtures__` are like that (agentic, webassemblymusic-treasury); NearJar still allows them.
- **Updates.** Prepare always signs the jar's on-chain payout; the relay route refuses an update whose signed payout differs before relaying. Membership isn't re-checked on updates: the money can't move, every edit clears the endorsement, and the DAO has its own stop button.
- **Endorsement.** Membership is not consent (anyone can create a DAO listing anyone), so the page shows *Not endorsed by the DAO yet* until the DAO calls `endorse_jar(jar_id, revision)` through an approved FunctionCall proposal (deposit 0, 30 Tgas, both ids as strings). Every owner edit bumps `revision` and sets `endorsed = false`; an `endorse_jar` naming an older revision fails, so a proposal filed before an edit can't endorse content the DAO never saw. `dao_close_jar(jar_id)` is its stop button. Both accept only `predecessor == jar.payout`. The DAO has no "unendorse": its stop button is closing the jar.
- **UI.** Editor: *Where donations go* → *My near.com balance* or *A DAO treasury (Sputnik DAO)*, a live check via `GET /api/dao` and a "can't be changed after publishing" warning; existing DAO jars show it read-only. The jar page, donate review and donation status name the treasury; the studio marks DAO jars and shows the endorse request with copy buttons.

## Donor

1. Open the jar link: cover, story, progress, supporters and where donations arrive (*Donations arrive as USDC in* `nearcom:…`, copied in full on tap; for a DAO jar, the treasury with a Trezu link).
2. Enter the amount in USD; a live quote shows what the creator receives.
3. Pay one of three ways:
   - **a) Wallet** — EVM / Solana / TON / Tron / NEAR / BTC, one signature. Solana transfers are built with Any Wallet Kit's `wallet-solana`; the other payers are this repo's own code (`lib/pay/`) on EIP-1193, TON Connect, TronLink's `tronWeb`, NEAR Wallet Selector and sats-connect.
   - **b) Manual** — one-time 1Click deposit address + QR on the chosen chain; donor gives a refund address.
   - **c) From near.com** — not built: the donor would sign a gasless transfer from their `intents.near` balance carrying the jar id, and the relayer would submit it.
4. Optional name (≤40 chars) and message (≤280 chars, text only), shown only after delivery.
5. Status: waiting for deposit → on its way → delivered (source tx and NEAR delivery tx links), or refunded / failed / expired.
6. Delivered: the creator's thank-you note and a *Share the jar* button (the share sheet, or a copied link).

## Attribution

- a, b: each donation gets its own 1Click quote and deposit address → stored as `deposit → jar`.
- c (not built): the signed transfer would carry the jar id.

## Storage

| Data | Where |
|---|---|
| Jars, their short links and page fingerprints | NEAR contract (mainnet) |
| Page data and images | Turso, shown only when they match the fingerprint / image hash |
| Delivered donations | NEAR contract — compact receipt written by the relayer: jar, USD amount, asset, tx hash |
| In-flight statuses | Turso |
| Names and messages | Turso |

The contract cannot verify a payment on another chain, so receipts are relayer-attested and checkable via the delivery tx hash.

## Money

- Service fee: 0.
- 1Click fee: 0.2%, or 0.01% on stablecoin pairs, with or without NearJar's partner JWT; the JWT only enables `CONFIDENTIAL_INTENTS` (see [Accounts](#accounts)). The donate review's *Route fee* is the quote's USD in minus USD out, so this fee is part of it.
- Minimum donation: $1.
- Funds always go straight to the creator's near.com balance, or to the jar's DAO treasury; NearJar never holds them.

An unauthenticated 1Click quote shows the fee in `quoteRequest.appFees` (`"fee"` in bps). To compare it with nearjar.xyz, which sends the JWT, for the same amount in (needs `curl` and `jq`):

```sh
# nearjar.xyz: $1,000 of USDC on Solana to jar "2" (the server sends the partner JWT)
r=$(curl -s -X POST https://nearjar.xyz/api/quote -H 'content-type: application/json' \
  -d '{"jarId":"2","usdCents":100000,"sourceChain":"solana:mainnet","sourceSymbol":"USDC"}')
echo "$r" | jq -c '{amountIn: .quote.amountIn, amountOut: .quote.amountOut}'
# 1Click without auth: the same amount in, to the same account
curl -s -X POST https://1click.chaindefuser.com/v0/quote -H 'content-type: application/json' -d '{"dry":true,
  "swapType":"EXACT_INPUT","slippageTolerance":100,"depositType":"ORIGIN_CHAIN","refundType":"ORIGIN_CHAIN",
  "originAsset":"nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near",
  "destinationAsset":"nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  "amount":"'"$(echo "$r" | jq -r .quote.amountIn)"'","refundTo":"1nc1nerator11111111111111111111111111111111",
  "recipient":"0x63428e70a8016d10e8e2f7da440c898063afa299","recipientType":"INTENTS","deadline":"2030-01-01T00:00:00Z"}' \
  | jq -c '{appFees: .quoteRequest.appFees, amountIn: .quote.amountIn, amountOut: .quote.amountOut}'
```

→ on 2026-11-09 the 1Click answer had `"fee":1` (a stablecoin pair) and almost always the same `amountOut` as nearjar.xyz (once 0.5 bp apart). For SOL (`"sourceSymbol":"SOL"`, `"originAsset":"nep141:sol.omft.near"`) it had `"fee":20`, and the two outputs were within 2 bp of each other, either way round, since the price moves between the calls. A waived 0.2% would make nearjar.xyz's output about 20 bp higher. 1Click's [fee page](https://docs.near-intents.org/resources/fees) lists an extra 0.25% for requests without an API key; these unauthenticated quotes did not include it.

## Architecture

- Next.js (App Router) on Vercel, Turso (libSQL).
- Contract: Rust, near-sdk, mainnet, account `nearjar.near`.
- Relayer: `relayer.nearjar.near` with a function-call key limited to the contract (pays gas only). Its full-access key stays with the operator, not on the server.
- Status tracking: the donation status screen polls `/api/donations/[id]` every 5 s and `/d/[id]` refreshes when it loads; a jar page calls `/api/jars/[id]/sync` once when it loads (that jar's open donations from the last two days). The same checks write the receipts. There is no cron job.
- UI: English, near.com-like style (dark, green accent), no near.com logo, "concept, not official" note.
- Domain: https://nearjar.xyz.

## Hackathon

- Tracks: Real-World Money, Social Money (DAO jars), Open Innovation.
- Judges can walk the flow without funds: live dry quotes on https://nearjar.xyz and `POST /api/quote` (see the README).
