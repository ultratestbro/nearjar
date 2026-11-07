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
        "goal": "$500",
        "receive": "USDC",
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

/// The `on_key_checked` call that `submit` scheduled, with the arguments the callback receives
/// on chain: what the tests apply is what the contract read out of the signed text.
fn scheduled_callback() -> (AccountId, JarAction) {
    #[derive(serde::Deserialize)]
    struct Args {
        signer_id: AccountId,
        action: JarAction,
    }
    let args = near_sdk::test_utils::get_created_receipts()
        .into_iter()
        .flat_map(|r| r.actions)
        .find_map(|a| match a {
            near_sdk::mock::MockAction::FunctionCallWeight {
                method_name, args, ..
            } if method_name == b"on_key_checked" => Some(args),
            _ => None,
        })
        .expect("submit schedules on_key_checked");
    let a: Args = serde_json::from_slice(&args).unwrap();
    (a.signer_id, a.action)
}

/// submit + intents.near says yes → the callback's result
fn submit_ok(c: &mut NearJar, signer: &str, signed: MultiPayload) -> U64 {
    ctx(relayer());
    let _ = c.submit(signed);
    let (signer_id, action) = scheduled_callback();
    assert_eq!(signer_id.as_str(), signer);
    callback_ctx();
    c.on_key_checked(signer_id, action, Ok(true))
}

