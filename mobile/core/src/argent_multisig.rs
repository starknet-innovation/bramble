//! Argent Multisig 0.2 (the extension's "Ready Multisig"): signer GUIDs, the GUID-sorted
//! configuration, and the counterfactual address are `wallet_core::accounts::multisig`; this module
//! passes Bramble's pinned class (`multisig_constants::argent_multisig_class`) and declares the
//! records' UniFFI shapes.

pub use wallet_core::accounts::multisig::{ArgentMultisigConfig, ArgentMultisigPrediction};

use crate::{multisig_constants, CoreError};

/// A signer set and threshold in the extension's normalised form: canonical keys, GUID-sorted.
#[uniffi::remote(Record)]
pub struct ArgentMultisigConfig {
    pub threshold: u32,
    pub signer_public_keys: Vec<String>,
}

/// The counterfactual deployment of one configuration.
#[uniffi::remote(Record)]
pub struct ArgentMultisigPrediction {
    pub address: String,
    pub class_hash: String,
    pub salt: String,
    pub constructor_calldata: Vec<String>,
    pub config: ArgentMultisigConfig,
    pub signer_guids: Vec<String>,
}

/// The pinned Argent Multisig 0.2 class hash, spelled exactly as the extension stores it.
pub fn class_hash() -> &'static str {
    multisig_constants::argent_multisig_class().class_hash()
}

/// `argentSignerGuid` over the extension's felt spelling.
pub fn signer_guid_hex(public_key: &str) -> Result<String, CoreError> {
    Ok(wallet_core::accounts::multisig::signer_guid_hex(
        public_key,
    )?)
}

/// `normalizeArgentMultisigConfig` on the pinned class. Returns the GUIDs in key order.
pub fn normalize(
    config: &ArgentMultisigConfig,
) -> Result<(ArgentMultisigConfig, Vec<wallet_core::Felt>), CoreError> {
    Ok(wallet_core::accounts::multisig::normalize(
        config,
        multisig_constants::argent_multisig_class(),
    )?)
}

/// `argentMultisigAddress` on the pinned class, plus everything the Fund and Deploy review shows.
pub fn predict(
    config: &ArgentMultisigConfig,
    salt: &str,
) -> Result<ArgentMultisigPrediction, CoreError> {
    Ok(wallet_core::accounts::multisig::predict(
        config,
        salt,
        multisig_constants::argent_multisig_class(),
    )?)
}
