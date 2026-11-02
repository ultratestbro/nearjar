# NearJar contract

Registry of donation jars owned by near.com (`intents.near`) accounts, plus relayer-attested donation receipts.

## How ownership is proven

1. The jar owner signs a NearJar action in the envelope `intents.near` accepts (`MultiPayload`: `erc191`, `raw_ed25519`, `nep413`, `ton_connect`, `tip191`, `sep53`, `webauthn`):
   ```json
   {
     "signer_id": "0x63428e70a8016d10e8e2f7da440c898063afa299",
     "verifying_contract": "nearjar.near",
     "deadline": "2026-11-03T12:00:00Z",
     "nonce": "<32 random bytes, base64>",
     "action": "create_jar",
     "jar": { "title": "…", "description": "…", "image_url": null, "goal_usd_cents": "50000", "ends_at": null, "receive_asset": "nep141:…" }
   }
   ```
   `action` is `create_jar`, `update_jar` (`jar_id`, `jar`) or `close_jar` (`jar_id`). The deadline must be within one hour; each nonce works once per signer.
2. The relayer calls `submit(signed)`. The contract verifies the signature with the intents.near code (`defuse-core`, pinned commit), then calls `intents.near.has_public_key(signer_id, public_key)`.
3. Only if intents.near answers `true` is the action applied (`on_key_checked`). So the rules are exactly near.com's: if the owner rotates keys in near.com, NearJar follows.

ERC-191 signatures are 65 bytes `r‖s‖v` with `v` = 0/1 (MetaMask returns 27/28 — subtract 27).

## Donations

`record_donation(jar_id, donation)` is relayer-only. The contract cannot see payments on other chains, so each receipt carries the intents.near delivery tx hash; `source_id` (1Click deposit address or intent hash) is unique, so a donation cannot be counted twice.

## Build and test

```sh
cargo test                                   # unit tests (signatures are real ed25519 / secp256k1)
cargo near build non-reproducible-wasm --no-abi   # sets --cfg=near (host-function crypto), runs wasm-opt → target/near/nearjar.wasm (~444 KB)
```

Rust is pinned to 1.97.1 (`rust-toolchain.toml`), the same as near/intents.

## Testnet

intents.near has no testnet deployment, so testnet runs against `intents-stub/` (same `has_public_key` rules for
implicit accounts, plus `add_public_key` / `remove_public_key`). Live since 2026-11-02:

| Account | Role |
|---|---|
| `nearjar.testnet` | NearJar (owner = itself), `intents_id = intents.nearjar.testnet` |
| `intents.nearjar.testnet` | intents stub |
| `relayer.nearjar.testnet` | relayer |

Sign an action and submit it as the relayer:

```sh
cargo run -q --example sign -- ed25519 42 nearjar.testnet '{"action":"create_jar","jar":{…}}' > signed.json
near contract call-function as-transaction nearjar.testnet submit json-args "$(cat signed.json)" \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' sign-as relayer.nearjar.testnet network-config testnet sign-with-keychain send
```

Verified on testnet: create via raw Ed25519 and ERC-191 signatures, replayed signature refused (`nonce already used`),
`record_donation` updates the jar total. Storage: code 4.58 NEAR locked; ~0.0005 NEAR gas per relayer call.
