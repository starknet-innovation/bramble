//! Argent Multisig 0.2 (the extension's "Ready Multisig"), mirroring
//! `packages/platform/starknet/src/accounts/account-contracts.ts`:
//! signer GUIDs, the GUID-sorted configuration, constructor calldata, and the counterfactual
//! address. Krusty 0.11.0 has no Argent-multisig descriptor (its `OpenZeppelinMultisig` is a
//! different contract whose addresses never match), so this composes Krusty's public
//! `calculate_contract_address` and `encode_short_string` with the 2-to-1 Poseidon hash from
//! `starknet-types-core`, the same primitive library Krusty uses. These are public hash functions,
//! not key handling. The formula is pinned to the extension by parity fixtures, and
//! `docs/nostr-multisig.md` §8 proposes moving it upstream.

use starknet_types_core::felt::Felt;
use starknet_types_core::hash::{Poseidon, StarkHash};

use crate::{felt, multisig_constants, CoreError};

/// `2**251 - 256`: starknet.js reduces contract addresses modulo this bound.
fn address_bound() -> Felt {
    Felt::from_hex("0x7ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00")
        .expect("address bound is a felt")
}

/// A signer set and threshold in the extension's normalised form: canonical keys, GUID-sorted.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct ArgentMultisigConfig {
    pub threshold: u32,
    pub signer_public_keys: Vec<String>,
}

/// The counterfactual deployment of one configuration.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct ArgentMultisigPrediction {
    pub address: String,
    pub class_hash: String,
    pub salt: String,
    pub constructor_calldata: Vec<String>,
    pub config: ArgentMultisigConfig,
    pub signer_guids: Vec<String>,
}

fn invalid(reason: &str) -> CoreError {
    CoreError::InvalidInput {
        reason: reason.into(),
    }
}

/// The pinned Argent Multisig 0.2 class hash, spelled exactly as the extension stores it.
pub fn class_hash() -> &'static str {
    &multisig_constants::get().argent_multisig.class_hash
}

fn class_hash_felt() -> Felt {
    felt::parse(class_hash()).expect("pinned class hash is a felt")
}

/// `argentSignerGuid`: `poseidon(short_string("Starknet Signer"), publicKey)`.
pub fn signer_guid(public_key: &Felt) -> Result<Felt, CoreError> {
    if *public_key == Felt::ZERO {
        return Err(invalid("invalid signer public key"));
    }
    let prefix =
        krusty_kms::encode_short_string("Starknet Signer").map_err(|_| CoreError::Kms {
            operation: "signer guid".into(),
        })?;
    let guid = Poseidon::hash(&prefix, public_key);
    if guid == Felt::ZERO {
        return Err(invalid("invalid signer guid"));
    }
    Ok(guid)
}

/// `argentSignerGuid` over the extension's felt spelling.
pub fn signer_guid_hex(public_key: &str) -> Result<String, CoreError> {
    let key =
        felt::parse_non_zero(public_key).ok_or_else(|| invalid("invalid signer public key"))?;
    Ok(felt::canonical(&signer_guid(&key)?))
}

/// `normalizeArgentMultisigConfig`: 1..=32 unique non-zero keys (and unique GUIDs), a threshold in
/// `1..=n`, keys canonicalised and sorted by GUID.
pub fn normalize(
    config: &ArgentMultisigConfig,
) -> Result<(ArgentMultisigConfig, Vec<Felt>), CoreError> {
    let count = config.signer_public_keys.len();
    let max = multisig_constants::get().limits.signers;
    if config.threshold < 1 || count < 1 || count > max || config.threshold as usize > count {
        return Err(invalid("invalid multisig threshold or signer count"));
    }
    let mut signers = config
        .signer_public_keys
        .iter()
        .map(|key| {
            let key =
                felt::parse_non_zero(key).ok_or_else(|| invalid("invalid signer public key"))?;
            Ok((signer_guid(&key)?, key))
        })
        .collect::<Result<Vec<(Felt, Felt)>, CoreError>>()?;
    signers.sort();
    if signers.windows(2).any(|pair| pair[0].1 == pair[1].1) {
        return Err(invalid("multisig signers must be unique"));
    }
    if signers.windows(2).any(|pair| pair[0].0 == pair[1].0) {
        return Err(invalid("multisig signer guids must be unique"));
    }
    let guids = signers.iter().map(|(guid, _)| *guid).collect();
    Ok((
        ArgentMultisigConfig {
            threshold: config.threshold,
            signer_public_keys: signers
                .iter()
                .map(|(_, key)| felt::canonical(key))
                .collect(),
        },
        guids,
    ))
}