fn create_ok(c: &mut NearJar, signer: &str, signed: MultiPayload) -> U64 {
    submit_ok(c, signer, signed)
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
    action["jar"]["receive"] = "EVIL".into();
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
    let signed = owner.sign(&envelope(&owner.account(), 2, NOW + 5 * MIN, update));
    submit_ok(&mut c, &owner.account(), signed);
    let jar = c.get_jar(id).unwrap();
    assert_eq!(jar.input.title, "Cats 2");
    assert_eq!(jar.revision, U64(1));

    let close = serde_json::json!({ "action": "close_jar", "jar_id": id });
    let signed = owner.sign(&envelope(&owner.account(), 3, NOW + 5 * MIN, close));
    submit_ok(&mut c, &owner.account(), signed);
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

#[test]
fn signed_goal_and_symbol_become_stored_fields() {
    let mut c = setup();
    let ed = Ed::new(1);
    let payload = envelope(&ed.account(), 1, NOW + 5 * MIN, create_action("Cats"));
    let id = create_ok(&mut c, &ed.account(), ed.sign(&payload));
    let jar = c.get_jar(id).unwrap();
    assert_eq!(jar.input.goal_usd_cents, Some(U64(50_000)));
    assert_eq!(jar.input.receive_asset, USDC);
}

#[test]
fn usd_goal_spelling_is_canonical() {
    assert_eq!(parse_usd_cents("$1,500"), Some(150_000));
    assert_eq!(parse_usd_cents("$1,500.50"), Some(150_050));
    assert_eq!(parse_usd_cents("$12"), Some(1_200));
    assert_eq!(parse_usd_cents("$10,000,000"), Some(1_000_000_000));
    for bad in [
        "1500",
        "$1500",
        "$1,50",
        "$01",
        "$1.5",
        "$1,500.",
        "$,500",
        "$1,500.505",
        "$ 5",
        "$-5",
        "$0,500",
    ] {
        assert_eq!(parse_usd_cents(bad), None, "{bad}");
    }
}

#[test]
#[should_panic(expected = "bad goal")]
fn non_canonical_goal_is_rejected() {
    let mut c = setup();
    let ed = Ed::new(1);
    let mut action = create_action("Cats");
    action["jar"]["goal"] = "$1500".into();
    let payload = envelope(&ed.account(), 1, NOW + 5 * MIN, action);
    ctx(relayer());
    let _ = c.submit(ed.sign(&payload));
}

#[test]
fn pretty_printed_action_first_payload_verifies() {
    let mut c = setup();
    let ed = Ed::new(1);
    let compact = envelope(&ed.account(), 1, NOW + 5 * MIN, create_action("Cats"));
    let v: serde_json::Value = serde_json::from_str(&compact).unwrap();
    // the order the web app signs: what happens first, envelope fields last
    let payload = format!(
        "{{\n  \"action\": \"create_jar\",\n  \"jar\": {},\n  \"signer_id\": {},\n  \"verifying_contract\": {},\n  \"deadline\": {},\n  \"nonce\": {}\n}}",
        serde_json::to_string_pretty(&v["jar"])
            .unwrap()
            .replace('\n', "\n  "),
        v["signer_id"],
        v["verifying_contract"],
        v["deadline"],
        v["nonce"],
    );
    let id = create_ok(&mut c, &ed.account(), ed.sign(&payload));
    assert_eq!(c.get_jar(id).unwrap().input.title, "Cats");
}

const PAGE: &str = "sha256:9f2c5d0e6b7a8c1d2e3f405162738495a6b7c8d9e0f1a2b3c4d5e6f708192a3b";

#[test]
fn signed_page_fingerprint_is_stored() {
    // The web app signs a fingerprint of the jar page (cover, milestones, thank-you note…) next
    // to the stored fields; the contract keeps it, so the page kept off chain can be checked.
    let mut c = setup();
    let owner = Ed::new(1);
    let mut action = create_action("Cats");
    action["jar"]["page"] = PAGE.into();
    let id = apply(&mut c, &owner, 1, action);
    let jar = c.get_jar(id).unwrap();
    assert_eq!(jar.input.page.as_deref(), Some(PAGE));
    assert_eq!(serde_json::to_value(&jar).unwrap()["page"], PAGE);

    // an edit signs the new page; leaving it out clears it
    let mut edit = jar_input("Cats");
    edit["page"] = PAGE.replace("9f2c", "0000").into();
    apply(&mut c, &owner, 2, update_action(id, edit));
    assert!(
        c.get_jar(id)
            .unwrap()
            .input
            .page
            .unwrap()
            .starts_with("sha256:0000")
    );
    apply(&mut c, &owner, 3, update_action(id, jar_input("Cats")));
    assert_eq!(c.get_jar(id).unwrap().input.page, None);
}

#[test]
fn page_fingerprint_spelling() {
    assert!(is_page_fingerprint(PAGE));
    let hex = &PAGE["sha256:".len()..];
    for bad in [
        hex.to_string(),
        format!("sha256:{}", &hex[1..]),
        format!("sha256:{hex}0"),
        format!("sha256:{}", hex.to_uppercase()),
        format!("SHA256:{hex}"),
        format!("sha256:{}g", &hex[1..]),
        "sha256:9f2c…".to_string(),
        String::new(),
    ] {
        assert!(!is_page_fingerprint(&bad), "{bad}");
    }
    let mut c = setup();
    let owner = Ed::new(1);
    let mut action = create_action("Cats");
    action["jar"]["page"] = "sha256:9f2c…".into();
    let payload = envelope(&owner.account(), 1, NOW + 5 * MIN, action);
    ctx(relayer());
    assert_panics("page must be sha256", || {
        let _ = c.submit(owner.sign(&payload));
    });
}

// ---------- DAO payout ----------

const DAO: &str = "shitzu.sputnik-dao.near";

fn dao() -> AccountId {
    DAO.parse().unwrap()
}

fn dao_jar_action(title: &str, payout: &str) -> serde_json::Value {
    let mut jar = jar_input(title);
    jar["payout"] = payout.into();
    serde_json::json!({ "action": "create_jar", "jar": jar })
}

/// Signs `action`, submits it and runs the callback `submit` scheduled → the callback's result
fn apply(c: &mut NearJar, signer: &Ed, nonce: u8, action: serde_json::Value) -> U64 {
    let signed = signer.sign(&envelope(&signer.account(), nonce, NOW + 5 * MIN, action));
    submit_ok(c, &signer.account(), signed)
}

fn create_dao_jar(c: &mut NearJar, owner: &Ed) -> U64 {
    apply(c, owner, 1, dao_jar_action("Cats", DAO))
}

/// `f` must panic with a message containing `expected`.
fn assert_panics(expected: &str, f: impl FnOnce()) {
    let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f))
        .expect_err(&format!("expected a panic: {expected}"));
    let msg = err
        .downcast_ref::<String>()
        .map(String::as_str)
        .or_else(|| err.downcast_ref::<&str>().copied())
        .unwrap_or_default();
    assert!(msg.contains(expected), "expected {expected:?}, got {msg:?}");
}

