# NearJar

**Donation jars for near.com accounts, payable from any chain.**

A near.com user creates a jar and shares a link. Donors pay from the wallet and chain they already use (EVM chains, Solana, TON, Tron, Bitcoin, NEAR, Zcash and more, 26 networks in all) or send from an exchange. NEAR Intents delivers every donation straight into the creator's near.com balance, in the asset the creator picked (USDC by default). The creator signs one message to create a jar: no gas, no new account.

- **Live:** https://nearjar.xyz (NEAR mainnet)
- **Contract:** [`nearjar.near`](https://nearblocks.io/address/nearjar.near) · relayer [`relayer.nearjar.near`](https://nearblocks.io/address/relayer.nearjar.near)
- **Built at the [NEAR Hackathon](https://nearhackathon.com)** (Nov 2026) · tracks: Real-World Money, Open Innovation

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

Contract:

```sh
cd contract
cargo test                                         # 20 tests, real ed25519 / secp256k1 signatures
cargo near build non-reproducible-wasm --no-abi    # → target/near/nearjar.wasm
```

## How it works

- **Creator** connects the same wallet they use for near.com. NearJar derives their near.com account, they fill in the jar and sign one message in the envelope `intents.near` itself accepts (`erc191`, `raw_ed25519`, `nep413`, `ton_connect`, …). The page (cover, milestones, links, …) is stored off chain; its sha256 fingerprint is part of the signed message, so nobody can change it without the owner.
- **Contract** `nearjar.near` verifies the signature with the `intents.near` code (`defuse-core`) and checks the key with `intents.near.has_public_key`. So ownership follows near.com's own rules: rotate a key in near.com and NearJar follows.
- **Relayer** `relayer.nearjar.near` pays gas with a function-call key that can call only `submit` and `record_donation` on the contract. It cannot forge or redirect a jar.
- **Donor** pays with a wallet (transactions built by the Any Wallet Kit SDK) or to a one-time 1Click deposit address.
- **Delivery** runs through NEAR Intents (1Click API) with recipient type `CONFIDENTIAL_INTENTS` (or `INTENTS`): the donation is swapped and credited to the creator's near.com balance. A donation counts only after delivery; then the relayer records a receipt (jar, USD amount, asset, delivery tx) in the contract.

Full flow and decisions: [docs/FLOW.md](docs/FLOW.md) · contract details: [contract/README.md](contract/README.md).

### Where NEAR is used

- **NEAR Intents (1Click)** quotes and settles every donation from 26 networks into one near.com balance.
- **`intents.near`** is the source of truth for who owns a near.com account.
- **`nearjar.near`** (Rust, near-sdk) stores jars, used signature nonces and delivered-donation receipts.
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

## License

[Apache-2.0](LICENSE)
