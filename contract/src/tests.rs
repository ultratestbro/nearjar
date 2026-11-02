use super::*;

use ed25519_dalek::{Signer, SigningKey};
use near_sdk::{test_utils::VMContextBuilder, testing_env};
use sha3::{Digest, Keccak256};

const USDC: &str = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const NOW: u64 = 1_800_000_000_000_000_000;
const MIN: u64 = 60 * 1_000_000_000;

fn contract_id() -> AccountId {
    "nearjar.near".parse().unwrap()
}
fn relayer() -> AccountId {
    "relayer.nearjar.near".parse().unwrap()
}

fn ctx(predecessor: AccountId) {
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(contract_id())
            .predecessor_account_id(predecessor)
            .block_timestamp(NOW)
            .build()
    );
}

/// The callback runs as the contract itself; in unit tests intents.near's answer is passed as
/// the `key_ok` argument.
fn callback_ctx() {
    ctx(contract_id());
}

fn setup() -> NearJar {
    // the contract account administers itself (nearjar.near)
    ctx(contract_id());
    let mut c = NearJar::new(
        contract_id(),
        "intents.near".parse().unwrap(),
        vec![USDC.into()],
    );
    c.add_relayer(relayer());
    c
}

fn jar_input(title: &str) -> serde_json::Value {
    serde_json::json!({
        "title": title,
        "description": "help the cats",
        "image_url": null,
        "goal_usd_cents": "50000",
        "ends_at": null,
        "receive_asset": USDC,
    })
}

fn rfc3339(ns: u64) -> String {
    // deadlines in tests are whole seconds after 2027-01-15T08:00:00Z (= NOW)
    let secs = (ns - NOW) / 1_000_000_000;
    format!(
        "2027-01-15T{:02}:{:02}:{:02}Z",
        8 + secs / 3600,
        secs / 60 % 60,
        secs % 60
    )
}

fn envelope(signer: &str, nonce: u8, deadline_ns: u64, action: serde_json::Value) -> String {
    let mut v = serde_json::json!({
        "signer_id": signer,
        "verifying_contract": "nearjar.near",
        "deadline": rfc3339(deadline_ns),
        "nonce": near_sdk::base64::Engine::encode(
            &near_sdk::base64::engine::general_purpose::STANDARD,
            [nonce; 32],
        ),
    });
    for (k, val) in action.as_object().unwrap() {
        v[k] = val.clone();
    }
    v.to_string()
}

struct Ed {
    key: SigningKey,
}
impl Ed {
    fn new(seed: u8) -> Self {
        Self {
            key: SigningKey::from_bytes(&[seed; 32]),
        }
    }
    fn account(&self) -> String {
        hex::encode(self.key.verifying_key().as_bytes())
    }
    fn sign(&self, payload: &str) -> MultiPayload {
        let sig = self.key.sign(payload.as_bytes());
        serde_json::from_value(serde_json::json!({
            "standard": "raw_ed25519",
            "payload": payload,
            "public_key": format!("ed25519:{}", bs58::encode(self.key.verifying_key().as_bytes()).into_string()),
            "signature": format!("ed25519:{}", bs58::encode(sig.to_bytes()).into_string()),
        }))
        .unwrap()
    }
}

struct Evm {
    key: k256::ecdsa::SigningKey,
}
impl Evm {
    fn new(seed: u8) -> Self {
        Self {
            key: k256::ecdsa::SigningKey::from_bytes(&[seed; 32].into()).unwrap(),
        }
    }
    fn account(&self) -> String {
        let pk = self.key.verifying_key().to_encoded_point(false);
        let hash = Keccak256::digest(&pk.as_bytes()[1..]);
        format!("0x{}", hex::encode(&hash[12..]))
    }
    /// personal_sign, with v normalized to 0/1 as intents.near expects.
    fn sign(&self, payload: &str) -> MultiPayload {
        let prehash = Keccak256::new_with_prefix(b"\x19Ethereum Signed Message:\n")
            .chain_update(payload.len().to_string())
            .chain_update(payload)
            .finalize();
        let (sig, rid) = self.key.sign_prehash_recoverable(&prehash).unwrap();
        let mut bytes = sig.to_bytes().to_vec();
        bytes.push(rid.to_byte());
        serde_json::from_value(serde_json::json!({
            "standard": "erc191",
            "payload": payload,
            "signature": format!("secp256k1:{}", bs58::encode(bytes).into_string()),
        }))
        .unwrap()
    }
}

