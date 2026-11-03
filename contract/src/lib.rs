//! NearJar: donation jars that pay out into near.com accounts.
//!
//! A near.com account is an account inside `intents.near`. The jar owner proves control of it by
//! signing a NearJar action in the same envelope intents.near accepts (`MultiPayload`: ERC-191,
//! raw Ed25519, NEP-413, TonConnect, TIP-191, SEP-53, WebAuthn). This contract verifies the
//! signature with the intents.near code, then asks intents.near whether the recovered public key
//! is currently registered for the signer (`has_public_key`). Only then the action is applied.
//!
//! The relayer submits signed actions and pays gas; it cannot forge them. It also records
//! delivered donations, which the contract cannot verify on its own (they settle on other chains
//! or inside intents.near), so every receipt carries the delivery tx hash for anyone to check.

#[cfg(test)]
mod tests;

use defuse_core::{
    Nonce, PublicKey, Timestamp,
    payload::{ExtractDefusePayload, SignedPayload, multi::MultiPayload},
};
use near_sdk::{
    AccountId, BorshStorageKey, Gas, PanicOnDefault, Promise, PromiseError, env, ext_contract,
    json_types::{U64, U128},
    near, require,
    store::{IterableSet, LookupMap, LookupSet},
};

pub const MAX_TITLE: usize = 80;
pub const MAX_DESCRIPTION: usize = 1000;
pub const MAX_URL: usize = 300;
pub const MAX_OPEN_JARS_PER_OWNER: u32 = 20;
pub const MAX_SOURCE_ID: usize = 128;
pub const MAX_TX_HASH: usize = 128;
/// A signed action must not be valid for longer than this.
pub const MAX_DEADLINE_NS: u64 = 60 * 60 * 1_000_000_000;

