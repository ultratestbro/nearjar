//! Testnet stand-in for the account-key part of intents.near, which has no testnet deployment.
//! Same rules as intents.near for what NearJar asks: an implicit account's own key counts until
//! removed, and an account can add or remove keys for itself.

use defuse_core::PublicKey;
use near_sdk::{AccountId, BorshStorageKey, PanicOnDefault, env, near, store::LookupSet};

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Keys,
    Removed,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct IntentsStub {
    keys: LookupSet<(AccountId, PublicKey)>,
    removed_implicit: LookupSet<AccountId>,
}

#[near]
impl IntentsStub {
    #[init]
    pub fn new() -> Self {
        Self {
            keys: LookupSet::new(StorageKey::Keys),
            removed_implicit: LookupSet::new(StorageKey::Removed),
        }
    }

    pub fn has_public_key(&self, account_id: AccountId, public_key: PublicKey) -> bool {
        let implicit = public_key.to_implicit_account_id().as_str() == account_id.as_str()
            && !self.removed_implicit.contains(&account_id);
        implicit || self.keys.contains(&(account_id, public_key))
    }

    pub fn add_public_key(&mut self, public_key: PublicKey) {
        let me = env::predecessor_account_id();
        if public_key.to_implicit_account_id().as_str() == me.as_str() {
            self.removed_implicit.remove(&me);
        } else {
            self.keys.insert((me, public_key));
        }
    }

    pub fn remove_public_key(&mut self, public_key: PublicKey) {
        let me = env::predecessor_account_id();
        if public_key.to_implicit_account_id().as_str() == me.as_str() {
            self.removed_implicit.insert(me);
        } else {
            self.keys.remove(&(me, public_key));
        }
    }
}