fn update_action(jar_id: U64, jar: serde_json::Value) -> serde_json::Value {
    serde_json::json!({ "action": "update_jar", "jar_id": jar_id, "jar": jar })
}

#[test]
fn sputnik_dao_ids() {
    for good in [
        "shitzu.sputnik-dao.near",
        "webassemblymusic-treasury.sputnik-dao.near",
        "a.sputnik-dao.near",
        "0x1_dao.sputnik-dao.near",
    ] {
        assert!(is_sputnik_dao(&good.parse().unwrap()), "{good}");
    }
    for bad in [
        "sputnik-dao.near",
        "evil.near",
        "x.sputnik-dao.near.evil.near",
        "xsputnik-dao.near",
        "x.sputnik-dao.testnet",
        "x.sputnik.near",
        "a.b.sputnik-dao.near",
        "sputnik-dao.near.sputnik-dao.near",
    ] {
        assert!(!is_sputnik_dao(&bad.parse().unwrap()), "{bad}");
    }
    // not account ids at all, so a signed payout with them does not even parse
    for invalid in [
        "Shitzu.sputnik-dao.near",
        ".sputnik-dao.near",
        "x..sputnik-dao.near",
        "-x.sputnik-dao.near",
        "x y.sputnik-dao.near",
        "",
    ] {
        assert!(invalid.parse::<AccountId>().is_err(), "{invalid:?}");
    }
}

#[test]
fn dao_jar_stores_payout_unendorsed() {
    let mut c = setup();
    let owner = Ed::new(1);
    let id = create_dao_jar(&mut c, &owner);

    let jar = c.get_jar(id).unwrap();
    assert_eq!(jar.owner.as_str(), owner.account());
    assert_eq!(jar.payout, Some(dao()));
    assert!(!jar.endorsed);

    let view = serde_json::to_value(&jar).unwrap();
    assert_eq!(view["payout"], DAO);
    assert_eq!(view["endorsed"], false);
    assert_eq!(view["title"], "Cats");
    assert_eq!(c.get_jars(U64(0), 10)[0].payout, Some(dao()));
    assert_eq!(c.get_jars_by_owner(jar.owner)[0].payout, Some(dao()));
}

#[test]
fn plain_jar_has_no_payout_and_no_endorsement() {
    let mut c = setup();
    let owner = Ed::new(1);
    let id = apply(&mut c, &owner, 1, create_action("Cats"));
    let view = serde_json::to_value(c.get_jar(id).unwrap()).unwrap();
    assert_eq!(view["payout"], serde_json::Value::Null);
    assert_eq!(view["endorsed"], false);

    // an explicit null is the same as no payout
    let mut action = create_action("Dogs");
    action["jar"]["payout"] = serde_json::Value::Null;
    let id = apply(&mut c, &owner, 2, action);
    assert_eq!(c.get_jar(id).unwrap().payout, None);

    // nobody, the DAO included, can endorse or close it as a DAO
    for caller in [
        dao(),
        owner.account().parse().unwrap(),
        relayer(),
        contract_id(),
    ] {
        ctx(caller);
        assert_panics("only the jar's payout DAO", || c.endorse_jar(id, None));
        assert_panics("only the jar's payout DAO", || c.dao_close_jar(id));
    }
}

