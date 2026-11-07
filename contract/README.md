# NearJar contract

Registry of donation jars owned by near.com (`intents.near`) accounts, plus relayer-attested donation receipts. A jar pays out to its owner's near.com account or, if chosen at creation, to a Sputnik DAO treasury.

## How ownership is proven

1. The jar owner signs a NearJar action in the envelope `intents.near` accepts (`MultiPayload`: `erc191`, `raw_ed25519`, `nep413`, `ton_connect`, `tip191`, `sep53`, `webauthn`):
   ```json
   {
     "action": "create_jar",
     "jar": { "title": "…", "description": "…", "goal": "$1,500", "receive": "USDC", "payout": "shitzu.sputnik-dao.near", "slug": "ana-film", "image_url": "https://…", "page": "sha256:<64 hex>" },
     "signer_id": "0x63428e70a8016d10e8e2f7da440c898063afa299",
     "verifying_contract": "nearjar.near",
     "deadline": "2026-11-03T12:00:00Z",
     "nonce": "<32 random bytes, base64>"
   }
   ```
   `action` is `create_jar`, `update_jar` (`jar_id`, `jar`) or `close_jar` (`jar_id`). The deadline must be within one hour; each nonce works once per signer. `goal` is canonical dollars (`$1,500`, `$1,500.50`), `receive` one of `USDC`, `USDT`, `NEAR`, `BTC`, `ETH`; `description`, `goal`, `image_url`, `ends_at` (Unix ns), `payout`, `slug` and `page` are optional. `slug` is the short link: 3–40 of `a-z 0-9 -`, a letter somewhere, no dash at either end. `page` is the fingerprint of the jar's web page, `sha256:` and 64 lowercase hex digits. Unknown fields are ignored.
2. The relayer calls `submit(signed)`. The contract verifies the signature with the intents.near code (`defuse-core`, pinned commit), then calls `intents.near.has_public_key(signer_id, public_key)`.
3. Only if intents.near answers `true` is the action applied (`on_key_checked`). So the rules are exactly near.com's: if the owner rotates keys in near.com, NearJar follows.

ERC-191 signatures are 65 bytes `r‖s‖v` with `v` = 0/1 (MetaMask returns 27/28 — subtract 27).

## DAO payout

`jar.payout` sends a jar's donations to a Sputnik DAO treasury instead of the owner's near.com account.

- Only `<name>.sputnik-dao.near` with a one-label name is accepted: only the factory `sputnik-dao.near` can create its sub-accounts, so the suffix proves a Sputnik DAO. `sputnik-dao.near` itself, `a.b.sputnik-dao.near` and look-alikes such as `x.sputnik-dao.near.evil.near` are refused; uppercase or malformed ids do not parse.
- The payout is fixed at creation. Every `update_jar` must sign the same `payout` (omitted = none), otherwise it fails with `payout cannot change`. A creator cannot move a DAO jar, its total and its link, to themselves, nor point a plain jar at a DAO later.
- Delivery reads the recipient from `get_jar` only: `payout` if set, else `owner`.

The DAO acts on its jar through an approved **FunctionCall** proposal (in Trezu: a custom request) to `nearjar.near`, deposit `0`, gas `30 Tgas`; both methods reject an attached deposit and any caller but `jar.payout`, and work only on an open jar:

| Method | Args | Effect |
|---|---|---|
| `endorse_jar` | `{"jar_id":"<id>","revision":"<revision>"}` (`revision` optional) | `endorsed = true`; with `revision`, fails unless it is the jar's current one; event `jar_endorsed` `{jar_id, dao, revision}` |
| `dao_close_jar` | `{"jar_id":"<id>"}` | closes the jar exactly like the owner's `close_jar` (frees the owner's open-jar slot); event `jar_closed` `{jar_id, by: "dao"}` |

Ids are JSON strings (`"5"`, not `5`); a number fails to parse and Sputnik marks the proposal *Failed*.

Every `update_jar` increments `revision` and sets `endorsed = false` (event `jar_updated` `{jar_id, revision}`): the DAO endorsed what the jar showed then, not a later edit, and an owner who has left the DAO can't keep the badge over new content. Passing `revision` pins the version the members voted on, so an edit between filing and execution makes the proposal fail instead of endorsing it. The DAO has no "unendorse"; its stop button is `dao_close_jar`. The owner can still close a DAO jar with a signed `close_jar` (`jar_closed` with `by: "owner"`).

**DAO membership is checked off chain.** The contract accepts any `*.sputnik-dao.near` payout from any signer; NearJar's relay checks, before it submits, that the signer is in one of the DAO's group roles, that the DAO can pass a FunctionCall proposal and that no key is registered for it on `intents.near`. Every relayer added with `add_relayer` must run the same checks (today there is one, `relayer.nearjar.near`, used only by the web app).

## Short links and page fingerprints

`slug` and `page` are stored with the jar, so the web app's database can't point a link at another jar or change a page under it.

- A slug is unique across jars, first come first served, checked at `submit` and again in the callback (`short link taken`). Once claimed it keeps pointing at its jar for good: renaming a jar (or dropping its link, or closing it) doesn't free the old one, so links already shared can't change hands. A jar may return to any of its own earlier links.
- `get_jar_by_slug(slug)` returns the jar a link points at, current or earlier; `jar.slug` is the current one.
- The slug index lives under its own storage prefix (`StorageKey::Slugs`, appended last), opened where it is used, not as a field of `NearJar`: the root state stays exactly as deployed.
- `page` is opaque to the contract. The web app shows a stored page only when its text hashes to it.

