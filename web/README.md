# NearJar web

Next.js 16 app: landing, jar pages, the donate flow (wallet payments on EVM, Solana, TON, Tron, NEAR and Bitcoin, or a
one-time deposit address from any of the 26 networks), donation status tracking, the creator studio and the relayer API
routes.

```sh
pnpm install
NEARJAR_DEMO_OWNER=0x63428e70a8016d10e8e2f7da440c898063afa299 pnpm dev   # http://localhost:3000/j/support
```

No secrets are needed for the site and live quotes; see the root [README](../README.md#run-it-locally) and
[.env.example](.env.example) for what each variable enables.

Quotes come from NEAR Intents (1Click) through the Any Wallet Kit provider
`@anywalletkit/protocol-swap2-near-intents` (npm, ≥0.3.0). With a 1Click partner JWT (`ONE_CLICK_JWT`) it runs
with `recipientType: "CONFIDENTIAL_INTENTS"` and credits the jar owner's Confidential near.com balance;
without one, `"INTENTS"` credits the public intents.near balance (near.com shows it as "legacy").