#[test]
fn payout_must_be_a_sputnik_dao() {
    for (i, bad) in [
        "sputnik-dao.near",
        "evil.near",
        "x.sputnik-dao.near.evil.near",
        "a.b.sputnik-dao.near",
        "x.sputnik-dao.testnet",
    ]
    .into_iter()
    .enumerate()
    {
        let mut c = setup();
        let owner = Ed::new(1);
        // mocked storage outlives the panic (on chain it would roll back), so a fresh nonce each
        let nonce = u8::try_from(i).unwrap() + 1;
        let payload = envelope(
            &owner.account(),
            nonce,
            NOW + 5 * MIN,
            dao_jar_action("Cats", bad),
        );
        ctx(relayer());
        assert_panics("payout must be a Sputnik DAO", || {
            let _ = c.submit(owner.sign(&payload));
        });
        // the callback checks again
        callback_ctx();
        assert_panics("payout must be a Sputnik DAO", || {
            c.on_key_checked(
                owner.account().parse().unwrap(),
                serde_json::from_value(dao_jar_action("Cats", bad)).unwrap(),
                Ok(true),
            );
        });
    }
}

#[test]
fn payout_that_is_not_an_account_id_is_rejected() {
    for invalid in ["Shitzu.sputnik-dao.near", "x..sputnik-dao.near", ""] {
        let mut c = setup();
        let owner = Ed::new(1);
        let payload = envelope(
            &owner.account(),
            1,
            NOW + 5 * MIN,
            dao_jar_action("Cats", invalid),
        );
        ctx(relayer());
        assert_panics("invalid payload", || {
            let _ = c.submit(owner.sign(&payload));
        });
    }
}

#[test]
fn update_keeps_the_payout() {
    let mut c = setup();
    let owner = Ed::new(1);
    let id = create_dao_jar(&mut c, &owner);

    let mut jar = jar_input("Cats 2");
    jar["payout"] = DAO.into();
    apply(&mut c, &owner, 2, update_action(id, jar));
    let stored = c.get_jar(id).unwrap();
    assert_eq!(stored.input.title, "Cats 2");
    assert_eq!(stored.payout, Some(dao()));
}

#[test]
#[should_panic(expected = "payout cannot change")]
fn update_cannot_switch_the_dao() {
    let mut c = setup();
    let owner = Ed::new(1);
    let id = create_dao_jar(&mut c, &owner);
    let mut jar = jar_input("Cats");
    jar["payout"] = "evil.sputnik-dao.near".into();
    apply(&mut c, &owner, 2, update_action(id, jar));
}

#[test]
#[should_panic(expected = "payout cannot change")]
fn update_cannot_remove_the_dao() {
    let mut c = setup();
    let owner = Ed::new(1);
    let id = create_dao_jar(&mut c, &owner);
    // the payout key left out: the creator would take the jar's total and link for themselves
    apply(&mut c, &owner, 2, update_action(id, jar_input("Cats")));
}

#[test]
#[should_panic(expected = "payout cannot change")]
fn update_cannot_remove_the_dao_with_null() {
    let mut c = setup();
    let owner = Ed::new(1);
    let id = create_dao_jar(&mut c, &owner);
    let mut jar = jar_input("Cats");
    jar["payout"] = serde_json::Value::Null;
    apply(&mut c, &owner, 2, update_action(id, jar));
}

#[test]
#[should_panic(expected = "payout cannot change")]
fn update_cannot_add_a_dao() {
    let mut c = setup();
    let owner = Ed::new(1);
    let id = apply(&mut c, &owner, 1, create_action("Cats"));
    let mut jar = jar_input("Cats");
    jar["payout"] = DAO.into();
    apply(&mut c, &owner, 2, update_action(id, jar));
}

#[test]
#[should_panic(expected = "payout cannot change")]
fn callback_rechecks_the_payout() {
    let mut c = setup();
    let owner = Ed::new(1);
    let id = create_dao_jar(&mut c, &owner);
    callback_ctx();
    c.on_key_checked(
        owner.account().parse().unwrap(),
        serde_json::from_value(update_action(id, jar_input("Cats"))).unwrap(),
        Ok(true),
    );
}