/// `argentMultisigConstructorCalldata`: `[threshold, n, 0, pk_0, 0, pk_1, …]` (decimal counts).
pub fn constructor_calldata(config: &ArgentMultisigConfig) -> Result<Vec<String>, CoreError> {
    let (normalized, _) = normalize(config)?;
    let mut calldata = vec![
        normalized.threshold.to_string(),
        normalized.signer_public_keys.len().to_string(),
    ];
    for key in &normalized.signer_public_keys {
        calldata.push("0".into());
        calldata.push(key.clone());
    }
    Ok(calldata)
}

fn calldata_felt(value: &str) -> Felt {
    if value.starts_with("0x") {
        felt::parse(value).expect("calldata keys are canonical felts")
    } else {
        Felt::from(value.parse::<u64>().expect("calldata counts are decimal"))
    }
}

/// `argentMultisigAddress` plus everything the Fund and Deploy review shows.
pub fn predict(
    config: &ArgentMultisigConfig,
    salt: &str,
) -> Result<ArgentMultisigPrediction, CoreError> {
    let salt = felt::parse(salt).ok_or_else(|| invalid("invalid deployment salt"))?;
    let (normalized, guids) = normalize(config)?;
    let calldata = constructor_calldata(&normalized)?;
    let felts: Vec<Felt> = calldata.iter().map(|value| calldata_felt(value)).collect();
    let raw =
        krusty_kms::calculate_contract_address(&salt, &class_hash_felt(), &felts, &Felt::ZERO)
            .map_err(|_| CoreError::Kms {
                operation: "multisig address".into(),
            })?;
    let bound = address_bound();
    let address = if raw >= bound { raw - bound } else { raw };
    if address == Felt::ZERO {
        return Err(CoreError::Kms {
            operation: "multisig address".into(),
        });
    }
    Ok(ArgentMultisigPrediction {
        address: felt::canonical(&address),
        class_hash: class_hash().to_string(),
        salt: felt::canonical(&salt),
        constructor_calldata: calldata,
        config: normalized,
        signer_guids: guids.iter().map(felt::canonical).collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(threshold: u32, keys: &[&str]) -> ArgentMultisigConfig {
        ArgentMultisigConfig {
            threshold,
            signer_public_keys: keys.iter().map(|k| k.to_string()).collect(),
        }
    }

    #[test]
    fn rejects_what_the_extension_rejects() {
        for bad in [
            config(0, &["0x1"]),
            config(2, &["0x1"]),
            config(1, &[]),
            config(1, &["0x1", "0x1"]),
            config(1, &["0x0"]),
            config(1, &["0xABC"]),
        ] {
            assert!(normalize(&bad).is_err(), "{bad:?}");
        }
        let too_many: Vec<String> = (1..=33).map(|n| format!("0x{n:x}")).collect();
        let refs: Vec<&str> = too_many.iter().map(String::as_str).collect();
        assert!(normalize(&config(1, &refs)).is_err());
        assert!(normalize(&config(1, &refs[..32])).is_ok());
    }

    #[test]
    fn signers_sort_by_guid_and_calldata_uses_decimal_counts() {
        let (normalized, guids) = normalize(&config(2, &["0x456", "0x123"])).unwrap();
        assert!(guids[0] < guids[1]);
        let calldata = constructor_calldata(&normalized).unwrap();
        assert_eq!(calldata[..3], ["2".to_string(), "2".into(), "0".into()]);
        assert_eq!(calldata.len(), 6);
        let prediction = predict(&normalized, "0x0").unwrap();
        assert_eq!(prediction.salt, "0x0");
        assert_eq!(prediction.class_hash, class_hash());
        assert!(felt::parse_non_zero(&prediction.address).is_some());
    }
}
