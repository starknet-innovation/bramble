//! Account discovery rules and restore, reproducing the extension's `onboarding-ops.ts`
//! (which shapes to scan, which candidates to keep), `recovery-account-ui.ts` (row titles, hints,
//! selectability), and `vault/src/service/recovery.ts` (selection checks and atomic restore).
//! The sans-IO scan that feeds these rules lives in `recovery_scan.rs`.
//!
//! The host supplies only coordinates, `(family, index, class)`, never an address or a key: every
//! restored record is re-derived here from the phrase.

use std::collections::{HashMap, HashSet};

use starknet_types_core::felt::Felt;

use crate::account_catalog::{catalog, class_entry, deployment_classes, AccountFamily};
use crate::account_names::short_label;
use crate::account_store::{is_usable_account_index, record_at, StoredAccount, VaultPayload};
use crate::networks::NetworkId;
use crate::{felt, CoreError};

/// One discovered account, with the chain evidence behind it and its row wording.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct RecoveryCandidate {
    /// `recoverySelectionKey`: "type:class|default:index".
    pub key: String,
    pub family: AccountFamily,
    pub class_hash: String,
    pub account_index: u32,
    pub address: String,
    pub short_address: String,
    pub title: String,
    pub hint: String,
    pub deployed: bool,
    pub funded: bool,
    pub selectable: bool,
    /// Deployed or funded: selected automatically the first time it is seen.
    pub auto_select: bool,
}

/// One coordinate the user picked to restore.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct RecoverySelection {
    pub family: AccountFamily,
    pub account_index: u32,
    /// Absent for OpenZeppelin; optional for Argent (the release this wallet creates); required
    /// for Braavos.
    pub class_hash: Option<String>,
}

/// One scan shape: a family and, except for OpenZeppelin, the deployment class.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Shape {
    pub family: AccountFamily,
    pub class_hash: Option<Felt>,
}

/// `recoveryScanShapes`: OZ, then every Argent and Braavos deployment class in table order.
pub(crate) fn scan_shapes() -> Vec<Shape> {
    let mut shapes = vec![Shape {
        family: AccountFamily::OpenZeppelin,
        class_hash: None,
    }];
    for family in [AccountFamily::Argent, AccountFamily::Braavos] {
        shapes.extend(deployment_classes(family).map(|entry| Shape {
            family,
            class_hash: Some(entry.class_hash),
        }));
    }
    shapes
}

/// A candidate found by the scan, before it is worded for the UI.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Found {
    pub family: AccountFamily,
    pub class_hash: Felt,
    pub account_index: u32,
    pub address: Felt,
    pub deployed: bool,
    pub funded: bool,
}

/// Whether this wallet would itself create an account at this class (`isCreatableCandidate`,
/// and the UI's `deployableHere`): its own OZ account, or Argent at the release it deploys.
pub(crate) fn is_creatable(family: AccountFamily, class_hash: &Felt) -> bool {
    family == AccountFamily::OpenZeppelin
        || (family == AccountFamily::Argent && *class_hash == catalog().argent_default)
}

/// Whether the scan keeps a candidate: on-chain evidence, or a creatable account at index 0 or at
/// a manually checked index.
pub(crate) fn keep(found: &Found, manual: bool) -> bool {
    found.deployed
        || found.funded
        || (is_creatable(found.family, &found.class_hash) && (found.account_index == 0 || manual))
}

fn title(found: &Found) -> String {
    let title = format!("Account {}", found.account_index);
    if found.family != AccountFamily::Argent || found.class_hash == catalog().argent_default {
        return title;
    }
    match class_entry(&found.class_hash) {
        Some(entry) => format!(
            "{title} · Argent {}",
            entry.info.label.trim_start_matches("argent ")
        ),
        None => title,
    }
}

fn hint(found: &Found) -> String {
    if found.family == AccountFamily::Braavos {
        let state = if found.deployed {
            "Deployed on Starknet"
        } else {
            "Funded, not deployed"
        };
        return format!("{state} · view only for now");
    }
    let text = if found.deployed {
        "Deployed on Starknet"
    } else if found.funded {
        if is_creatable(found.family, &found.class_hash) {
            "Funded and ready to deploy"
        } else {
            "Funded on Starknet — Bramble cannot deploy this Argent release"
        }
    } else if found.family == AccountFamily::Argent {
        "No on-chain activity found — Bramble only imports existing Ready accounts"
    } else {
        "No on-chain activity found"
    };
    text.into()
}

fn selection_key(family: AccountFamily, class_hash: Option<&Felt>, account_index: u32) -> String {
    let class = match (family, class_hash) {
        (AccountFamily::OpenZeppelin, _) => "default".to_string(),
        (_, Some(class_hash)) => felt::canonical(class_hash),
        (_, None) => felt::canonical(&catalog().argent_default),
    };
    format!("{}:{class}:{account_index}", family.wire())
}

