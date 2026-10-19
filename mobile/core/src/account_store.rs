//! The sealed vault payload (vault version 4, `migrations::VAULT_VERSION`): one record per account (family, class, index, salt,
//! address, public key), one active account, labels, and groups. Field names follow the
//! extension's vault records so a later port to its schema stays mechanical.
//!
//! Nothing stored is trusted blindly. `open` validates every field, and re-derives every record
//! from the phrase and compares it with what was stored, so a tampered or corrupted record fails
//! closed rather than redirecting Receive or Copy to another address. Older payloads (an account
//! count) reach this shape through the one migration chain in `migrations.rs`.

use std::collections::{BTreeMap, HashMap, HashSet};

use serde::{Deserialize, Serialize};
use starknet_types_core::felt::Felt;
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::account_catalog::{catalog, AccountFamily};
use crate::account_names::{is_label, js_trim};
use crate::files::storage;
use crate::groups::{self, StoredGroup};
use crate::kms_accounts::{self, family_address};
use crate::migrations::VAULT_VERSION;
use crate::networks::NetworkId;
use crate::{felt, kms, CoreError};

/// Records one vault may hold across networks (mobile policy; bounds vault size and unlock work).
pub(crate) const MAX_ACCOUNT_RECORDS: usize = 128;
/// Highest account index (`RECOVERY_SCAN_LIMITS.maxIndex`, Krusty's unhardened bound).
pub(crate) const MAX_ACCOUNT_INDEX: u32 = 0x7fff_ffff;

/// An index this wallet may derive, restore or create at (the extension's
/// `isRecoveryAccountIndex`): in range, and never strkd's reserved agent index.
pub(crate) fn is_usable_account_index(index: u32) -> bool {
    index <= MAX_ACCOUNT_INDEX && index != catalog().reserved_agent_index
}

/// One account as sealed in the vault. Public data only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StoredAccount {
    pub account_index: u32,
    pub address: String,
    pub class_hash: String,
    pub deployment_salt: Option<String>,
    pub family: String,
    pub id: String,
    pub network: String,
    pub public_key: String,
}

impl StoredAccount {
    pub(crate) fn family(&self) -> AccountFamily {
        AccountFamily::from_wire(&self.family).expect("validated on open")
    }

    pub(crate) fn network(&self) -> NetworkId {
        NetworkId::from_catalog_id(&self.network).expect("validated on open")
    }

    pub(crate) fn class_felt(&self) -> Felt {
        felt::parse(&self.class_hash).expect("validated on open")
    }

    pub(crate) fn salt_felt(&self) -> Option<Felt> {
        self.deployment_salt
            .as_deref()
            .map(|salt| felt::parse(salt).expect("validated on open"))
    }

    pub(crate) fn view_only(&self) -> bool {
        self.family() == AccountFamily::Braavos
    }
}

/// Plaintext sealed inside the vault container. Only the phrase and passphrase are secret; they
/// are zeroized on drop.
#[derive(Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct VaultPayload {
    #[zeroize(skip)]
    pub accounts: Vec<StoredAccount>,
    #[zeroize(skip)]
    pub active_account_id: Option<String>,
    /// Vault version 4: set when a wallet is created and cleared once its Confirm backup step
    /// succeeds (`backup.rs`). Not secret. Absent in versions 1 to 3 and required from 4 on, so
    /// an older payload carrying it, or a current one missing it, fails validation.
    #[zeroize(skip)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backup_pending: Option<bool>,
    #[zeroize(skip)]
    pub groups: Vec<StoredGroup>,
    #[zeroize(skip)]
    pub labels: BTreeMap<String, String>,
    pub mnemonic: String,
    pub mnemonic_passphrase: Option<String>,
    pub recovery_pending: bool,
    pub version: u32,
}

