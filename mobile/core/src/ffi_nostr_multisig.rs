//! UniFFI surface for Nostr identity, contacts, shared accounts, and coordination
//! (`docs/nostr-multisig.md` §3). Only public values cross: the coordination private key, the
//! phrase, gift-wrap plaintext, and raw relay events stay in the core, and coordination reports
//! counts. Every `WalletCore` method here needs an unlocked session.

use std::sync::Arc;

use crate::argent_multisig::{self, ArgentMultisigConfig, ArgentMultisigPrediction};
use crate::contact_card::{self, ContactCardParse, WalletContactCard};
use crate::contacts::{self, network_catalog_id, network_from_catalog_id, Contact};
use crate::coordination;
use crate::multisig_rpc::{MultisigAuthorityRead, MultisigAuthorityStatus};
use crate::multisig_store::{self, Deployment, Observed, PublicConfig, Record};
use crate::networks::NetworkId;
use crate::nostr_relay;
use crate::{felt, multisig_constants, nostr, CoreError, WalletCore};

/// `MULTISIG_LIMITS` plus the registry cap.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct MultisigLimits {
    pub name_length: u32,
    pub signers: u32,
    pub summary_length: u32,
    pub multisigs: u32,
}

/// A shared account as the UI shows it. Keys are public; `signer_public_keys` is empty when the
/// on-chain GUIDs did not all resolve to Stark keys (the record is then watch-only).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct MultisigRecord {
    pub id: String,
    pub network: NetworkId,
    pub address: String,
    pub name: Option<String>,
    pub threshold: Option<u32>,
    pub signer_count: u32,
    pub signer_public_keys: Vec<String>,
    pub has_current_config: bool,
    pub deployment: Option<ArgentMultisigPrediction>,
    /// Record ids of this wallet's accounts on the network whose keys sign for this account.
    pub local_signer_account_ids: Vec<String>,
}

/// Encodes this wallet's public card.
#[uniffi::export]
pub fn wallet_contact_card_encode(card: WalletContactCard) -> Result<String, CoreError> {
    contact_card::encode(&card)
}

/// Parses a pasted card against the active network.
#[uniffi::export]
pub fn wallet_contact_card_parse(text: String, network: NetworkId) -> ContactCardParse {
    contact_card::parse(&text, network)
}

/// `argentSignerGuid`.
#[uniffi::export]
pub fn argent_signer_guid(public_key: String) -> Result<String, CoreError> {
    argent_multisig::signer_guid_hex(&public_key)
}

/// `normalizeArgentMultisigConfig`.
#[uniffi::export]
pub fn argent_multisig_normalize(
    config: ArgentMultisigConfig,
) -> Result<ArgentMultisigConfig, CoreError> {
    argent_multisig::normalize(&config).map(|(normalized, _)| normalized)
}

/// The counterfactual address and review data for a configuration and salt.
#[uniffi::export]
pub fn argent_multisig_predict(
    config: ArgentMultisigConfig,
    salt: String,
) -> Result<ArgentMultisigPrediction, CoreError> {
    argent_multisig::predict(&config, &salt)
}

/// A relay URL from settings: `None` restores the reviewed defaults.
#[uniffi::export]
pub fn nostr_relay_url_normalize(raw: String) -> Result<Option<String>, CoreError> {
    nostr_relay::normalize_relay_url(&raw)
}

/// Shared limits from `generated/multisig.json`.
#[uniffi::export]
pub fn multisig_limits() -> MultisigLimits {
    let limits = &multisig_constants::get().limits;
    MultisigLimits {
        name_length: limits.name_length as u32,
        signers: limits.signers as u32,
        summary_length: limits.summary_length as u32,
        multisigs: limits.multisigs as u32,
    }
}

fn not_found() -> CoreError {
    CoreError::InvalidInput {
        reason: "shared account not found".into(),
    }
}

impl WalletCore {
    pub(crate) fn require_unlocked(&self) -> Result<(), CoreError> {
        self.with_phrase(|_, _| Ok(()))
    }

    /// `(record id, public key)` of every account record on `network` that can sign. Keys come
    /// from the vault's records, which `open` re-derived from the phrase, never from an index.
    fn local_public_keys(&self, network: NetworkId) -> Result<Vec<(String, String)>, CoreError> {
        self.with_session(false, |session| {
            Ok(session
                .payload
                .accounts
                .iter()
                .filter(|record| record.network() == network && !record.view_only())
                .map(|record| (record.id.clone(), record.public_key.clone()))
                .collect())
        })
    }

