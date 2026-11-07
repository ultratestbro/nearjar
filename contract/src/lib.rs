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
//!
//! A jar may pay out to a Sputnik DAO treasury (`<name>.sputnik-dao.near`) instead of the owner's
//! near.com account. The owner signs the DAO at creation and it never changes; the DAO itself can
//! endorse the jar or close it (`endorse_jar`, `dao_close_jar`) through a FunctionCall proposal.
//! Every owner edit clears the endorsement, so it always covers what the jar shows now.
//!
//! The jar's short link and the fingerprint of its web page are signed and stored here too: the
//! link resolves on chain (`get_jar_by_slug`) and a page kept off chain can be checked against
//! the fingerprint, so nobody holding the web app's database can point a link at another jar or
//! change a page under it.

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
pub const MIN_SLUG: usize = 3;
pub const MAX_SLUG: usize = 40;
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
    /// Short link → jar id (see [`slugs`]). Appended last, so every older prefix stays the same.
    Slugs,
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
    /// The jar's short link (`/j/<slug>`), unique across jars. A link once claimed keeps pointing
    /// at its jar, also after the jar moves to another one, so shared links never change hands.
    pub slug: Option<String>,
    /// `sha256:<hex>` of the jar's web page (cover, milestones, links…), which is kept off chain
    /// and checked against this.
    pub page: Option<String>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Jar {
    pub id: U64,
    /// The near.com (intents.near) account that created the jar and signs its actions.
    /// Donations are delivered here unless `payout` is set.
    pub owner: AccountId,
    /// Sputnik DAO treasury that receives the donations instead of `owner`. Fixed at creation.
    pub payout: Option<AccountId>,
    /// The payout DAO confirmed the jar (`endorse_jar`). Every owner edit clears it, so it covers
    /// what the jar shows now. Never set on a jar without `payout`.
    pub endorsed: bool,
    /// Counts the owner's edits (0 at creation). `endorse_jar` can pin the revision the DAO voted on.
    pub revision: U64,
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
    /// Sputnik DAO that receives the donations instead of the signer, e.g.
    /// `shitzu.sputnik-dao.near`. Omitted: the signer's near.com account. Chosen at creation;
    /// every update must carry the same value.
    #[serde(default)]
    pub payout: Option<AccountId>,
    /// Short link, 3–40 of `a-z 0-9 -` with a letter, no dash at either end.
    #[serde(default)]
    pub slug: Option<String>,
    /// Fingerprint of the web page: `sha256:` and 64 lowercase hex digits.
    #[serde(default)]
    pub page: Option<String>,
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
    /// Hash of the intents.near transaction that credited the jar's payout account.
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
    /// Crate version of the deployed code; absent from builds before DAO payouts.
    pub version: String,
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
            JarAction::CreateJar { jar } => self.create_jar(signer_id, jar_input(&jar), jar.payout),
            JarAction::UpdateJar { jar_id, jar } => {
                let mut stored = self.jars.get(&jar_id.0).cloned().unwrap();
                stored.input = jar_input(&jar);
                // the DAO endorsed what the jar showed then, not this edit
                stored.endorsed = false;
                stored.revision = U64(stored.revision.0 + 1);
                if let Some(slug) = &stored.input.slug {
                    claim_slug(slug, jar_id.0);
                }
                let revision = stored.revision;
                self.jars.insert(jar_id.0, stored);
                emit(
                    "jar_updated",
                    &serde_json::json!({ "jar_id": jar_id, "revision": revision }),
                );
                jar_id
            }
            JarAction::CloseJar { jar_id } => self.close_jar(jar_id, "owner"),
        }
    }

    // ---------- payout DAO (the DAO calls through an approved FunctionCall proposal) ----------

    /// The DAO confirms it accepts this jar's donations. No deposit. With `revision` the call
    /// fails if the owner edited the jar after the proposal was filed, so the DAO endorses
    /// exactly the version its members voted on.
    pub fn endorse_jar(&mut self, jar_id: U64, revision: Option<U64>) {
        let mut jar = self.assert_payout_dao_open(jar_id).clone();
        if let Some(r) = revision {
            require!(
                r == jar.revision,
                "the jar changed since this proposal: endorse its current revision"
            );
        }
        jar.endorsed = true;
        let revision = jar.revision;
        self.jars.insert(jar_id.0, jar);
        emit(
            "jar_endorsed",
            &serde_json::json!({
                "jar_id": jar_id,
                "dao": env::predecessor_account_id(),
                "revision": revision,
            }),
        );
    }

    /// The DAO's stop button: closes the jar exactly as the owner's `close_jar` does. No deposit.
    pub fn dao_close_jar(&mut self, jar_id: U64) {
        self.assert_payout_dao_open(jar_id);
        self.close_jar(jar_id, "dao");
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

    // ---------- upgrades ----------

    /// Guard for a code upgrade that changes the stored `Jar` layout: send it in the same
    /// transaction right after `DeployContract`, so the deploy reverts if any jar exists.
    #[private]
    pub fn assert_no_jars(&self) {
        require!(
            self.jars_count == 0,
            "jars exist: this upgrade needs a migration"
        );
    }

    // ---------- views ----------

    pub fn get_config(&self) -> Config {
        Config {
            owner_id: self.owner_id.clone(),
            intents_id: self.intents_id.clone(),
            relayers: self.relayers.iter().cloned().collect(),
            assets: self.assets.iter().cloned().collect(),
            jars_count: U64(self.jars_count),
            version: env!("CARGO_PKG_VERSION").to_string(),
        }
    }

    pub fn get_jar(&self, jar_id: U64) -> Option<Jar> {
        self.jars.get(&jar_id.0).cloned()
    }

    /// The jar a short link points at, including links it used before.
    pub fn get_jar_by_slug(&self, slug: String) -> Option<Jar> {
        let id = slugs().get(&slug).copied()?;
        self.jars.get(&id).cloned()
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
                if let Some(dao) = &jar.payout {
                    require!(
                        is_sputnik_dao(dao),
                        "payout must be a Sputnik DAO: <name>.sputnik-dao.near"
                    );
                }
                if let Some(slug) = &jar.slug {
                    require!(slugs().get(slug).is_none(), "short link taken");
                }
                let open = self.owner_jar_count.get(signer_id).copied().unwrap_or(0);
                require!(open < MAX_OPEN_JARS_PER_OWNER, "too many open jars");
            }
            JarAction::UpdateJar { jar_id, jar } => {
                self.validate_input(&jar_input(jar));
                let stored = self.assert_jar_owner_open(*jar_id, signer_id);
                // Otherwise the creator could take a DAO jar's total and link for themselves, or
                // point a plain jar at some DAO.
                require!(
                    jar.payout == stored.payout,
                    "payout cannot change: sign the jar's current payout"
                );
                if let Some(slug) = &jar.slug {
                    require!(
                        slugs().get(slug).is_none_or(|id| *id == jar_id.0),
                        "short link taken"
                    );
                }
            }
            JarAction::CloseJar { jar_id } => {
                self.assert_jar_owner_open(*jar_id, signer_id);
            }
        }
    }

    fn assert_jar_owner_open(&self, jar_id: U64, signer_id: &AccountId) -> &Jar {
        let jar = self.get_open_jar(jar_id);
        require!(&jar.owner == signer_id, "not the jar owner");
        jar
    }

    /// The caller is the jar's payout DAO, i.e. this runs from one of its executed proposals.
    fn assert_payout_dao_open(&self, jar_id: U64) -> &Jar {
        let jar = self.get_open_jar(jar_id);
        require!(
            jar.payout.as_ref() == Some(&env::predecessor_account_id()),
            "only the jar's payout DAO"
        );
        jar
    }

    fn get_open_jar(&self, jar_id: U64) -> &Jar {
        let jar = self
            .jars
            .get(&jar_id.0)
            .unwrap_or_else(|| env::panic_str("no such jar"));
        require!(jar.status == JarStatus::Open, "jar is closed");
        jar
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
        if let Some(slug) = &jar.slug {
            require!(
                is_slug(slug),
                "bad slug: 3-40 of a-z, 0-9 and -, with a letter"
            );
        }
        if let Some(page) = &jar.page {
            require!(
                is_page_fingerprint(page),
                "page must be sha256:<64 lowercase hex>"
            );
        }
        require!(
            self.assets.contains(&jar.receive_asset),
            "receive_asset not supported"
        );
    }

    fn create_jar(&mut self, owner: AccountId, input: JarInput, payout: Option<AccountId>) -> U64 {
        let id = self.jars_count;
        self.jars_count += 1;
        if let Some(slug) = &input.slug {
            claim_slug(slug, id);
        }
        let jar = Jar {
            id: U64(id),
            owner: owner.clone(),
            payout,
            endorsed: false,
            revision: U64(0),
            input,
            status: JarStatus::Open,
            created_at: U64(env::block_timestamp()),
            raised_usd_cents: U64(0),
            donations_count: U64(0),
        };
        emit("jar_created", &jar);
        self.jars.insert(id, jar);

        // per-owner index: append at the first free slot
        let slot = self.next_owner_slot(&owner);
        self.owner_jars.insert((owner.clone(), slot), id);
        let open = self.owner_jar_count.get(&owner).copied().unwrap_or(0);
        self.owner_jar_count.insert(owner, open + 1);
        U64(id)
    }

    /// An owner's slots are filled from 0 and never freed (a closed jar keeps its slot), so the
    /// first free one is found by doubling, then bisecting: a few reads however many jars the
    /// owner made, where a linear scan would run out of callback gas after a few hundred.
    fn next_owner_slot(&self, owner: &AccountId) -> u32 {
        let taken = |slot: u32| self.owner_jars.contains_key(&(owner.clone(), slot));
        if !taken(0) {
            return 0;
        }
        // invariant: `lo` is taken, `hi` is free
        let (mut lo, mut hi) = (0u32, 1u32);
        while taken(hi) {
            lo = hi;
            hi = hi
                .checked_mul(2)
                .unwrap_or_else(|| env::panic_str("too many jars"));
        }
        while hi - lo > 1 {
            let mid = lo + (hi - lo) / 2;
            if taken(mid) {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        hi
    }

    /// The jar is known to be open (checked by the caller).
    fn close_jar(&mut self, jar_id: U64, by: &str) -> U64 {
        let mut jar = self.jars.get(&jar_id.0).cloned().unwrap();
        jar.status = JarStatus::Closed;
        let owner = jar.owner.clone();
        self.jars.insert(jar_id.0, jar);
        let n = self.owner_jar_count.get(&owner).copied().unwrap_or(0);
        // closed jars stop counting towards the owner's open-jar limit
        self.owner_jar_count.insert(owner, n.saturating_sub(1));
        emit(
            "jar_closed",
            &serde_json::json!({ "jar_id": jar_id, "by": by }),
        );
        jar_id
    }
}

/// `<name>.sputnik-dao.near` with a one-label name. Only `sputnik-dao.near` can create its
/// sub-accounts (protocol rule) and it creates nothing but DAOs, so the suffix proves a Sputnik DAO.
/// The id itself is already valid: `AccountId` parsing rejects uppercase and bad characters.
pub fn is_sputnik_dao(id: &AccountId) -> bool {
    id.as_str()
        .strip_suffix(".sputnik-dao.near")
        .is_some_and(|name| !name.is_empty() && !name.contains('.'))
}

/// The web app's short-link rule: 3–40 of `a-z 0-9 -`, a letter somewhere (so a link never looks
/// like a jar id), no dash at either end.
pub fn is_slug(s: &str) -> bool {
    let b = s.as_bytes();
    (MIN_SLUG..=MAX_SLUG).contains(&b.len())
        && b.iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
        && b.iter().any(u8::is_ascii_lowercase)
        && b[0] != b'-'
        && b[b.len() - 1] != b'-'
}

pub fn is_page_fingerprint(s: &str) -> bool {
    s.strip_prefix("sha256:").is_some_and(|hex| {
        hex.len() == 64
            && hex
                .bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    })
}

/// Short link → jar id. Under its own storage prefix and opened where it is used, not a field of
/// [`NearJar`]: the deployed root state stays byte-for-byte the same. Writes are flushed on drop.
fn slugs() -> LookupMap<String, u64> {
    LookupMap::new(StorageKey::Slugs)
}

/// Points `slug` at `jar_id`; the caller checked it is free or already this jar's.
fn claim_slug(slug: &str, jar_id: u64) {
    slugs().insert(slug.to_string(), jar_id);
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
        slug: jar.slug.clone(),
        page: jar.page.clone(),
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

/// NEP-297 event log.
fn emit<T: serde::Serialize>(event: &str, data: &T) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        serde_json::json!({
            "standard": "nearjar",
            // 1.1.0: jars carry payout, endorsed, revision, slug and page; jar_closed says `by`
            "version": "1.1.0",
            "event": event,
            "data": [data],
        })
    ));
}
