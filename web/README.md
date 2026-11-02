# NearJar web

Next.js 16 app: jar pages, donation quotes, (next) wallet payments and the relayer.

```sh
pnpm install
cp .env.example .env.local   # set NEARJAR_DEMO_OWNER to a near.com account (0x… / hex / name.near)
pnpm dev                     # http://localhost:3000/j/demo
```

Quotes come from NEAR Intents (1Click) through the Any Wallet Kit provider
`@anywalletkit/protocol-swap2-near-intents` with `recipientType: "INTENTS"`, which credits the jar owner's
near.com (intents.near) account directly. Until that option ships on npm, the package is vendored from the SDK
branch in `vendor/`.
