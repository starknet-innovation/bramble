//! The vault's one migration chain, following the extension's `schema/migrations.ts`: a single
//! vault version, exactly one adjacent step per version, each step a pure function of its input.
//!
//! | Vault version | On disk | Payload |
//! | --- | --- | --- |
//! | 1 | bare envelope, scope `bramble.mobile.vault.v1` | `accountCount` (original core) |
//! | 2 | DEK container, `version: 2` | `accountCount` (vault-security) |
//! | 2 | bare envelope, scope `bramble.mobile.vault.v1` | account records (the accounts branch, before the merge) |
//! | 3 | DEK container, `version: 3` | account records (`account_store.rs`) |
//!
//! Both branches minted "version 2" independently from version 1, so version 2 has two historical
//! payload shapes. The step from 2 accepts either; nothing else in the chain branches. The layout
//! is not a step of its own: a vault opened from a bare envelope is sealed into a new DEK
//! container at the current version, and a version-2 container is re-sealed in place (same DEK,
//! same slots). Each layout accepts only the versions it was ever written with.
//!
//! Randomness (a new DEK, IVs, commits) is drawn by the caller and passed in, so the sealing of a
//! migrated vault is deterministic and testable with fixed bytes. The caller proves the new file
//! round-trips before writing it and leaves the old file in place if anything fails.

use serde::Deserialize;
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::account_catalog::AccountFamily;
use crate::account_store::{self, VaultPayload};
use crate::container::{
    self, Dek, Randomness, StoredVault, VaultFile, FIRST_CONTAINER_VERSION, V1_SCOPE,
};
use crate::files::storage;
use crate::networks;
use crate::vault::{self, SealingKey};
use crate::{kms, CoreError};

/// The vault version this core writes: the container's `version` and the payload's.
pub(crate) const VAULT_VERSION: u32 = 3;
/// Accounts an account-count payload (versions 1 and 2) could hold.
const MAX_COUNTED_ACCOUNTS: u32 = 32;

fn invalid_payload() -> CoreError {
    storage("vault payload is invalid")
}

/// The account-count payload of vault versions 1 and 2. Only the phrase and passphrase are
/// secret; they are zeroized on drop.
#[derive(Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CountedPayload {
    pub account_count: u32,
    pub mnemonic: String,
    pub mnemonic_passphrase: Option<String>,
    pub version: u32,
}

/// A decrypted payload somewhere on the chain.
pub(crate) enum Staged {
    /// Versions 1 and 2 (vault-security): a phrase and how many OZ indices it shows.
    Counted(CountedPayload),
    /// Version 2 (the accounts branch) and version 3: account records.
    Records(VaultPayload),
}

impl Staged {
    fn version(&self) -> u32 {
        match self {
            Self::Counted(payload) => payload.version,
            Self::Records(payload) => payload.version,
        }
    }
}

#[derive(Deserialize)]
struct Probe {
    version: u32,
    #[serde(rename = "accountCount")]
    account_count: Option<serde::de::IgnoredAny>,
}

/// Parses a decrypted payload into its stage, checking only its grammar.
pub(crate) fn stage(plaintext: &[u8]) -> Result<Staged, CoreError> {
    let probe: Probe = serde_json::from_slice(plaintext).map_err(|_| invalid_payload())?;
    let parsed = if probe.account_count.is_some() {
        serde_json::from_slice(plaintext).map(Staged::Counted)
    } else {
        serde_json::from_slice(plaintext).map(Staged::Records)
    };
    let staged = parsed.map_err(|_| invalid_payload())?;
    if staged.version() != probe.version {
        return Err(invalid_payload());
    }
    Ok(staged)
}

type Step = fn(Staged) -> Result<Staged, CoreError>;

/// `(from version, step to from + 1)`. The last step ends at `VAULT_VERSION`.
pub(crate) const VAULT_MIGRATIONS: [(u32, Step); 2] = [(1, v1_to_v2), (2, v2_to_v3)];

/// 1 → 2 (vault-security): the same account count, phrase and passphrase. The move from the bare
/// envelope into the DEK container happens when the migrated payload is sealed.
fn v1_to_v2(staged: Staged) -> Result<Staged, CoreError> {
    let Staged::Counted(mut payload) = staged else {
        return Err(invalid_payload());
    };
    check_counted(&payload)?;
    payload.version = 2;
    Ok(Staged::Counted(payload))
}

/// 2 → 3 (accounts). vault-security's count payload becomes records: v1 and v2 showed OZ
/// indices `0..count` on every network, so each becomes a record on each network, in
/// `supported_networks()` order, and the Mainnet index-0 record is active. Nothing the user saw
/// disappears. The accounts branch's records payload already has this shape and is re-tagged.
fn v2_to_v3(staged: Staged) -> Result<Staged, CoreError> {
    match staged {
        Staged::Counted(mut counted) => {
            check_counted(&counted)?;
            let mnemonic = std::mem::take(&mut counted.mnemonic);
            let mut payload =
                VaultPayload::new(mnemonic, counted.mnemonic_passphrase.take(), None)?;
            for network in networks::all().iter().map(|info| info.network) {
                for index in 0..counted.account_count {
                    let record =
                        payload.derive(AccountFamily::OpenZeppelin, index, None, None, network)?;
                    payload.accounts.push(record);
                }
            }
            payload.active_account_id = payload.accounts.first().map(|record| record.id.clone());
            payload.recovery_pending = false;
            Ok(Staged::Records(payload))
        }
        Staged::Records(mut payload) => {
            payload.version = 3;
            Ok(Staged::Records(payload))
        }
    }
}