#[test]
fn dao_endorses_its_jar() {
    let mut c = setup();
    let owner = Ed::new(1);
    let id = create_dao_jar(&mut c, &owner);

    ctx(dao());
    c.endorse_jar(id, None);
    let jar = c.get_jar(id).unwrap();
    assert!(jar.endorsed);
    assert_eq!(jar.status, JarStatus::Open);
    let logs = near_sdk::test_utils::get_logs();
    assert!(
        logs.iter()
            .any(|l| l.contains("\"jar_endorsed\"") && l.contains(DAO)),
        "{logs:?}"
    );
}

#[test]
fn owner_edit_clears_the_endorsement() {
    let mut c = setup();
    let owner = Ed::new(1);
    let id = create_dao_jar(&mut c, &owner);
    ctx(dao());
    c.endorse_jar(id, None);
    assert!(c.get_jar(id).unwrap().endorsed);

    // the DAO endorsed what the jar showed then; an edit (even by an owner who left the DAO)
    // must not keep the badge over content the DAO never saw
    let mut edit = jar_input("Cats 2");
    edit["payout"] = DAO.into();
    apply(&mut c, &owner, 2, update_action(id, edit));
    let jar = c.get_jar(id).unwrap();
    assert!(!jar.endorsed);
    assert_eq!(jar.revision, U64(1));
    assert_eq!(jar.payout, Some(dao()));
    let logs = near_sdk::test_utils::get_logs();
    assert!(
        logs.iter()
            .any(|l| l.contains("\"jar_updated\"") && l.contains("\"revision\":\"1\"")),
        "{logs:?}"
    );

    // the DAO endorses the new version by its revision
    ctx(dao());
    c.endorse_jar(id, Some(U64(1)));
    assert!(c.get_jar(id).unwrap().endorsed);
}

#[test]
fn endorsement_pins_the_revision_voted_on() {
    let mut c = setup();
    let owner = Ed::new(1);
    let id = create_dao_jar(&mut c, &owner);
    // the DAO files `endorse_jar {jar_id, revision: 0}`; the owner edits before it passes
    let mut edit = jar_input("Something else");
    edit["payout"] = DAO.into();
    apply(&mut c, &owner, 2, update_action(id, edit));

    ctx(dao());
    assert_panics("the jar changed since this proposal", || {
        c.endorse_jar(id, Some(U64(0)))
    });
    assert!(!c.get_jar(id).unwrap().endorsed);
    c.endorse_jar(id, Some(U64(1)));
    assert!(c.get_jar(id).unwrap().endorsed);
}

#[test]
fn only_the_dao_endorses_or_closes() {
    let mut c = setup();
    let owner = Ed::new(1);
    let id = create_dao_jar(&mut c, &owner);

    for caller in [
        owner.account().parse().unwrap(),
        relayer(),
        contract_id(),
        "random.near".parse().unwrap(),
        "other.sputnik-dao.near".parse().unwrap(),
        "sputnik-dao.near".parse().unwrap(),
    ] {
        ctx(caller);
        assert_panics("only the jar's payout DAO", || c.endorse_jar(id, None));
        assert_panics("only the jar's payout DAO", || c.dao_close_jar(id));
    }
    let jar = c.get_jar(id).unwrap();
    assert!(!jar.endorsed);
    assert_eq!(jar.status, JarStatus::Open);
}

#[test]
fn dao_closes_its_jar_like_the_owner() {
    let mut c = setup();
    let owner = Ed::new(1);
    let id = create_dao_jar(&mut c, &owner);
    let owner_id: AccountId = owner.account().parse().unwrap();
    assert_eq!(c.owner_jar_count.get(&owner_id).copied(), Some(1));

    ctx(dao());
    c.dao_close_jar(id);
    assert_eq!(c.get_jar(id).unwrap().status, JarStatus::Closed);
    // frees the owner's open-jar slot
    assert_eq!(c.owner_jar_count.get(&owner_id).copied(), Some(0));
    let logs = near_sdk::test_utils::get_logs();
    assert!(
        logs.iter()
            .any(|l| l.contains("\"jar_closed\"") && l.contains("\"by\":\"dao\"")),
        "{logs:?}"
    );

    // closed is final: no second close, no endorsement, no owner close or update
    assert_panics("jar is closed", || c.dao_close_jar(id));
    assert_panics("jar is closed", || c.endorse_jar(id, None));
    let close = serde_json::json!({ "action": "close_jar", "jar_id": id });
    let payload = envelope(&owner.account(), 2, NOW + 5 * MIN, close);
    ctx(relayer());
    assert_panics("jar is closed", || {
        let _ = c.submit(owner.sign(&payload));
    });
    assert_eq!(c.owner_jar_count.get(&owner_id).copied(), Some(0));
}