/// Receive assets by the symbol owners sign, as intents.near token ids.
pub const RECEIVE_SYMBOLS: [(&str, &str); 5] = [
    (
        "USDC",
        "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    ),
    ("USDT", "nep141:usdt.tether-token.near"),
    ("NEAR", "nep141:wrap.near"),
    ("BTC", "nep141:btc.omft.near"),
    ("ETH", "nep141:eth.omft.near"),
];

const GAS_HAS_PUBLIC_KEY: Gas = Gas::from_tgas(10);
const GAS_ON_KEY_CHECKED: Gas = Gas::from_tgas(30);

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Relayers,
    Assets,
    Jars,
    OwnerJarCount,
    OwnerJars,
    UsedNonces,
    Donations,
    DonationSources,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum JarStatus {
    Open,
    Closed,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DonationMethod {
    /// Donor connected a wallet; delivered through the 1Click API.
    Wallet,
    /// Donor sent to a one-time 1Click deposit address.
    Manual,
    /// Donor signed a transfer from their own near.com balance.
    NearCom,
}

/// Editable jar fields, as signed by the owner.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JarInput {
    pub title: String,
    pub description: String,
    pub image_url: Option<String>,
    pub goal_usd_cents: Option<U64>,
    /// Unix nanoseconds.
    pub ends_at: Option<U64>,
    /// intents.near token id the owner receives, e.g. `nep141:17208628…a1` (USDC).
    pub receive_asset: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Jar {
    pub id: U64,
    /// The near.com (intents.near) account donations are delivered to.
    pub owner: AccountId,
    #[serde(flatten)]
    pub input: JarInput,
    pub status: JarStatus,
    pub created_at: U64,
    pub raised_usd_cents: U64,
    pub donations_count: U64,
}

/// Jar fields as the owner signs them, written so a wallet shows them readably:
/// `"goal": "$1,500"`, `"receive": "USDC"`. Converted to [`JarInput`] for storage.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SignedJar {
    pub title: String,
    #[serde(default)]
    pub description: String,
    /// Dollars in canonical form: `$1,500` or `$1,500.50`. Omitted: no goal.
    #[serde(default)]
    pub goal: Option<String>,
    /// Symbol of the asset the owner receives, see [`RECEIVE_SYMBOLS`].
    pub receive: String,
    #[serde(default)]
    pub image_url: Option<String>,
    /// Unix nanoseconds.
    #[serde(default)]
    pub ends_at: Option<U64>,
}

/// What the owner signs. Serialized flat next to the intents.near envelope fields
/// (`signer_id`, `verifying_contract`, `deadline`, `nonce`).
#[near(serializers = [json])]
#[serde(tag = "action", rename_all = "snake_case")]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum JarAction {
    CreateJar { jar: SignedJar },
    UpdateJar { jar_id: U64, jar: SignedJar },
    CloseJar { jar_id: U64 },
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DonationInput {
    /// Unique per donation: the 1Click deposit address (+ memo) or the intents.near transfer
    /// intent hash. Recording the same source twice is rejected.
    pub source_id: String,
    pub method: DonationMethod,
    pub usd_cents: U64,
    /// intents.near token id actually delivered.
    pub asset: String,
    pub amount: U128,
    /// Hash of the intents.near transaction that credited the jar owner.
    pub delivery_tx: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Donation {
    pub jar_id: U64,
    pub index: U64,
    #[serde(flatten)]
    pub input: DonationInput,
    pub recorded_at: U64,
}

#[near(serializers = [json])]
pub struct Config {
    pub owner_id: AccountId,
    pub intents_id: AccountId,
    pub relayers: Vec<AccountId>,
    pub assets: Vec<String>,
    pub jars_count: U64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct NearJar {
    owner_id: AccountId,
    intents_id: AccountId,
    relayers: IterableSet<AccountId>,
    assets: IterableSet<String>,
    jars: LookupMap<u64, Jar>,
    jars_count: u64,
    owner_jar_count: LookupMap<AccountId, u32>,
    owner_jars: LookupMap<(AccountId, u32), u64>,
    used_nonces: LookupSet<[u8; 32]>,
    donations: LookupMap<(u64, u64), Donation>,
    donation_sources: LookupSet<String>,
}

#[ext_contract(ext_intents)]
pub trait IntentsAccounts {
    fn has_public_key(&self, account_id: AccountId, public_key: PublicKey) -> bool;
}

#[near]
impl NearJar {
    #[init]
    pub fn new(owner_id: AccountId, intents_id: AccountId, assets: Vec<String>) -> Self {
        let mut this = Self {
            owner_id,
            intents_id,
            relayers: IterableSet::new(StorageKey::Relayers),
            assets: IterableSet::new(StorageKey::Assets),
            jars: LookupMap::new(StorageKey::Jars),
            jars_count: 0,
            owner_jar_count: LookupMap::new(StorageKey::OwnerJarCount),
            owner_jars: LookupMap::new(StorageKey::OwnerJars),
            used_nonces: LookupSet::new(StorageKey::UsedNonces),
            donations: LookupMap::new(StorageKey::Donations),
            donation_sources: LookupSet::new(StorageKey::DonationSources),
        };
        for a in assets {
            this.assets.insert(a);
        }
        this
    }

    // ---------- admin ----------

    pub fn add_relayer(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.relayers.insert(account_id);
    }

    pub fn remove_relayer(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.relayers.remove(&account_id);
    }

    pub fn add_asset(&mut self, asset: String) {
        self.assert_owner();
        self.assets.insert(asset);
    }

    pub fn remove_asset(&mut self, asset: String) {
        self.assert_owner();
        self.assets.remove(&asset);
    }

    // ---------- signed jar actions (relayer submits, owner signs) ----------

    /// Verifies the signature, consumes the nonce, then checks with intents.near that the key
    /// belongs to the signer. The action is applied in `on_key_checked`.
    pub fn submit(&mut self, signed: MultiPayload) -> Promise {
        self.assert_relayer();

        let public_key = signed
            .verify()
            .unwrap_or_else(|| env::panic_str("invalid signature"));
        let payload = ExtractDefusePayload::<JarAction>::extract_defuse_payload(signed)
            .unwrap_or_else(|e| env::panic_str(&format!("invalid payload: {e}")));

        require!(
            payload.verifying_contract == env::current_account_id(),
            "wrong verifying_contract"
        );
        let now = env::block_timestamp();
        let deadline = timestamp_ns(payload.deadline);
        require!(deadline > now, "deadline expired");
        require!(deadline - now <= MAX_DEADLINE_NS, "deadline too far");

        let nonce_key = nonce_key(&payload.signer_id, &payload.nonce);
        require!(self.used_nonces.insert(nonce_key), "nonce already used");

        // Cheap checks before paying for the cross-contract call.
        self.precheck(&payload.signer_id, &payload.message);

        ext_intents::ext(self.intents_id.clone())
            .with_static_gas(GAS_HAS_PUBLIC_KEY)
            .has_public_key(payload.signer_id.clone(), public_key)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_ON_KEY_CHECKED)
                    .on_key_checked(payload.signer_id, payload.message),
            )
    }

    #[private]
    pub fn on_key_checked(
        &mut self,
        signer_id: AccountId,
        action: JarAction,
        #[callback_result] key_ok: Result<bool, PromiseError>,
    ) -> U64 {
        require!(
            matches!(key_ok, Ok(true)),
            "public key is not registered for the signer in intents.near"
        );
        // State may have changed between submit and callback: check again.
        self.precheck(&signer_id, &action);

        match action {
            JarAction::CreateJar { jar } => self.create_jar(signer_id, jar_input(&jar)),
            JarAction::UpdateJar { jar_id, jar } => {
                let mut stored = self.jars.get(&jar_id.0).cloned().unwrap();
                stored.input = jar_input(&jar);
                self.jars.insert(jar_id.0, stored);
                emit("jar_updated", &serde_json::json!({ "jar_id": jar_id }));
                jar_id
            }
            JarAction::CloseJar { jar_id } => {
                let mut stored = self.jars.get(&jar_id.0).cloned().unwrap();
                stored.status = JarStatus::Closed;
                self.jars.insert(jar_id.0, stored);
                let n = self.owner_jar_count.get(&signer_id).copied().unwrap_or(0);
                // closed jars stop counting towards the open-jar limit
                self.owner_jar_count.insert(signer_id, n.saturating_sub(1));
                emit("jar_closed", &serde_json::json!({ "jar_id": jar_id }));
                jar_id
            }
        }
    }

    // ---------- donations (relayer) ----------

    pub fn record_donation(&mut self, jar_id: U64, donation: DonationInput) -> U64 {
        self.assert_relayer();
        require!(
            !donation.source_id.is_empty() && donation.source_id.len() <= MAX_SOURCE_ID,
            "bad source_id"
        );
        require!(
            !donation.delivery_tx.is_empty() && donation.delivery_tx.len() <= MAX_TX_HASH,
            "bad delivery_tx"
        );
        require!(donation.asset.len() <= MAX_URL, "bad asset");
        // Donations in flight when a jar closes are still recorded.
        let mut jar = self
            .jars
            .get(&jar_id.0)
            .cloned()
            .unwrap_or_else(|| env::panic_str("no such jar"));
        require!(
            self.donation_sources.insert(donation.source_id.clone()),
            "donation already recorded"
        );

        let index = jar.donations_count.0;
        jar.donations_count = U64(index + 1);
        jar.raised_usd_cents = U64(jar
            .raised_usd_cents
            .0
            .checked_add(donation.usd_cents.0)
            .unwrap_or_else(|| env::panic_str("overflow")));
        let record = Donation {
            jar_id,
            index: U64(index),
            input: donation,
            recorded_at: U64(env::block_timestamp()),
        };
        emit("donation_recorded", &record);
        self.donations.insert((jar_id.0, index), record);
        self.jars.insert(jar_id.0, jar);
        U64(index)
    }

    // ---------- views ----------

    pub fn get_config(&self) -> Config {
        Config {
            owner_id: self.owner_id.clone(),
            intents_id: self.intents_id.clone(),
            relayers: self.relayers.iter().cloned().collect(),
            assets: self.assets.iter().cloned().collect(),
            jars_count: U64(self.jars_count),
        }
    }

    pub fn get_jar(&self, jar_id: U64) -> Option<Jar> {
        self.jars.get(&jar_id.0).cloned()
    }

    /// Ids are sequential from 0.
    pub fn get_jars(&self, from: U64, limit: u32) -> Vec<Jar> {
        let end = self
            .jars_count
            .min(from.0.saturating_add(u64::from(limit.min(100))));
        (from.0..end)
            .filter_map(|i| self.jars.get(&i).cloned())
            .collect()
    }

    pub fn get_jars_by_owner(&self, owner: AccountId) -> Vec<Jar> {
        let mut out = Vec::new();
        let mut slot = 0u32;
        while let Some(id) = self.owner_jars.get(&(owner.clone(), slot)) {
            if let Some(j) = self.jars.get(id) {
                out.push(j.clone());
            }
            slot += 1;
        }
        out
    }

    pub fn get_donations(&self, jar_id: U64, from: U64, limit: u32) -> Vec<Donation> {
        let Some(jar) = self.jars.get(&jar_id.0) else {
            return Vec::new();
        };
        let end = jar
            .donations_count
            .0
            .min(from.0.saturating_add(u64::from(limit.min(100))));
        (from.0..end)
            .filter_map(|i| self.donations.get(&(jar_id.0, i)).cloned())
            .collect()
    }

    pub fn is_nonce_used(&self, signer_id: AccountId, nonce: String) -> bool {
        let bytes = near_sdk::base64::Engine::decode(
            &near_sdk::base64::engine::general_purpose::STANDARD,
            nonce,
        )
        .ok()
        .and_then(|b| <[u8; 32]>::try_from(b).ok())
        .unwrap_or_else(|| env::panic_str("nonce must be 32 bytes base64"));
        self.used_nonces.contains(&nonce_key(&signer_id, &bytes))
    }
}

impl NearJar {
    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner_id, "owner only");
    }

    fn assert_relayer(&self) {
        require!(
            self.relayers.contains(&env::predecessor_account_id()),
            "relayer only"
        );
    }

    fn precheck(&self, signer_id: &AccountId, action: &JarAction) {
        match action {
            JarAction::CreateJar { jar } => {
                self.validate_input(&jar_input(jar));
                let open = self.owner_jar_count.get(signer_id).copied().unwrap_or(0);
                require!(open < MAX_OPEN_JARS_PER_OWNER, "too many open jars");
            }
            JarAction::UpdateJar { jar_id, jar } => {
                self.validate_input(&jar_input(jar));
                self.assert_jar_owner_open(*jar_id, signer_id);
            }
            JarAction::CloseJar { jar_id } => self.assert_jar_owner_open(*jar_id, signer_id),
        }
    }

    fn assert_jar_owner_open(&self, jar_id: U64, signer_id: &AccountId) {
        let jar = self
            .jars
            .get(&jar_id.0)
            .unwrap_or_else(|| env::panic_str("no such jar"));
        require!(&jar.owner == signer_id, "not the jar owner");
        require!(jar.status == JarStatus::Open, "jar is closed");
    }

    fn validate_input(&self, jar: &JarInput) {
        let title = jar.title.trim();
        require!(
            !title.is_empty() && title.chars().count() <= MAX_TITLE,
            "bad title"
        );
        require!(
            jar.description.chars().count() <= MAX_DESCRIPTION,
            "description too long"
        );
        if let Some(url) = &jar.image_url {
            require!(
                url.len() <= MAX_URL && url.starts_with("https://"),
                "image_url must be https"
            );
        }
        if let Some(goal) = jar.goal_usd_cents {
            require!(goal.0 > 0, "goal must be positive");
        }
        if let Some(ends_at) = jar.ends_at {
            require!(ends_at.0 > env::block_timestamp(), "ends_at in the past");
        }
        require!(
            self.assets.contains(&jar.receive_asset),
            "receive_asset not supported"
        );
    }

    fn create_jar(&mut self, owner: AccountId, input: JarInput) -> U64 {
        let id = self.jars_count;
        self.jars_count += 1;
        let jar = Jar {
            id: U64(id),
            owner: owner.clone(),
            input,
            status: JarStatus::Open,
            created_at: U64(env::block_timestamp()),
            raised_usd_cents: U64(0),
            donations_count: U64(0),
        };
        emit("jar_created", &jar);
        self.jars.insert(id, jar);

        // per-owner index: append at the first free slot
        let mut slot = 0u32;
        while self.owner_jars.contains_key(&(owner.clone(), slot)) {
            slot += 1;
        }
        self.owner_jars.insert((owner.clone(), slot), id);
        let open = self.owner_jar_count.get(&owner).copied().unwrap_or(0);
        self.owner_jar_count.insert(owner, open + 1);
        U64(id)
    }
}