/// The non-secret state a mutation may change, captured so a failed write can be rolled back.
pub(crate) struct PublicState {
    accounts: Vec<StoredAccount>,
    active_account_id: Option<String>,
    backup_pending: Option<bool>,
    groups: Vec<StoredGroup>,
    labels: BTreeMap<String, String>,
    recovery_pending: bool,
}

impl VaultPayload {
    /// A new vault: OZ index 0 on `network` for a created wallet, or nothing yet (discovery
    /// pending) for an imported one. A created wallet's backup is pending until confirmed; an
    /// imported phrase is one the user already holds.
    pub(crate) fn new(
        mnemonic: String,
        mnemonic_passphrase: Option<String>,
        first_account: Option<NetworkId>,
    ) -> Result<Self, CoreError> {
        let mut payload = Self {
            accounts: Vec::new(),
            active_account_id: None,
            backup_pending: Some(first_account.is_some()),
            groups: Vec::new(),
            labels: BTreeMap::new(),
            mnemonic,
            mnemonic_passphrase,
            recovery_pending: first_account.is_none(),
            version: VAULT_VERSION,
        };
        if let Some(network) = first_account {
            let record = payload.derive(AccountFamily::OpenZeppelin, 0, None, None, network)?;
            payload.active_account_id = Some(record.id.clone());
            payload.accounts.push(record);
        }
        Ok(payload)
    }

    pub(crate) fn to_json(&self) -> Result<zeroize::Zeroizing<Vec<u8>>, CoreError> {
        serde_json::to_vec(self)
            .map(zeroize::Zeroizing::new)
            .map_err(|_| storage("serialise vault"))
    }

    pub(crate) fn public_key(&self, account_index: u32) -> Result<Felt, CoreError> {
        kms_accounts::public_key(
            &self.mnemonic,
            self.mnemonic_passphrase.as_deref(),
            account_index,
        )
    }

    /// Derives one record from the phrase. Nothing here comes from the host except coordinates.
    pub(crate) fn derive(
        &self,
        family: AccountFamily,
        account_index: u32,
        class_hash: Option<&Felt>,
        salt: Option<&Felt>,
        network: NetworkId,
    ) -> Result<StoredAccount, CoreError> {
        let public_key = self.public_key(account_index)?;
        record_at(
            family,
            account_index,
            class_hash,
            salt,
            &public_key,
            network,
        )
    }

    pub(crate) fn record(&self, account_id: &str) -> Option<&StoredAccount> {
        self.accounts.iter().find(|record| record.id == account_id)
    }

    pub(crate) fn snapshot(&self) -> PublicState {
        PublicState {
            accounts: self.accounts.clone(),
            active_account_id: self.active_account_id.clone(),
            backup_pending: self.backup_pending,
            groups: self.groups.clone(),
            labels: self.labels.clone(),
            recovery_pending: self.recovery_pending,
        }
    }

    pub(crate) fn restore(&mut self, state: PublicState) {
        self.accounts = state.accounts;
        self.active_account_id = state.active_account_id;
        self.backup_pending = state.backup_pending;
        self.groups = state.groups;
        self.labels = state.labels;
        self.recovery_pending = state.recovery_pending;
    }
}

/// Places an already-derived public key under a family, class, and salt on one network.
pub(crate) fn record_at(
    family: AccountFamily,
    account_index: u32,
    class_hash: Option<&Felt>,
    salt: Option<&Felt>,
    public_key: &Felt,
    network: NetworkId,
) -> Result<StoredAccount, CoreError> {
    if !is_usable_account_index(account_index) {
        return Err(CoreError::InvalidInput {
            reason: "account index out of range".into(),
        });
    }
    let placed = family_address(family, class_hash, salt, public_key, network.chain())?;
    let address = felt::canonical(&placed.address);
    Ok(StoredAccount {
        account_index,
        id: format!("{}:{address}", network.catalog_id()),
        address,
        class_hash: felt::canonical(&placed.class_hash),
        deployment_salt: placed.deployment_salt.as_ref().map(felt::canonical),
        family: family.wire().into(),
        network: network.catalog_id().into(),
        public_key: felt::canonical(public_key),
    })
}

