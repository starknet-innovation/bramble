//! The shared-account registry (`multisigs.json`). `records` hold the extension's exact
//! `ArgentMultisigRecord` shape (`packages/features/multisig/src/repository-schema.ts`) and are
//! validated the way `isArgentMultisigRecord` validates them, so a later export maps them one to
//! one. `observed` is mobile-only: the signer GUIDs and threshold of a joined account whose GUIDs
//! did not all resolve to Stark keys. It never feeds `currentConfig`, and an export drops it.

use std::path::Path;

use serde::{Deserialize, Serialize};
use starknet_types_core::felt::Felt;

use crate::argent_multisig::{self, ArgentMultisigConfig};
use crate::contacts::{network_catalog_id, network_from_catalog_id};
use crate::networks::NetworkId;
use crate::{felt, multisig_constants, nostr, public_store, CoreError};

/// `ArgentMultisigCurrentConfig`: GUID-ordered Stark keys and a threshold.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicConfig {
    pub signer_public_keys: Vec<String>,
    pub threshold: u32,
}

/// `ArgentMultisigDeployment`: the counterfactual constructor commitment.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Deployment {
    pub salt: String,
    pub signer_public_keys: Vec<String>,
    pub threshold: u32,
}

/// `ArgentMultisigRecord`, field for field.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Record {
    pub account_contract_type: String,
    pub address: String,
    pub class_hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_config: Option<PublicConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deployment: Option<Deployment>,
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub network_id: String,
}

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

/// Signer authority a record commits to: threshold and ascending signer GUIDs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Authority {
    pub threshold: u32,
    pub signer_guids: Vec<String>,
}

fn unreadable() -> CoreError {
    CoreError::Storage {
        reason: format!("{} unreadable", public_store::MULTISIGS),
    }
}

fn is_canonical_felt(value: &str) -> bool {
    felt::parse(value).is_some_and(|f| felt::canonical(&f) == value)
}

fn is_canonical_non_zero(value: &str) -> bool {
    felt::parse_non_zero(value).is_some_and(|f| felt::canonical(&f) == value)
}

/// `isArgentMultisigCurrentConfig`: normalising must leave the keys exactly as stored.
fn normalized_guids(keys: &[String], threshold: u32) -> Option<Vec<String>> {
    let config = ArgentMultisigConfig {
        threshold,
        signer_public_keys: keys.to_vec(),
    };
    let (normalized, guids) = argent_multisig::normalize(&config).ok()?;
    (normalized.signer_public_keys == keys).then(|| guids.iter().map(felt::canonical).collect())
}

/// `isArgentMultisigRecord`.
pub fn is_record(record: &Record) -> bool {
    let name_ok = record.name.as_deref().is_none_or(|name| {
        (1..=multisig_constants::get().limits.name_length).contains(&nostr::utf16_length(name))
    });
    let deployment_ok = record.deployment.as_ref().is_none_or(|deployment| {
        is_canonical_felt(&deployment.salt)
            && normalized_guids(&deployment.signer_public_keys, deployment.threshold).is_some()
            && argent_multisig::predict(
                &ArgentMultisigConfig {
                    threshold: deployment.threshold,
                    signer_public_keys: deployment.signer_public_keys.clone(),
                },
                &deployment.salt,
            )
            .is_ok_and(|prediction| prediction.address == record.address)
    });
    record.account_contract_type == "argent-multisig"
        && is_canonical_non_zero(&record.address)
        && record.class_hash == argent_multisig::class_hash()
        && network_from_catalog_id(&record.network_id).is_some()
        && record.id == format!("{}:{}", record.network_id, record.address)
        && name_ok
        && record.current_config.as_ref().is_none_or(|config| {
            normalized_guids(&config.signer_public_keys, config.threshold).is_some()
        })
        && deployment_ok
}

/// Ascending, canonical, unique, non-zero GUIDs with a threshold in `1..=n`.
pub fn is_authority(signer_guids: &[String], threshold: u32) -> bool {
    let parsed: Option<Vec<Felt>> = signer_guids
        .iter()
        .map(|guid| {
            is_canonical_non_zero(guid)
                .then(|| felt::parse(guid))
                .flatten()
        })
        .collect();
    parsed.is_some_and(|guids| {
        !guids.is_empty()
            && guids.len() <= multisig_constants::get().limits.signers
            && threshold >= 1
            && threshold as usize <= guids.len()
            && guids.windows(2).all(|pair| pair[0] < pair[1])
    })
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

/// The authority a record commits to: `currentConfig`, else `deployment`, else `observed`.
pub fn authority(file: &File, record: &Record) -> Option<Authority> {
    let from_keys = |keys: &[String], threshold: u32| {
        normalized_guids(keys, threshold).map(|signer_guids| Authority {
            threshold,
            signer_guids,
        })
    };
    if let Some(config) = &record.current_config {
        return from_keys(&config.signer_public_keys, config.threshold);
    }
    if let Some(deployment) = &record.deployment {
        return from_keys(&deployment.signer_public_keys, deployment.threshold);
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
    if !is_canonical_non_zero(address) {
        return Err(CoreError::InvalidInput {
            reason: "invalid multisig address".into(),
        });
    }
    Ok(format!("{}:{address}", network_catalog_id(network)))
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