    fn record_view(
        &self,
        file: &multisig_store::File,
        record: &Record,
        local: &[(String, String)],
    ) -> Option<MultisigRecord> {
        let network = network_from_catalog_id(&record.network_id)?;
        let authority = multisig_store::authority(file, record);
        let keys = record
            .current_config
            .as_ref()
            .map(|config| config.signer_public_keys.clone())
            .or_else(|| {
                record
                    .deployment
                    .as_ref()
                    .map(|d| d.signer_public_keys.clone())
            })
            .unwrap_or_default();
        let deployment = record.deployment.as_ref().and_then(|deployment| {
            let config = ArgentMultisigConfig {
                threshold: deployment.threshold,
                signer_public_keys: deployment.signer_public_keys.clone(),
            };
            argent_multisig::predict(&config, &deployment.salt).ok()
        });
        let local_signer_account_ids = local
            .iter()
            .filter(|(_, key)| {
                argent_multisig::signer_guid_hex(key).is_ok_and(|guid| {
                    authority
                        .as_ref()
                        .is_some_and(|a| a.signer_guids.contains(&guid))
                })
            })
            .map(|(id, _)| id.clone())
            .collect();
        Some(MultisigRecord {
            id: record.id.clone(),
            network,
            address: record.address.clone(),
            name: record.name.clone(),
            threshold: authority.as_ref().map(|a| a.threshold),
            signer_count: authority
                .as_ref()
                .map_or(0, |a| a.signer_guids.len() as u32),
            signer_public_keys: keys,
            has_current_config: record.current_config.is_some(),
            deployment,
            local_signer_account_ids,
        })
    }

    fn view_by_id(&self, id: &str) -> Result<MultisigRecord, CoreError> {
        let file = multisig_store::load(self.data_dir())?;
        let record = file
            .records
            .iter()
            .find(|record| record.id == id)
            .ok_or_else(not_found)?;
        let network = network_from_catalog_id(&record.network_id).ok_or_else(not_found)?;
        let local = self.local_public_keys(network)?;
        self.record_view(&file, record, &local)
            .ok_or_else(not_found)
    }
}

#[uniffi::export]
impl WalletCore {
    /// The wallet's coordination public key (no BIP-39 passphrase, as the extension).
    pub fn nostr_public_key(&self) -> Result<String, CoreError> {
        self.with_phrase(|mnemonic, _| nostr::public_key(mnemonic))
    }

    /// Saved contacts on `network`.
    pub fn contacts(&self, network: NetworkId) -> Result<Vec<Contact>, CoreError> {
        self.require_unlocked()?;
        contacts::list(self.data_dir(), network)
    }

    /// Saves or updates a contact (the extension's `saveAddress`).
    pub fn save_contact(
        &self,
        network: NetworkId,
        label: String,
        address: String,
        public_key_x: Option<String>,
        nostr_public_key: Option<String>,
    ) -> Result<Contact, CoreError> {
        self.require_unlocked()?;
        contacts::save(
            self.data_dir(),
            network,
            &label,
            &address,
            public_key_x.as_deref(),
            nostr_public_key.as_deref(),
        )
    }

    /// Removes a contact by id.
    pub fn remove_contact(&self, id: String) -> Result<(), CoreError> {
        self.require_unlocked()?;
        contacts::remove(self.data_dir(), &id)
    }

    /// Shared accounts on `network`, in saved order.
    pub fn multisigs(&self, network: NetworkId) -> Result<Vec<MultisigRecord>, CoreError> {
        let local = self.local_public_keys(network)?;
        let file = multisig_store::load(self.data_dir())?;
        Ok(file
            .records
            .iter()
            .filter(|record| record.network_id == network_catalog_id(network))
            .filter_map(|record| self.record_view(&file, record, &local))
            .collect())
    }