fn invalid_payload() -> CoreError {
    storage("vault payload is invalid")
}

fn is_canonical_felt(value: &str, non_zero: bool) -> bool {
    felt::parse(value)
        .filter(|parsed| !non_zero || *parsed != Felt::ZERO)
        .is_some_and(|parsed| felt::canonical(&parsed) == value)
}

// Field grammar of one record, before any derivation.
fn is_well_formed(record: &StoredAccount) -> bool {
    let (Some(family), Some(network)) = (
        AccountFamily::from_wire(&record.family),
        NetworkId::from_catalog_id(&record.network),
    ) else {
        return false;
    };
    let salt_ok = match (&family, &record.deployment_salt) {
        (AccountFamily::OpenZeppelin, None) => true,
        (AccountFamily::OpenZeppelin, Some(_)) | (_, None) => false,
        (_, Some(salt)) => is_canonical_felt(salt, false),
    };
    record.account_index <= MAX_ACCOUNT_INDEX
        && is_canonical_felt(&record.address, true)
        && is_canonical_felt(&record.public_key, true)
        && is_canonical_felt(&record.class_hash, true)
        && salt_ok
        && record.id == format!("{}:{}", network.catalog_id(), record.address)
}

// Every structural invariant, without derivation.
fn is_consistent(payload: &VaultPayload) -> bool {
    let ids: HashSet<&str> = payload.accounts.iter().map(|r| r.id.as_str()).collect();
    payload.version == VAULT_VERSION
        && payload.backup_pending.is_some()
        && kms::validate_mnemonic(&payload.mnemonic)
        && payload.accounts.len() <= MAX_ACCOUNT_RECORDS
        && ids.len() == payload.accounts.len()
        && payload.recovery_pending == payload.accounts.is_empty()
        && payload.accounts.iter().all(is_well_formed)
        && match &payload.active_account_id {
            None => payload.accounts.is_empty(),
            Some(id) => ids.contains(id.as_str()),
        }
        && payload.labels.len() <= MAX_ACCOUNT_RECORDS
        && payload.labels.iter().all(|(id, label)| {
            ids.contains(id.as_str()) && is_label(label) && js_trim(label) == label
        })
        && groups::is_valid(&payload.groups, &ids)
}

// Re-derives every record from the phrase; any difference is tampering or corruption.
fn rederives(payload: &VaultPayload) -> Result<bool, CoreError> {
    let mut keys: HashMap<u32, Felt> = HashMap::new();
    for record in &payload.accounts {
        let public_key = match keys.get(&record.account_index) {
            Some(key) => *key,
            None => {
                let key = payload.public_key(record.account_index)?;
                keys.insert(record.account_index, key);
                key
            }
        };
        let family = record.family();
        let class_hash = (family != AccountFamily::OpenZeppelin).then(|| record.class_felt());
        let expected = record_at(
            family,
            record.account_index,
            class_hash.as_ref(),
            record.salt_felt().as_ref(),
            &public_key,
            record.network(),
        );
        if expected.ok().as_ref() != Some(record) {
            return Ok(false);
        }
    }
    Ok(true)
}

/// Checks a payload in full, re-deriving every record. Used on open.
pub(crate) fn validate(payload: &VaultPayload) -> Result<(), CoreError> {
    if !is_consistent(payload) || !rederives(payload)? {
        return Err(invalid_payload());
    }
    Ok(())
}

/// Checks every structural invariant without re-deriving. Used before every write, whose new
/// records were derived by this core in the same call.
pub(crate) fn check_consistent(payload: &VaultPayload) -> Result<(), CoreError> {
    if is_consistent(payload) {
        Ok(())
    } else {
        Err(invalid_payload())
    }
}