fn create_action(title: &str) -> serde_json::Value {
    serde_json::json!({ "action": "create_jar", "jar": jar_input(title) })
}

/// submit + intents.near says yes → jar id
fn create_ok(c: &mut NearJar, signer: &str, signed: MultiPayload) -> U64 {
    ctx(relayer());
    let _ = c.submit(signed);
    callback_ctx();
    let action: JarAction = serde_json::from_value(create_action("Cats")).unwrap();
    c.on_key_checked(signer.parse().unwrap(), action, Ok(true))
}

#[test]
fn create_with_raw_ed25519_solana_style() {
    let mut c = setup();
    let ed = Ed::new(1);
    let payload = envelope(&ed.account(), 1, NOW + 5 * MIN, create_action("Cats"));
    let id = create_ok(&mut c, &ed.account(), ed.sign(&payload));

    let jar = c.get_jar(id).unwrap();
    assert_eq!(jar.owner.as_str(), ed.account());
    assert_eq!(jar.input.title, "Cats");
    assert_eq!(jar.status, JarStatus::Open);
    assert_eq!(c.get_jars_by_owner(jar.owner.clone()).len(), 1);
}

#[test]
fn create_with_erc191_evm() {
    let mut c = setup();
    let evm = Evm::new(7);
    let payload = envelope(&evm.account(), 1, NOW + 5 * MIN, create_action("Cats"));
    let id = create_ok(&mut c, &evm.account(), evm.sign(&payload));
    assert_eq!(c.get_jar(id).unwrap().owner.as_str(), evm.account());
}

#[test]
#[should_panic(expected = "nonce already used")]
fn replayed_nonce_is_rejected() {
    let mut c = setup();
    let ed = Ed::new(1);
    let signed = ed.sign(&envelope(
        &ed.account(),
        1,
        NOW + 5 * MIN,
        create_action("Cats"),
    ));
    ctx(relayer());
    let _ = c.submit(signed.clone());
    let _ = c.submit(signed);
}

#[test]
#[should_panic(expected = "wrong verifying_contract")]
fn payload_for_another_contract_is_rejected() {
    let mut c = setup();
    let ed = Ed::new(1);
    let payload = envelope(&ed.account(), 1, NOW + 5 * MIN, create_action("Cats"))
        .replace("nearjar.near", "intents.near");
    ctx(relayer());
    let _ = c.submit(ed.sign(&payload));
}

#[test]
#[should_panic(expected = "invalid signature")]
fn tampered_payload_is_rejected() {
    let mut c = setup();
    let ed = Ed::new(1);
    let payload = envelope(&ed.account(), 1, NOW + 5 * MIN, create_action("Cats"));
    let mut v = serde_json::to_value(ed.sign(&payload)).unwrap();
    v["payload"] = payload.replace("Cats", "Dogs").into();
    ctx(relayer());
    let _ = c.submit(serde_json::from_value(v).unwrap());
}

#[test]
#[should_panic(expected = "deadline expired")]
fn expired_deadline_is_rejected() {
    let mut c = setup();
    let ed = Ed::new(1);
    let mut payload = envelope(&ed.account(), 1, NOW + 5 * MIN, create_action("Cats"));
    payload = payload.replace("2027-01-15T08:05:00Z", "2027-01-15T07:59:00Z");
    ctx(relayer());
    let _ = c.submit(ed.sign(&payload));
}

#[test]
#[should_panic(expected = "deadline too far")]
fn far_deadline_is_rejected() {
    let mut c = setup();
    let ed = Ed::new(1);
    let payload = envelope(&ed.account(), 1, NOW + 61 * MIN, create_action("Cats"));
    ctx(relayer());
    let _ = c.submit(ed.sign(&payload));
}

#[test]
#[should_panic(expected = "relayer only")]
fn only_relayer_submits() {
    let mut c = setup();
    let ed = Ed::new(1);
    let payload = envelope(&ed.account(), 1, NOW + 5 * MIN, create_action("Cats"));
    ctx("random.near".parse().unwrap());
    let _ = c.submit(ed.sign(&payload));
}