## Views

`get_jar(jar_id)`, `get_jars(from, limit)` (≤ 100), `get_jars_by_owner(owner)` return jars as:

```json
{
  "id": "0",
  "owner": "8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c",
  "payout": "shitzu.sputnik-dao.near",
  "endorsed": false,
  "revision": "0",
  "slug": "cats-fund",
  "page": "sha256:9f2c5d0e6b7a8c1d2e3f405162738495a6b7c8d9e0f1a2b3c4d5e6f708192a3b",
  "title": "Cats",
  "description": "help the cats",
  "image_url": null,
  "goal_usd_cents": "50000",
  "ends_at": null,
  "receive_asset": "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  "status": "Open",
  "created_at": "1800000000000000000",
  "raised_usd_cents": "0",
  "donations_count": "0"
}
```

`payout` is `null` and `endorsed` is `false` for a jar paid to its owner. Also `get_jar_by_slug(slug)`, `get_donations(jar_id, from, limit)`, `get_config()` (with `version`, the crate version of the deployed code; builds before DAO payouts have none) and `is_nonce_used(signer_id, nonce)`. Events are NEP-297 `standard: "nearjar"`, `version: "1.1.0"`.

## Donations

`record_donation(jar_id, donation)` is relayer-only. The contract cannot see payments on other chains, so each receipt carries the intents.near delivery tx hash; `source_id` (1Click deposit address or intent hash) is unique, so a donation cannot be counted twice. The web app's relayer records a donation only after 1Click's `/status` for that deposit says `SUCCESS` to the jar's payout account, and takes the amounts from that answer, not from its database.

## Build and test

```sh
cargo test                                   # unit tests (signatures are real ed25519 / secp256k1)
cargo near build non-reproducible-wasm --no-abi   # sets --cfg=near (host-function crypto), runs wasm-opt → target/near/nearjar.wasm (~463 KB)
```

Rust is pinned to 1.97.1 (`rust-toolchain.toml`), the same as near/intents.

## Mainnet

Live since 2026-11-07 (wasm `7Xcyk6ciTSiwmqFhAFUGHudgwUtMcCjUBbpaJXgoDJqi`, the same build as testnet). That build has no DAO payout. The 0.2.0 build (DAO payouts, on-chain short links and page fingerprints) changes the stored `Jar` layout but not the contract state (`NearJar` and the existing storage prefixes are unchanged), so it upgrades in place only while `jars_count` is 0 (it was on 2026-11-08). Deploy it in one transaction with the guard, so the upgrade reverts if a jar was created in the meantime:

```sh
near contract deploy nearjar.near use-file target/near/nearjar.wasm \
  with-init-call assert_no_jars json-args '{}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
  network-config mainnet sign-with-keychain send
near contract call-function as-read-only nearjar.near get_config json-args '{}' network-config mainnet now   # version "0.2.0"
```

`assert_no_jars` is `#[private]` and panics `jars exist: this upgrade needs a migration`; as the init call of the same transaction, its panic rolls the deploy back. Deploy the contract before the web app that expects it (the web app refuses DAO jars while `get_config` has no `version`).

| Account | Role |
|---|---|
| [`nearjar.near`](https://nearblocks.io/address/nearjar.near) | NearJar (owner = itself), `intents_id = intents.near`, receive assets USDC, USDT, wNEAR, BTC, ETH |
| [`relayer.nearjar.near`](https://nearblocks.io/address/relayer.nearjar.near) | relayer; the server holds only a function-call key limited to `submit` and `record_donation` on `nearjar.near` |

Deploy + `new(...)`: [`2fhHk9zS…`](https://nearblocks.io/txns/2fhHk9zSrjfxufNo13WtEmKLbXyHi34U3ECZfQni4cQ3) · `add_relayer`: [`ALDC7icy…`](https://nearblocks.io/txns/ALDC7icyngJZ6TB4PzS2WioAqxTEXabuPCdHkXChwkzq).

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

0.2.0 verified on a fresh account, `nearjar-v2-e2e.testnet` (2026-11-08), through the web app's own prepare and relay
routes: create with a short link and page fingerprint ([`FKueRN8R…`](https://testnet.nearblocks.io/txns/FKueRN8R5PAf3kCe4YnJMWF1JgiqGSAEEaoNTFM5T49q)),
update to a new link (revision 1, the old link still resolves to the jar) ([`2qvxgebV…`](https://testnet.nearblocks.io/txns/2qvxgebV8whxpeGDEuchXJScQrRhNzK2ayfGvmer1p1J)),
close ([`EgGqDZtY…`](https://testnet.nearblocks.io/txns/EgGqDZtYAs4kaYef9n2KNHgcHbu21v5LcWBd5y18KskT)); a replay, a stranger's update, a taken
or reserved link and a page changed after signing were refused, and a page edited in the database was not shown.

`nearjar.testnet` still runs the 0.1.0 build and probably holds jars in the old layout: deploying 0.2.0 over it would make them unreadable. Use a fresh account for the new build (the same `assert_no_jars` deploy works there). DAO payouts accept only mainnet `*.sputnik-dao.near` ids, and the stub has no `public_keys_of`, so DAO jars can't be made on testnet.
