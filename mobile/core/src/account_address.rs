//! Bramble's choices for placing a key under an account family, over
//! `wallet_core::accounts::family_address` (the extension's `deriveAccountContractAddress`):
//! which class an account of each family has (`resolve_class`), the Argent constructor layout the
//! catalog gives that class, and the salt (`0x0` for OpenZeppelin, the public key otherwise).
//!
//! The core places any non-zero class it is given, so every class reaches it through
//! `resolve_class`: that is what refuses an Argent or Braavos class the catalog does not list.

use starknet_types_core::felt::Felt;
use wallet_core::accounts::{self, ArgentLayout, ArgentShape};

use crate::account_catalog::{catalog, class_entry, deployment_classes, AccountFamily};
use crate::kms;
use crate::networks::NetworkId;
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

fn unknown_class() -> CoreError {
    CoreError::Kms {
        operation: "class hash".into(),
    }
}

/// Resolves the class an account of `family` derives from: Krusty's per-network OZ class; the
/// class this wallet creates for Argent when none is named; a named deployment class otherwise.
/// Braavos has no default, since this wallet never creates one.
pub(crate) fn resolve_class(
    family: AccountFamily,
    class_hash: Option<&Felt>,
    network: NetworkId,
) -> Result<Felt, CoreError> {
    match (family, class_hash) {
        (AccountFamily::OpenZeppelin, None) => kms::oz_class_hash(network),
        (AccountFamily::OpenZeppelin, Some(_)) => Err(invalid("unknown account class")),
        (AccountFamily::Argent, None) => Ok(catalog().argent_default),
        (AccountFamily::Braavos, None) => Err(invalid("a Braavos account must name its class")),
        (_, Some(class_hash)) => deployment_classes(family)
            .find(|entry| entry.class_hash == *class_hash)
            .map(|entry| entry.class_hash)
            .ok_or_else(|| invalid("unknown account class")),
    }
}

/// The constructor layout the core places a `family` account at a resolved `class_hash` with:
/// for Argent, the layout the extension's table (`constructorShape`) gives the class, vouched
/// for as `Unlisted` only for Xverse's build, which Krusty does not list; none otherwise. A
/// Braavos class must be the table's `public-key` constructor.
pub(crate) fn argent_shape(
    family: AccountFamily,
    class_hash: &Felt,
) -> Result<Option<ArgentShape>, CoreError> {
    if family == AccountFamily::OpenZeppelin {
        return Ok(None);
    }
    let shape = class_entry(class_hash)
        .filter(|entry| entry.family == family)
        .map(|entry| entry.constructor_shape.as_str())
        .ok_or_else(unknown_class)?;
    if family == AccountFamily::Braavos {
        return if shape == "public-key" {
            Ok(None)
        } else {
            Err(unknown_class())
        };
    }
    let layout = ArgentLayout::from_wire(shape).ok_or_else(unknown_class)?;
    Ok(Some(if *class_hash == catalog().argent_xverse {
        ArgentShape::Unlisted(layout)
    } else {
        ArgentShape::Listed(layout)
    }))
}

/// Places `public_key` under `family` at `class_hash` (see `resolve_class`) with `salt` (Argent
/// and Braavos only; defaults to the public key), exactly as the extension derives the address.
pub(crate) fn family_address(
    family: AccountFamily,
    class_hash: Option<&Felt>,
    salt: Option<&Felt>,
    public_key: &Felt,
    network: NetworkId,
) -> Result<FamilyAddress, CoreError> {
    let class_hash = resolve_class(family, class_hash, network)?;
    let deployment_salt = match (family, salt) {
        (AccountFamily::OpenZeppelin, Some(_)) => {
            return Err(invalid("OpenZeppelin accounts do not take a salt"))
        }
        (AccountFamily::OpenZeppelin, None) => None,
        (_, salt) => Some(*salt.unwrap_or(public_key)),
    };
    let address = accounts::family_address(
        family,
        &class_hash,
        argent_shape(family, &class_hash)?,
        &deployment_salt.unwrap_or(Felt::ZERO),
        public_key,
    )?;
    Ok(FamilyAddress {
        address,
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
        assert!(resolve_class(AccountFamily::Braavos, None, NetworkId::Mainnet).is_err());
        assert!(resolve_class(
            AccountFamily::OpenZeppelin,
            Some(&argent),
            NetworkId::Mainnet
        )
        .is_err());
        assert!(resolve_class(AccountFamily::Braavos, Some(&argent), NetworkId::Mainnet).is_err());
        assert_eq!(
            resolve_class(AccountFamily::Argent, None, NetworkId::Sepolia).unwrap(),
            argent
        );
        let key = Felt::from(7u64);
        assert!(family_address(
            AccountFamily::OpenZeppelin,
            None,
            Some(&key),
            &key,
            NetworkId::Sepolia
        )
        .is_err());
        let placed =
            family_address(AccountFamily::Argent, None, None, &key, NetworkId::Sepolia).unwrap();
        assert_eq!(placed.deployment_salt, Some(key));
    }
}