fn nonce_key(signer_id: &AccountId, nonce: &Nonce) -> [u8; 32] {
    let mut buf = Vec::with_capacity(signer_id.len() + 1 + 32);
    buf.extend_from_slice(signer_id.as_bytes());
    buf.push(0);
    buf.extend_from_slice(nonce);
    env::sha256_array(&buf)
}

fn timestamp_ns(ts: Timestamp) -> u64 {
    u64::try_from(ts.as_nanos()).unwrap_or(0)
}

/// NEP-297 event log.
/// Signed jar fields → stored fields. Panics on a goal that is not in canonical form or an
/// unknown receive symbol, so the wallet text and the stored jar always say the same thing.
fn jar_input(jar: &SignedJar) -> JarInput {
    let goal_usd_cents = jar.goal.as_deref().map(|g| {
        U64(parse_usd_cents(g).unwrap_or_else(|| env::panic_str("bad goal, expected e.g. $1,500")))
    });
    let receive_asset = RECEIVE_SYMBOLS
        .iter()
        .find(|(symbol, _)| *symbol == jar.receive)
        .map(|(_, id)| id.to_string())
        .unwrap_or_else(|| env::panic_str("receive_asset not supported"));
    JarInput {
        title: jar.title.clone(),
        description: jar.description.clone(),
        image_url: jar.image_url.clone(),
        goal_usd_cents,
        ends_at: jar.ends_at,
        receive_asset,
    }
}