fn check_counted(payload: &CountedPayload) -> Result<(), CoreError> {
    if payload.account_count == 0
        || payload.account_count > MAX_COUNTED_ACCOUNTS
        || !kms::validate_mnemonic(&payload.mnemonic)
    {
        return Err(invalid_payload());
    }
    Ok(())
}

/// Runs the chain from the staged version to `VAULT_VERSION`, then validates the result in full
/// (every record re-derived from the phrase). Returns the payload and whether it moved.
pub(crate) fn migrate(staged: Staged) -> Result<(VaultPayload, bool), CoreError> {
    let from = staged.version();
    if !(1..=VAULT_VERSION).contains(&from) {
        return Err(invalid_payload());
    }
    let mut staged = staged;
    for (version, step) in VAULT_MIGRATIONS {
        if version >= from {
            staged = step(staged)?;
        }
    }
    let Staged::Records(payload) = staged else {
        return Err(invalid_payload());
    };
    if payload.version != VAULT_VERSION {
        return Err(invalid_payload());
    }
    account_store::validate(&payload)?;
    Ok((payload, from != VAULT_VERSION))
}

/// Which stages each layout was ever written with. Anything else is refused before migrating.
fn envelope_accepts(staged: &Staged) -> bool {
    matches!(
        (staged, staged.version()),
        (Staged::Counted(_), 1) | (Staged::Records(_), 2)
    )
}

fn container_accepts(staged: &Staged, file_version: u32) -> bool {
    staged.version() == file_version
        && match staged {
            Staged::Counted(_) => file_version == FIRST_CONTAINER_VERSION,
            Staged::Records(_) => file_version == VAULT_VERSION,
        }
}

/// A vault opened into memory. `migrated` means `container` is the current-version file built
/// from an older one that is still on disk.
pub(crate) struct Opened {
    pub payload: VaultPayload,
    pub dek: Dek,
    pub container: VaultFile,
    pub migrated: bool,
}

/// Opens a container's payload with its (already proven) DEK and brings it to the current
/// version. A version-2 container is re-sealed in place: same DEK, lineage and slots.
pub(crate) fn open_container(file: VaultFile, dek: Dek) -> Result<Opened, CoreError> {
    let staged = stage(&file.open_payload(&dek)?)?;
    if !container_accepts(&staged, file.version) {
        return Err(invalid_payload());
    }
    let (payload, migrated) = migrate(staged)?;
    let container = if migrated {
        let resealed = file.with_payload(&dek, &payload.to_json()?)?;
        // Prove the re-sealed file opens as the current version before anyone writes it.
        if stage(&resealed.open_payload(&dek)?)?.version() != VAULT_VERSION {
            return Err(storage("vault migration did not round-trip"));
        }
        resealed
    } else {
        file
    };
    Ok(Opened {
        payload,
        dek,
        container,
        migrated,
    })
}

/// Seals an opened bare-envelope vault into a new current-version container. Pure given its
/// inputs: `key` is the passphrase key re-derived at the current KDF strength, and the DEK and
/// randomness are fresh.
pub(crate) fn seal_migrated(
    payload: &VaultPayload,
    key: &SealingKey,
    dek: &[u8; 32],
    randomness: &Randomness,
) -> Result<VaultFile, CoreError> {
    container::seal_new(key, dek, &payload.to_json()?, randomness)
}

/// Opens whatever is on disk with the passphrase (one KDF) and brings it to the current version
/// in memory, proving that a rebuilt file round-trips. Writing it is the caller's decision.
pub(crate) fn open_stored(stored: StoredVault, password: &str) -> Result<Opened, CoreError> {
    match stored {
        StoredVault::Container(file) => {
            let (dek, _) = file.open_dek(password)?;
            open_container(*file, dek)
        }
        StoredVault::Envelope(envelope) => {
            let (plaintext, key) = vault::open(&envelope, password, V1_SCOPE)?;
            let staged = stage(&plaintext)?;
            if !envelope_accepts(&staged) {
                return Err(invalid_payload());
            }
            let (payload, _) = migrate(staged)?;
            let dek = container::new_dek()?;
            let container = seal_migrated(&payload, &key, &dek, &Randomness::draw()?)?;
            let proven = container.open_dek_with(&key)?;
            if *proven != *dek {
                return Err(storage("vault migration did not round-trip"));
            }
            let reopened = open_container(container, proven)?;
            if reopened.migrated {
                return Err(storage("vault migration did not round-trip"));
            }
            Ok(Opened {
                migrated: true,
                ..reopened
            })
        }
    }
}

/// The serialised form of an account-count payload, for tests that build old vaults.
#[cfg(test)]
pub(crate) fn counted_json(
    version: u32,
    account_count: u32,
    mnemonic: &str,
) -> zeroize::Zeroizing<Vec<u8>> {
    zeroize::Zeroizing::new(
        serde_json::to_vec(&serde_json::json!({
            "accountCount": account_count,
            "mnemonic": mnemonic,
            "mnemonicPassphrase": null,
            "version": version,
        }))
        .unwrap(),
    )
}

#[cfg(test)]
#[path = "migrations_tests.rs"]
mod tests;
