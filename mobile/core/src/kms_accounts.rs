//! Account-family derivation through Krusty KMS, beside `kms.rs` (the other Krusty caller).
//! Mirrors the extension's `deriveAccountContractAddress`: OpenZeppelin through Krusty's own OZ
//! derivation (salt `0x0`, class per network); Argent and Braavos through Krusty's
//! `ArgentAccount` / `BraavosAccount` presets at a class from the generated catalog, with the
//! public key as the default salt. Every output is re-checked before it leaves.
//!
//! The signing key is derived per call into a zeroizing `SecretFelt`, turned into its public key,
//! and dropped here; nothing secret is returned.

use krusty_kms::{
    AccountClass, ArgentAccount, ArgentConstructorLayout, BraavosAccount, SaltPolicy,
};
use krusty_kms_common::ChainId;
use starknet_types_core::felt::Felt;

use crate::account_catalog::{catalog, class_entry, deployment_classes, AccountFamily};
use crate::kms::{self, kms_error};
use crate::CoreError;

/// Public outputs of placing one signer key under one account family and class.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FamilyAddress {
    pub address: Felt,
    pub class_hash: Felt,
    pub deployment_salt: Option<Felt>,
}

fn invalid(reason: &str) -> CoreError {
    CoreError::InvalidInput {
        reason: reason.into(),
    }
}

fn checked(value: Felt, operation: &str) -> Result<Felt, CoreError> {
    if value == Felt::ZERO {
        return Err(CoreError::Kms {
            operation: operation.into(),
        });
    }
    Ok(value)
}

/// The account public key at `m/44'/9004'/index'/0/0`, shared by every family at that index.
pub(crate) fn public_key(
    phrase: &str,
    passphrase: Option<&str>,
    account_index: u32,
) -> Result<Felt, CoreError> {
    let key = kms::private_key(phrase, passphrase, account_index)?;
    let public_key =
        krusty_kms::stark_public_key(key.expose_secret()).map_err(kms_error("public key"))?;
    checked(public_key, "public key")
}

/// Resolves the class an account of `family` derives from: Krusty's per-network OZ class; the
/// class this wallet creates for Argent when none is named; a named deployment class otherwise.
/// Braavos has no default, since this wallet never creates one.
pub(crate) fn resolve_class(
    family: AccountFamily,
    class_hash: Option<&Felt>,
    chain: ChainId,
) -> Result<Felt, CoreError> {
    match (family, class_hash) {
        (AccountFamily::OpenZeppelin, None) => kms::oz_class_hash(chain),
        (AccountFamily::OpenZeppelin, Some(_)) => Err(invalid("unknown account class")),
        (AccountFamily::Argent, None) => Ok(catalog().argent_default),
        (AccountFamily::Braavos, None) => Err(invalid("a Braavos account must name its class")),
        (_, Some(class_hash)) => deployment_classes(family)
            .find(|entry| entry.class_hash == *class_hash)
            .map(|entry| entry.class_hash)
            .ok_or_else(|| invalid("unknown account class")),
    }
}

/// Places `public_key` under `family` at `class_hash` (see `resolve_class`) with `salt` (Argent
/// and Braavos only; defaults to the public key), exactly as the extension derives the address.
pub(crate) fn family_address(
    family: AccountFamily,
    class_hash: Option<&Felt>,
    salt: Option<&Felt>,
    public_key: &Felt,
    chain: ChainId,
) -> Result<FamilyAddress, CoreError> {
    let class_hash = resolve_class(family, class_hash, chain)?;
    let (address, deployment_salt) = match family {
        AccountFamily::OpenZeppelin => {
            if salt.is_some() {
                return Err(invalid("OpenZeppelin accounts do not take a salt"));
            }
            let address =
                krusty_kms::derive_oz_account_address(public_key, &class_hash, Some(&Felt::ZERO))
                    .map_err(kms_error("address"))?;
            (address, None)
        }
        AccountFamily::Argent | AccountFamily::Braavos => {
            let salt = *salt.unwrap_or(public_key);
            let (preset, krusty_shape): (Box<dyn AccountClass>, &str) =
                if family == AccountFamily::Argent {
                    let argent = ArgentAccount::try_with_class_hash(class_hash)
                        .map_err(kms_error("class hash"))?;
                    let shape = match argent.constructor_layout() {
                        ArgentConstructorLayout::OwnerGuardianFelts => "owner-guardian",
                        ArgentConstructorLayout::SignerWithOptionalGuardian => {
                            "signer-owner-guardian-option"
                        }
                    };
                    (Box::new(argent), shape)
                } else {
                    (
                        Box::new(BraavosAccount::with_class_hash(class_hash)),
                        "public-key",
                    )
                };
            // Krusty builds the calldata; the extension's table says what it must be. A
            // disagreement would be a plausible address that matches nothing, so fail closed.
            if class_entry(&class_hash).map(|entry| entry.constructor_shape.as_str())
                != Some(krusty_shape)
            {
                return Err(CoreError::Kms {
                    operation: "class hash".into(),
                });
            }
            let address = preset
                .calculate_address(public_key, SaltPolicy::Explicit(salt))
                .map_err(kms_error("address"))?;
            (address, Some(salt))
        }
    };
    Ok(FamilyAddress {
        address: checked(address, "address")?,
        class_hash,
        deployment_salt,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn class_rules_follow_the_extension() {
        let argent = catalog().argent_default;
        assert!(resolve_class(AccountFamily::Braavos, None, ChainId::Mainnet).is_err());
        assert!(
            resolve_class(AccountFamily::OpenZeppelin, Some(&argent), ChainId::Mainnet).is_err()
        );
        assert!(resolve_class(AccountFamily::Braavos, Some(&argent), ChainId::Mainnet).is_err());
        assert_eq!(
            resolve_class(AccountFamily::Argent, None, ChainId::Sepolia).unwrap(),
            argent
        );
        let key = Felt::from(7u64);
        assert!(family_address(
            AccountFamily::OpenZeppelin,
            None,
            Some(&key),
            &key,
            ChainId::Sepolia
        )
        .is_err());
        let placed =
            family_address(AccountFamily::Argent, None, None, &key, ChainId::Sepolia).unwrap();
        assert_eq!(placed.deployment_salt, Some(key));
    }
}