    /// Saves the account a finished authority read describes. `Available` stores `currentConfig`
    /// only when every GUID resolves to a local or same-network contact key; `Undeployed` stores
    /// the address alone. Every other status is refused.
    pub fn add_multisig(
        &self,
        read: Arc<MultisigAuthorityRead>,
    ) -> Result<MultisigRecord, CoreError> {
        let network = read.network();
        let id = multisig_store::record_id(network, &read.address())?;
        let base = Record {
            account_contract_type: "argent-multisig".into(),
            address: read.address(),
            class_hash: argent_multisig::class_hash().into(),
            current_config: None,
            deployment: None,
            id: id.clone(),
            name: None,
            network_id: network_catalog_id(network).into(),
        };
        let (record, observed) = match read.status() {
            Some(MultisigAuthorityStatus::Undeployed) => (base, None),
            Some(MultisigAuthorityStatus::Available) => {
                let (threshold, guids) = read.authority().ok_or_else(not_found)?;
                let mut candidates: Vec<String> = self
                    .local_public_keys(network)?
                    .into_iter()
                    .map(|(_, key)| key)
                    .collect();
                candidates.extend(
                    contacts::list(self.data_dir(), network)?
                        .into_iter()
                        .filter_map(|c| c.public_key_x),
                );
                let resolved: Vec<String> = guids
                    .iter()
                    .filter_map(|guid| {
                        candidates.iter().find(|key| {
                            argent_multisig::signer_guid_hex(key)
                                .is_ok_and(|g| g == felt::canonical(guid))
                        })
                    })
                    .cloned()
                    .collect();
                if resolved.len() == guids.len() {
                    let current = PublicConfig {
                        signer_public_keys: resolved,
                        threshold,
                    };
                    (
                        Record {
                            current_config: Some(current),
                            ..base
                        },
                        None,
                    )
                } else {
                    let observed = Observed {
                        id: id.clone(),
                        signer_guids: guids.iter().map(felt::canonical).collect(),
                        threshold,
                    };
                    (base, Some(observed))
                }
            }
            _ => {
                return Err(CoreError::InvalidInput {
                    reason: "multisig authority is unavailable".into(),
                })
            }
        };
        self.require_unlocked()?;
        multisig_store::upsert_joined(self.data_dir(), record, observed)?;
        self.view_by_id(&id)
    }

    /// Saves an undeployed setup after the Approval step. The deployment signer must be a local
    /// account record on `network` in the signer set; the stored commitment re-derives to the saved address.
    pub fn save_multisig_setup(
        &self,
        network: NetworkId,
        name: Option<String>,
        config: ArgentMultisigConfig,
        salt: String,
        deployer_account_id: String,
    ) -> Result<MultisigRecord, CoreError> {
        let name = name
            .map(|n| contact_card::js_trim(&n).to_string())
            .filter(|n| !n.is_empty());
        if name
            .as_deref()
            .is_some_and(|n| nostr::utf16_length(n) > multisig_constants::get().limits.name_length)
        {
            return Err(CoreError::InvalidInput {
                reason: "shared account name is too long".into(),
            });
        }
        let prediction = argent_multisig::predict(&config, &salt)?;
        let local = self.local_public_keys(network)?;
        let (_, deployer) = local
            .iter()
            .find(|(id, _)| *id == deployer_account_id)
            .ok_or_else(|| CoreError::InvalidInput {
                reason: "unknown account".into(),
            })?;
        if !prediction.config.signer_public_keys.contains(deployer) {
            return Err(CoreError::InvalidInput {
                reason: "deployment signer is not in the signer set".into(),
            });
        }
        let id = multisig_store::record_id(network, &prediction.address)?;
        let record = Record {
            account_contract_type: "argent-multisig".into(),
            address: prediction.address.clone(),
            class_hash: argent_multisig::class_hash().into(),
            current_config: None,
            deployment: Some(Deployment {
                salt: prediction.salt.clone(),
                signer_public_keys: prediction.config.signer_public_keys.clone(),
                threshold: prediction.config.threshold,
            }),
            id: id.clone(),
            name,
            network_id: network_catalog_id(network).into(),
        };
        multisig_store::upsert_setup(self.data_dir(), record)?;
        self.view_by_id(&id)
    }

    /// Removes a shared account, its observed authority, checkpoint and held packages.
    pub fn remove_multisig(&self, id: String) -> Result<(), CoreError> {
        self.require_unlocked()?;
        multisig_store::remove(self.data_dir(), &id)?;
        let mut file = coordination::load(self.data_dir())?;
        file.checkpoints
            .retain(|checkpoint| checkpoint.account_id != id);
        file.held.retain(|held| held.account_id != id);
        coordination::store(self.data_dir(), &file)
    }
}

#[cfg(test)]
#[path = "ffi_nostr_multisig_tests.rs"]
mod tests;
