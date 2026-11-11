//! The shared-account registry (`multisigs.json`). `records` hold the extension's exact
//! `ArgentMultisigRecord` shape (`packages/features/multisig/src/repository-schema.ts`) and are
//! validated the way `isArgentMultisigRecord` validates them, so a later export maps them one to
//! one. `observed` is mobile-only: the signer GUIDs and threshold of a joined account whose GUIDs
//! did not all resolve to Stark keys. It never feeds `currentConfig`, and an export drops it.

use std::path::Path;

use serde::{Deserialize, Serialize};
use wallet_core::accounts::multisig_records;

use crate::networks::NetworkId;
use crate::{multisig_constants, public_store, CoreError};

pub use wallet_core::accounts::multisig_records::{Authority, Deployment, PublicConfig, Record};

/// Mobile-only chain authority for a record without `currentConfig`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Observed {
    pub id: String,
    pub signer_guids: Vec<String>,
    pub threshold: u32,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct File {
    version: u32,
    pub records: Vec<Record>,
    pub observed: Vec<Observed>,
}

fn unreadable() -> CoreError {
    CoreError::Storage {
        reason: format!("{} unreadable", public_store::MULTISIGS),
    }
}

/// `isArgentMultisigRecord` on the pinned class and name limit.
pub fn is_record(record: &Record) -> bool {
    multisig_records::is_record(
        record,
        multisig_constants::argent_multisig_class(),
        multisig_constants::get().limits.name_length,
    )
}

/// Ascending, canonical, unique, non-zero GUIDs with a threshold in `1..=n`.
pub fn is_authority(signer_guids: &[String], threshold: u32) -> bool {
    multisig_records::is_authority(
        signer_guids,
        threshold,
        multisig_constants::argent_multisig_class(),
    )
}

/// Reads and validates the registry; a missing file is empty, an invalid one fails closed.
pub fn load(dir: &Path) -> Result<File, CoreError> {
    let Some(file) = public_store::read::<File>(dir, public_store::MULTISIGS)? else {
        return Ok(File {
            version: 1,
            ..File::default()
        });
    };
    let records = &file.records;
    let unique = records
        .iter()
        .enumerate()
        .all(|(index, record)| records[..index].iter().all(|other| other.id != record.id));
    let observed_ok = file.observed.iter().enumerate().all(|(index, observed)| {
        records
            .iter()
            .any(|record| record.id == observed.id && record.current_config.is_none())
            && file.observed[..index]
                .iter()
                .all(|other| other.id != observed.id)
            && is_authority(&observed.signer_guids, observed.threshold)
    });
    if file.version != 1
        || records.len() > multisig_constants::get().limits.multisigs
        || !unique
        || !records.iter().all(is_record)
        || !observed_ok
    {
        return Err(unreadable());
    }
    Ok(file)
}

/// Writes the registry after re-validating it.
pub fn store(dir: &Path, file: &File) -> Result<(), CoreError> {
    if !file.records.iter().all(is_record) {
        return Err(unreadable());
    }
    public_store::write(dir, public_store::MULTISIGS, file)
}

/// The authority a record commits to: `currentConfig`, else `deployment`, else `observed`. A
/// record whose stored keys do not normalise has none; `observed` is consulted only for a record
/// with neither `currentConfig` nor `deployment`.
pub fn authority(file: &File, record: &Record) -> Option<Authority> {
    if record.current_config.is_some() || record.deployment.is_some() {
        return multisig_records::authority(record, multisig_constants::argent_multisig_class());
    }
    file.observed
        .iter()
        .find(|observed| observed.id == record.id)
        .map(|observed| Authority {
            threshold: observed.threshold,
            signer_guids: observed.signer_guids.clone(),
        })
}

/// Builds a record's id and checks the address is canonical and non-zero.
pub fn record_id(network: NetworkId, address: &str) -> Result<String, CoreError> {
    Ok(multisig_records::record_id(network, address)?)
}

