# NearJar

**Donation jars for near.com accounts, payable from any chain.**

A near.com user creates a jar and shares a link. Donors pay from whatever wallet and chain they already use (EVM, Solana, TON, Tron, Bitcoin, NEAR, …) or straight from their own near.com balance. The money lands directly in the creator's near.com balance, in the asset the creator picked (USDC by default), with nothing to withdraw and no gas to buy.

> NearJar is an independent concept built for the [NEAR Hackathon](https://nearhackathon.com) (Nov 2026). It is not an official near.com product. It is designed as a feature near.com could embed.

## The problem

A near.com account has an internal address (`nearcom:0x…`) that can only receive from other near.com users. near.com warns: *"Your funds will be lost if you send to this address on any blockchain."* So a creator on near.com has no simple way to take a payment from someone on Solana, Base or Bitcoin.

NearJar turns that internal address into a payment link that works from any chain.

## How it works

- **Creator** connects the same wallet they use for near.com (EVM, Solana, NEAR or TON). NearJar derives their near.com account, they fill in the jar and sign one message. A relayer writes the jar to the NearJar contract on NEAR mainnet; the contract itself verifies the signature, so the relayer cannot forge or redirect a jar.
- **Donor** opens the link, enters an amount in USD and pays one of three ways:
  1. connect a wallet and sign one transaction (built by the [Any Wallet Kit SDK](https://docs.anywallet.tech));
  2. send manually to a one-time deposit address (works from an exchange);
  3. pay from their own near.com balance with a gasless signed transfer.
- **Delivery** runs through [NEAR Intents](https://docs.near-intents.org) (1Click API, `recipientType: INTENTS`). A donation counts only after it is delivered; the relayer then records a compact receipt in the contract, so the jar total is readable on chain.

Full flow and decisions: [docs/FLOW.md](docs/FLOW.md).

## Status

Work in progress (hackathon window Nov 1–14, 2026). Run instructions and a dry-run mode for judges will be added here.

## Built with

- [NEAR Intents 1Click API](https://docs.near-intents.org) — cross-chain delivery into the creator's near.com (intents.near) balance
- [Any Wallet Kit SDK](https://docs.anywallet.tech) (`@anywalletkit/*` on npm) — wallet connections and transaction building on every source chain. Pre-existing library by the same author; listed here as baseline, not hackathon work.
- Rust + near-sdk (contract), Next.js on Vercel, Turso

## License

[Apache-2.0](LICENSE)