#[test]
#[should_panic(expected = "jar is closed")]
fn dao_cannot_endorse_a_closed_jar() {
    let mut c = setup();
    let owner = Ed::new(1);
    let id = create_dao_jar(&mut c, &owner);
    apply(
        &mut c,
        &owner,
        2,
        serde_json::json!({ "action": "close_jar", "jar_id": id }),
    );
    ctx(dao());
    c.endorse_jar(id, None);
}

#[test]
fn owner_still_closes_a_dao_jar() {
    let mut c = setup();
    let owner = Ed::new(1);
    let id = create_dao_jar(&mut c, &owner);
    apply(
        &mut c,
        &owner,
        2,
        serde_json::json!({ "action": "close_jar", "jar_id": id }),
    );
    assert_eq!(c.get_jar(id).unwrap().status, JarStatus::Closed);
    assert_eq!(
        c.owner_jar_count
            .get(&owner.account().parse::<AccountId>().unwrap())
            .copied(),
        Some(0)
    );
    let logs = near_sdk::test_utils::get_logs();
    assert!(
        logs.iter()
            .any(|l| l.contains("\"jar_closed\"") && l.contains("\"by\":\"owner\"")),
        "{logs:?}"
    );
}

#[test]
fn donations_to_a_dao_jar_are_recorded_as_before() {
    let mut c = setup();
    let owner = Ed::new(1);
    let id = create_dao_jar(&mut c, &owner);
    ctx(relayer());
    c.record_donation(id, donation("deposit-a", 500));
    let jar = c.get_jar(id).unwrap();
    assert_eq!(jar.raised_usd_cents.0, 500);
    assert_eq!(jar.payout, Some(dao()));
}

#[test]
fn get_jar_json_shape() {
    let mut c = setup();
    let owner = Ed::new(1);
    let id = create_dao_jar(&mut c, &owner);
    let view = serde_json::to_value(c.get_jar(id).unwrap()).unwrap();
    let mut keys: Vec<&str> = view
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    let mut expected = [
        "id",
        "owner",
        "payout",
        "endorsed",
        "revision",
        "slug",
        "page",
        "title",
        "description",
        "image_url",
        "goal_usd_cents",
        "ends_at",
        "receive_asset",
        "status",
        "created_at",
        "raised_usd_cents",
        "donations_count",
    ];
    expected.sort_unstable();
    assert_eq!(keys, expected);
    println!("{}", serde_json::to_string_pretty(&view).unwrap());
}

#[test]
fn submit_hands_the_signed_payout_to_the_callback() {
    // what `submit` schedules is what the callback applies: if serde ever dropped `payout` on
    // the way, a DAO-signed jar would pay its creator
    let mut c = setup();
    let owner = Ed::new(1);
    let mut action = dao_jar_action("Cats", DAO);
    action["jar"]["slug"] = "cats-fund".into();
    action["jar"]["page"] = PAGE.into();
    ctx(relayer());
    let _ = c.submit(owner.sign(&envelope(&owner.account(), 1, NOW + 5 * MIN, action)));

    let receipts = near_sdk::test_utils::get_created_receipts();
    let key_check = receipts
        .iter()
        .find(|r| r.receiver_id.as_str() == "intents.near")
        .expect("asks intents.near");
    assert!(key_check.actions.iter().any(|a| matches!(
        a,
        near_sdk::mock::MockAction::FunctionCallWeight { method_name, args, .. }
            if method_name == b"has_public_key"
                && String::from_utf8_lossy(args).contains(&owner.account())
    )));
    let (signer, scheduled) = scheduled_callback();
    assert_eq!(signer.as_str(), owner.account());
    let JarAction::CreateJar { jar } = &scheduled else {
        panic!("{scheduled:?}")
    };
    assert_eq!(jar.payout, Some(dao()));
    assert_eq!(jar.slug.as_deref(), Some("cats-fund"));
    assert_eq!(jar.page.as_deref(), Some(PAGE));

    callback_ctx();
    let id = c.on_key_checked(signer, scheduled, Ok(true));
    let stored = c.get_jar(id).unwrap();
    assert_eq!(stored.payout, Some(dao()));
    assert_eq!(stored.input.slug.as_deref(), Some("cats-fund"));
}