/// `$1,500` → 150000, `$1,500.50` → 150050. Only the canonical spelling is accepted: comma
/// thousands, no leading zeros, cents either absent or exactly two digits.
pub fn parse_usd_cents(s: &str) -> Option<u64> {
    let s = s.strip_prefix('$')?;
    let (whole, cents) = match s.split_once('.') {
        Some((w, c)) if c.len() == 2 && c.bytes().all(|b| b.is_ascii_digit()) => {
            (w, c.parse::<u64>().ok()?)
        }
        Some(_) => return None,
        None => (s, 0),
    };
    let mut groups = whole.split(',');
    let first = groups.next()?;
    if first.is_empty() || first.len() > 3 || !first.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    if first.starts_with('0') && (first.len() > 1 || whole.contains(',')) {
        return None;
    }
    let mut dollars: u64 = first.parse().ok()?;
    for g in groups {
        if g.len() != 3 || !g.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        dollars = dollars.checked_mul(1000)?.checked_add(g.parse().ok()?)?;
    }
    dollars.checked_mul(100)?.checked_add(cents)
}

fn emit<T: serde::Serialize>(event: &str, data: &T) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        serde_json::json!({
            "standard": "nearjar",
            "version": "1.0.0",
            "event": event,
            "data": [data],
        })
    ));
}
