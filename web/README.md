# NearJar web

Next.js 16 app: jar pages, donation quotes, (next) wallet payments and the relayer.

```sh
pnpm install
cp .env.example .env.local   # set NEARJAR_DEMO_OWNER to a near.com account (0x… / hex / name.near)
pnpm dev                     # http://localhost:3000/j/demo
```

Quotes come from NEAR Intents (1Click) through the Any Wallet Kit provider
`@anywalletkit/protocol-swap2-near-intents` (npm, ≥0.3.0). With a 1Click partner JWT (`ONE_CLICK_JWT`) it runs
with `recipientType: "CONFIDENTIAL_INTENTS"` and credits the jar owner's Confidential near.com balance;
without one, `"INTENTS"` credits the public intents.near balance (near.com shows it as "legacy").