fn with_slug(mut action: serde_json::Value, slug: &str) -> serde_json::Value {
    action["jar"]["slug"] = slug.into();
    action
}

#[test]
fn short_link_resolves_on_chain() {
    let mut c = setup();
    let owner = Ed::new(1);
    let id = apply(
        &mut c,
        &owner,
        1,
        with_slug(create_action("Cats"), "ana-film"),
    );
    let jar = c.get_jar_by_slug("ana-film".into()).unwrap();
    assert_eq!(jar.id, id);
    assert_eq!(jar.input.slug.as_deref(), Some("ana-film"));
    assert!(c.get_jar_by_slug("nobody-has-this".into()).is_none());

    // a jar without a link claims nothing
    let other = apply(&mut c, &owner, 2, create_action("Dogs"));
    assert_eq!(c.get_jar(other).unwrap().input.slug, None);
}

#[test]
fn short_link_is_first_come() {
    let mut c = setup();
    let ana = Ed::new(1);
    apply(&mut c, &ana, 1, with_slug(create_action("Ana"), "ana-film"));

    // someone else can't take it, at submit or by racing to the callback
    let mallory = Ed::new(2);
    let take = with_slug(create_action("Ana (copy)"), "ana-film");
    let payload = envelope(&mallory.account(), 1, NOW + 5 * MIN, take.clone());
    ctx(relayer());
    assert_panics("short link taken", || {
        let _ = c.submit(mallory.sign(&payload));
    });
    callback_ctx();
    assert_panics("short link taken", || {
        c.on_key_checked(
            mallory.account().parse().unwrap(),
            serde_json::from_value(take).unwrap(),
            Ok(true),
        );
    });

    // nor by renaming one of their own jars to it
    let theirs = apply(&mut c, &mallory, 2, create_action("Mallory"));
    let payload = envelope(
        &mallory.account(),
        3,
        NOW + 5 * MIN,
        update_action(
            theirs,
            with_slug(create_action("x"), "ana-film")["jar"].clone(),
        ),
    );
    ctx(relayer());
    assert_panics("short link taken", || {
        let _ = c.submit(mallory.sign(&payload));
    });
    assert_eq!(
        c.get_jar_by_slug("ana-film".into()).unwrap().input.title,
        "Ana"
    );
}