#[test]
#[should_panic(expected = "public key is not registered")]
fn key_not_registered_in_intents_creates_nothing() {
    let mut c = setup();
    let ed = Ed::new(1);
    let payload = envelope(&ed.account(), 1, NOW + 5 * MIN, create_action("Cats"));
    ctx(relayer());
    let _ = c.submit(ed.sign(&payload));
    callback_ctx();
    c.on_key_checked(
        ed.account().parse().unwrap(),
        serde_json::from_value(create_action("Cats")).unwrap(),
        Ok(false),
    );
}

#[test]
#[should_panic(expected = "receive_asset not supported")]
fn unknown_asset_is_rejected() {
    let mut c = setup();
    let ed = Ed::new(1);
    let mut action = create_action("Cats");
    action["jar"]["receive_asset"] = "nep141:evil.near".into();
    let payload = envelope(&ed.account(), 1, NOW + 5 * MIN, action);
    ctx(relayer());
    let _ = c.submit(ed.sign(&payload));
}

#[test]
#[should_panic(expected = "not the jar owner")]
fn stranger_cannot_close_a_jar() {
    let mut c = setup();
    let owner = Ed::new(1);
    let payload = envelope(&owner.account(), 1, NOW + 5 * MIN, create_action("Cats"));
    let id = create_ok(&mut c, &owner.account(), owner.sign(&payload));

    let stranger = Ed::new(2);
    let close = serde_json::json!({ "action": "close_jar", "jar_id": id });
    let payload = envelope(&stranger.account(), 1, NOW + 5 * MIN, close);
    ctx(relayer());
    let _ = c.submit(stranger.sign(&payload));
}

#[test]
fn owner_updates_and_closes() {
    let mut c = setup();
    let owner = Ed::new(1);
    let payload = envelope(&owner.account(), 1, NOW + 5 * MIN, create_action("Cats"));
    let id = create_ok(&mut c, &owner.account(), owner.sign(&payload));

    let update =
        serde_json::json!({ "action": "update_jar", "jar_id": id, "jar": jar_input("Cats 2") });
    ctx(relayer());
    let _ = c.submit(owner.sign(&envelope(
        &owner.account(),
        2,
        NOW + 5 * MIN,
        update.clone(),
    )));
    callback_ctx();
    c.on_key_checked(
        owner.account().parse().unwrap(),
        serde_json::from_value(update).unwrap(),
        Ok(true),
    );
    assert_eq!(c.get_jar(id).unwrap().input.title, "Cats 2");

    let close = serde_json::json!({ "action": "close_jar", "jar_id": id });
    ctx(relayer());
    let _ = c.submit(owner.sign(&envelope(&owner.account(), 3, NOW + 5 * MIN, close.clone())));
    callback_ctx();
    c.on_key_checked(
        owner.account().parse().unwrap(),
        serde_json::from_value(close).unwrap(),
        Ok(true),
    );
    assert_eq!(c.get_jar(id).unwrap().status, JarStatus::Closed);
}

fn donation(source: &str, cents: u64) -> DonationInput {
    DonationInput {
        source_id: source.into(),
        method: DonationMethod::Wallet,
        usd_cents: U64(cents),
        asset: USDC.into(),
        amount: U128(u128::from(cents) * 10_000),
        delivery_tx: "4kD8…tx".into(),
    }
}

#[test]
fn donations_add_up_and_are_deduplicated() {
    let mut c = setup();
    let owner = Ed::new(1);
    let payload = envelope(&owner.account(), 1, NOW + 5 * MIN, create_action("Cats"));
    let id = create_ok(&mut c, &owner.account(), owner.sign(&payload));

    ctx(relayer());
    c.record_donation(id, donation("deposit-a", 500));
    c.record_donation(id, donation("deposit-b", 1250));
    let jar = c.get_jar(id).unwrap();
    assert_eq!(jar.raised_usd_cents.0, 1750);
    assert_eq!(jar.donations_count.0, 2);
    assert_eq!(c.get_donations(id, U64(0), 10).len(), 2);

    let dup = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.record_donation(id, donation("deposit-a", 500));
    }));
    assert!(dup.is_err(), "same source recorded twice");
}

#[test]
#[should_panic(expected = "relayer only")]
fn only_relayer_records_donations() {
    let mut c = setup();
    ctx("random.near".parse().unwrap());
    c.record_donation(U64(0), donation("x", 1));
}

#[test]
#[should_panic(expected = "owner only")]
fn only_owner_adds_relayers() {
    let mut c = setup();
    ctx(relayer());
    c.add_relayer("evil.near".parse().unwrap());
}