fn full() -> CoreError {
    CoreError::InvalidInput {
        reason: "shared account registry is full".into(),
    }
}

/// Stores a joined record. An existing record keeps its name and deployment; a fresh resolved
/// `currentConfig` replaces the stored one, as the extension's `addRecord` does through
/// `updateCurrentConfig`, so a signer rotation or threshold change reaches the trust judge.
pub fn upsert_joined(
    dir: &Path,
    record: Record,
    observed: Option<Observed>,
) -> Result<Record, CoreError> {
    let mut file = load(dir)?;
    let count = file.records.len();
    let stored = match file
        .records
        .iter_mut()
        .find(|stored| stored.id == record.id)
    {
        Some(existing) => {
            // The extension's `addRecord`: a fresh, fully resolved authority replaces the stored
            // one (a rotation or threshold change); an unresolved read keeps what is stored.
            if record.current_config.is_some() {
                existing.current_config = record.current_config.clone();
            }
            existing.clone()
        }
        None if count >= multisig_constants::get().limits.multisigs => return Err(full()),
        None => {
            file.records.push(record.clone());
            record
        }
    };
    file.observed.retain(|entry| entry.id != stored.id);
    if stored.current_config.is_none() {
        if let Some(observed) = observed {
            file.observed.push(observed);
        }
    }
    store(dir, &file)?;
    Ok(stored)
}

/// Stores a created setup. An existing record keeps its name when none is given and its
/// `currentConfig`; the deployment commitment is replaced (the same address implies the same one).
pub fn upsert_setup(dir: &Path, record: Record) -> Result<Record, CoreError> {
    let mut file = load(dir)?;
    let count = file.records.len();
    let stored = match file
        .records
        .iter_mut()
        .find(|stored| stored.id == record.id)
    {
        Some(existing) => {
            existing.deployment = record.deployment.clone();
            if record.name.is_some() {
                existing.name = record.name.clone();
            }
            existing.clone()
        }
        None if count >= multisig_constants::get().limits.multisigs => return Err(full()),
        None => {
            file.records.push(record.clone());
            record
        }
    };
    store(dir, &file)?;
    Ok(stored)
}

/// Removes a record and its observed authority.
pub fn remove(dir: &Path, id: &str) -> Result<(), CoreError> {
    let mut file = load(dir)?;
    file.records.retain(|record| record.id != id);
    file.observed.retain(|observed| observed.id != id);
    store(dir, &file)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(current_config: Option<PublicConfig>, deployment: Option<Deployment>) -> Record {
        Record {
            account_contract_type: "argent-multisig".into(),
            address: "0x123".into(),
            class_hash: crate::argent_multisig::class_hash().into(),
            current_config,
            deployment,
            id: "SN_SEPOLIA:0x123".into(),
            name: None,
            network_id: "SN_SEPOLIA".into(),
        }
    }

    #[test]
    fn observed_backs_only_a_record_without_keys() {
        let observed = Observed {
            id: "SN_SEPOLIA:0x123".into(),
            signer_guids: vec!["0x1".into()],
            threshold: 1,
        };
        let file = File {
            version: 1,
            records: Vec::new(),
            observed: vec![observed.clone()],
        };
        assert_eq!(
            authority(&file, &record(None, None)),
            Some(Authority {
                threshold: 1,
                signer_guids: observed.signer_guids,
            })
        );
        let bad_keys = vec!["0xABC".to_string()];
        let broken_deployment = Deployment {
            salt: "0x0".into(),
            signer_public_keys: bad_keys.clone(),
            threshold: 1,
        };
        assert_eq!(
            authority(&file, &record(None, Some(broken_deployment))),
            None
        );
        let broken_config = PublicConfig {
            signer_public_keys: bad_keys,
            threshold: 1,
        };
        assert_eq!(authority(&file, &record(Some(broken_config), None)), None);
    }
}