#[test]
fn renamed_link_keeps_pointing_at_its_jar() {
    let mut c = setup();
    let ana = Ed::new(1);
    let id = apply(&mut c, &ana, 1, with_slug(create_action("Ana"), "ana-film"));
    let renamed = with_slug(create_action("Ana"), "ana-film-2026")["jar"].clone();
    apply(&mut c, &ana, 2, update_action(id, renamed));

    // the new link is the jar's; the old one still leads to it, so links already shared can't
    // be picked up by someone else
    assert_eq!(
        c.get_jar(id).unwrap().input.slug.as_deref(),
        Some("ana-film-2026")
    );
    assert_eq!(c.get_jar_by_slug("ana-film".into()).unwrap().id, id);
    assert_eq!(c.get_jar_by_slug("ana-film-2026".into()).unwrap().id, id);
    let mallory = Ed::new(2);
    let payload = envelope(
        &mallory.account(),
        1,
        NOW + 5 * MIN,
        with_slug(create_action("Ana"), "ana-film"),
    );
    ctx(relayer());
    assert_panics("short link taken", || {
        let _ = c.submit(mallory.sign(&payload));
    });

    // the jar may go back to its old link, or drop the link (old links still find it)
    let back = with_slug(create_action("Ana"), "ana-film")["jar"].clone();
    apply(&mut c, &ana, 3, update_action(id, back));
    assert_eq!(
        c.get_jar(id).unwrap().input.slug.as_deref(),
        Some("ana-film")
    );
    apply(&mut c, &ana, 4, update_action(id, jar_input("Ana")));
    assert_eq!(c.get_jar(id).unwrap().input.slug, None);
    assert_eq!(c.get_jar_by_slug("ana-film".into()).unwrap().id, id);

    // a closed jar keeps its links too
    apply(
        &mut c,
        &ana,
        5,
        serde_json::json!({ "action": "close_jar", "jar_id": id }),
    );
    assert_eq!(
        c.get_jar_by_slug("ana-film".into()).unwrap().status,
        JarStatus::Closed
    );
}

#[test]
fn short_link_spelling() {
    for good in [
        "abc",
        "ana-film",
        "a1b",
        "2026-fund",
        "x-1",
        &"a".repeat(40),
    ] {
        assert!(is_slug(good), "{good}");
    }
    for bad in [
        "ab",
        "-ana",
        "ana-",
        "Ana",
        "123",
        "12-34",
        "a_b",
        "a b",
        "ána",
        "a.b",
        &"a".repeat(41),
        "",
    ] {
        assert!(!is_slug(bad), "{bad:?}");
    }
    let mut c = setup();
    let owner = Ed::new(1);
    let payload = envelope(
        &owner.account(),
        1,
        NOW + 5 * MIN,
        with_slug(create_action("Cats"), "Ana-Film"),
    );
    ctx(relayer());
    assert_panics("bad slug", || {
        let _ = c.submit(owner.sign(&payload));
    });
}

#[test]
fn upgrade_guard_refuses_once_a_jar_exists() {
    let mut c = setup();
    // the deploy transaction is signed by the contract account itself (`#[private]` is
    // enforced by the wasm export, which unit tests bypass)
    ctx(contract_id());
    c.assert_no_jars();

    let owner = Ed::new(1);
    apply(&mut c, &owner, 1, create_action("Cats"));
    ctx(contract_id());
    assert_panics("jars exist", || c.assert_no_jars());
}

#[test]
fn config_reports_the_code_version() {
    let c = setup();
    let config = serde_json::to_value(c.get_config()).unwrap();
    assert_eq!(config["version"], env!("CARGO_PKG_VERSION"));
    assert_eq!(config["jars_count"], "0");
}

#[test]
fn next_owner_slot_is_the_first_free_one() {
    let mut c = setup();
    let owner: AccountId = "owner.near".parse().unwrap();
    let mut filled = 0u32;
    for n in [0u32, 1, 2, 3, 4, 5, 7, 8, 9, 63, 64, 65, 300, 1000, 1025] {
        while filled < n {
            c.owner_jars
                .insert((owner.clone(), filled), u64::from(filled));
            filled += 1;
        }
        assert_eq!(c.next_owner_slot(&owner), n);
    }
    // another owner's slots don't count
    assert_eq!(c.next_owner_slot(&"other.near".parse().unwrap()), 0);
}

#[test]
fn many_jars_per_owner_keep_their_order() {
    let mut c = setup();
    let owner = Ed::new(1);
    let mut ids = Vec::new();
    for nonce in 0..40u8 {
        let id = apply(&mut c, &owner, nonce * 2 + 1, create_action("Cats"));
        apply(
            &mut c,
            &owner,
            nonce * 2 + 2,
            serde_json::json!({ "action": "close_jar", "jar_id": id }),
        );
        ids.push(id);
    }
    let listed: Vec<U64> = c
        .get_jars_by_owner(owner.account().parse().unwrap())
        .into_iter()
        .map(|j| j.id)
        .collect();
    assert_eq!(listed, ids);
}