/// Words one found account for the discovery screen.
pub(crate) fn candidate(found: &Found) -> RecoveryCandidate {
    let address = felt::canonical(&found.address);
    let class_hash = (found.family != AccountFamily::OpenZeppelin).then_some(&found.class_hash);
    RecoveryCandidate {
        key: selection_key(found.family, class_hash, found.account_index),
        family: found.family,
        class_hash: felt::canonical(&found.class_hash),
        account_index: found.account_index,
        short_address: short_label(&address),
        address,
        title: title(found),
        hint: hint(found),
        deployed: found.deployed,
        funded: found.funded,
        selectable: found.family == AccountFamily::OpenZeppelin || found.deployed || found.funded,
        auto_select: found.deployed || found.funded,
    }
}

fn invalid(reason: &str) -> CoreError {
    CoreError::InvalidInput {
        reason: reason.into(),
    }
}

// A selection's class, parsed and checked against its family (`hasSelectableClass`).
fn selection_class(selection: &RecoverySelection) -> Result<Option<Felt>, CoreError> {
    let class_hash = match &selection.class_hash {
        None if selection.family == AccountFamily::Braavos => {
            return Err(invalid("invalid recovery account selection"))
        }
        None => return Ok(None),
        Some(text) => {
            felt::parse(text).ok_or_else(|| invalid("invalid recovery account selection"))?
        }
    };
    let known = selection.family != AccountFamily::OpenZeppelin
        && deployment_classes(selection.family).any(|entry| entry.class_hash == class_hash);
    if !known {
        return Err(invalid("invalid recovery account selection"));
    }
    Ok(Some(class_hash))
}

/// Checks and re-derives a restore request (`recoverVaultAccounts`): 1-40 well-formed, distinct
/// coordinates whose derived addresses are distinct. Returns the records to commit; the caller
/// writes them in one vault write.
pub(crate) fn derive_selections(
    payload: &VaultPayload,
    network: NetworkId,
    selections: &[RecoverySelection],
) -> Result<Vec<StoredAccount>, CoreError> {
    let limit = catalog().limits.max_selections as usize;
    if selections.is_empty() || selections.len() > limit {
        return Err(invalid("invalid recovery account selection"));
    }
    let mut keys = HashSet::new();
    let mut public_keys: HashMap<u32, Felt> = HashMap::new();
    let mut records = Vec::with_capacity(selections.len());
    for selection in selections {
        if !is_usable_account_index(selection.account_index) {
            return Err(invalid("invalid recovery account selection"));
        }
        let class_hash = selection_class(selection)?;
        let key = selection_key(
            selection.family,
            class_hash.as_ref(),
            selection.account_index,
        );
        if !keys.insert(key) {
            return Err(invalid("duplicate recovery account selection"));
        }
        let public_key = match public_keys.get(&selection.account_index) {
            Some(key) => *key,
            None => {
                let key = payload.public_key(selection.account_index)?;
                public_keys.insert(selection.account_index, key);
                key
            }
        };
        records.push(record_at(
            selection.family,
            selection.account_index,
            class_hash.as_ref(),
            None,
            &public_key,
            network,
        )?);
    }
    let ids: HashSet<&str> = records.iter().map(|record| record.id.as_str()).collect();
    if ids.len() != records.len() {
        return Err(invalid("recovery accounts resolve to a duplicate address"));
    }
    Ok(records)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn found(family: AccountFamily, class_hash: Felt, index: u32) -> Found {
        Found {
            family,
            class_hash,
            account_index: index,
            address: Felt::from(99u64),
            deployed: false,
            funded: false,
        }
    }

    #[test]
    fn keep_rule_matches_onboarding_ops() {
        let oz = catalog().open_zeppelin_class;
        let argent = catalog().argent_default;
        let braavos = deployment_classes(AccountFamily::Braavos)
            .next()
            .unwrap()
            .class_hash;
        assert!(keep(&found(AccountFamily::OpenZeppelin, oz, 0), false));
        assert!(!keep(&found(AccountFamily::OpenZeppelin, oz, 3), false));
        assert!(keep(&found(AccountFamily::OpenZeppelin, oz, 3), true));
        assert!(keep(&found(AccountFamily::Argent, argent, 0), false));
        assert!(!keep(&found(AccountFamily::Braavos, braavos, 0), true));
        let mut funded = found(AccountFamily::Braavos, braavos, 7);
        funded.funded = true;
        assert!(keep(&funded, false));
    }

    #[test]
    fn scan_covers_six_shapes_in_extension_order() {
        let shapes = scan_shapes();
        assert_eq!(shapes.len(), 6);
        assert_eq!(shapes[0].family, AccountFamily::OpenZeppelin);
        assert_eq!(shapes[3].class_hash, Some(catalog().argent_default));
    }
}
