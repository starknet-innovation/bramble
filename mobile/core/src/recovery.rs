//! Account discovery rules and restore, reproducing the extension's `onboarding-ops.ts`
//! (which shapes to scan, which candidates to keep), `recovery-account-ui.ts` (row titles, hints,
//! selectability), and `vault/src/service/recovery.ts` (selection checks and atomic restore).
//! The sans-IO scan that feeds these rules lives in `recovery_scan.rs`.
//!
//! The host supplies only coordinates, `(family, ladder, index, class)`, never an address or a
//! key: every restored record is re-derived here from the phrase.

use std::collections::{HashMap, HashSet};

use starknet_types_core::felt::Felt;

use crate::account_catalog::{catalog, class_entry, deployment_classes, AccountFamily};
use crate::account_names::short_label;
use crate::account_store::{is_usable_account_index, record_at, StoredAccount, VaultPayload};
use crate::kms::Ladder;
use crate::networks::NetworkId;
use crate::{felt, CoreError};

/// One discovered account, with the chain evidence behind it and its row wording.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct RecoveryCandidate {
    /// `recoverySelectionKey`: "type:derivation:class|default:index".
    pub key: String,
    pub family: AccountFamily,
    /// The key tree this candidate was found on; a selection passes it back unchanged.
    pub ladder: Ladder,
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
    /// The key tree `account_index` walks, from the candidate. Absent means the family's vendor
    /// ladder (`selectionDerivation`): Ready's for Argent, Braavos's for Braavos, this wallet's
    /// own for OpenZeppelin. Last, so positional foreign constructors keep their meaning.
    #[uniffi(default = None)]
    pub ladder: Option<Ladder>,
}

/// One scan shape: a family, the key tree it walks and, except for OpenZeppelin, the class.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Shape {
    pub family: AccountFamily,
    pub ladder: Ladder,
    pub class_hash: Option<Felt>,
}

/// `recoveryScanShapes` (issue 505): OZ on this wallet's ladder; Argent at the release it creates
/// on the same ladder, for accounts this wallet made; every Argent release on Ready's ladder; and
/// every Braavos class on Braavos's. Ready takes no BIP-39 passphrase, so a phrase opened with one
/// has no Ready accounts and `with_ready` drops those shapes rather than failing the scan.
pub(crate) fn scan_shapes(with_ready: bool) -> Vec<Shape> {
    let mut shapes = vec![
        Shape {
            family: AccountFamily::OpenZeppelin,
            ladder: Ladder::Account,
            class_hash: None,
        },
        Shape {
            family: AccountFamily::Argent,
            ladder: Ladder::Account,
            class_hash: Some(catalog().argent_default),
        },
    ];
    if with_ready {
        shapes.extend(
            deployment_classes(AccountFamily::Argent).map(|entry| Shape {
                family: AccountFamily::Argent,
                ladder: Ladder::ArgentX,
                class_hash: Some(entry.class_hash),
            }),
        );
    }
    shapes.extend(
        deployment_classes(AccountFamily::Braavos).map(|entry| Shape {
            family: AccountFamily::Braavos,
            ladder: Ladder::Address,
            class_hash: Some(entry.class_hash),
        }),
    );
    shapes
}

/// A candidate found by the scan, before it is worded for the UI.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Found {
    pub family: AccountFamily,
    pub ladder: Ladder,
    pub class_hash: Felt,
    pub account_index: u32,
    pub address: Felt,
    pub deployed: bool,
    pub funded: bool,
}

/// Whether this wallet would itself create an account at this class (`isCreatableCandidate`,
/// on its own ladder): its own OZ account, or Argent at the release it deploys. A vendor
/// coordinate with no history is never offered, so it can never mint an account here.
pub(crate) fn is_creatable(family: AccountFamily, path: Ladder, class_hash: &Felt) -> bool {
    path == Ladder::Account && deployable_here(family, class_hash)
}

/// Whether this wallet can deploy an account of this class (the UI's `deployableHere`), on any
/// ladder: a funded Ready account at the release Bramble deploys is ready to deploy.
fn deployable_here(family: AccountFamily, class_hash: &Felt) -> bool {
    family == AccountFamily::OpenZeppelin
        || (family == AccountFamily::Argent && *class_hash == catalog().argent_default)
}

/// Whether the scan keeps a candidate: on-chain evidence, or a creatable account at index 0 or at
/// a manually checked index.
pub(crate) fn keep(found: &Found, manual: bool) -> bool {
    found.deployed
        || found.funded
        || (is_creatable(found.family, found.ladder, &found.class_hash)
            && (found.account_index == 0 || manual))
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
        if deployable_here(found.family, &found.class_hash) {
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

fn selection_key(
    family: AccountFamily,
    path: Ladder,
    class_hash: Option<&Felt>,
    account_index: u32,
) -> String {
    let class = match (family, class_hash) {
        (AccountFamily::OpenZeppelin, _) => "default".to_string(),
        (_, Some(class_hash)) => felt::canonical(class_hash),
        (_, None) => felt::canonical(&catalog().argent_default),
    };
    format!("{}:{}:{class}:{account_index}", family.wire(), path.kind())
}

/// The ladder a selection restores on (`selectionDerivation`, with `hasSelectableDerivation`):
/// the family's vendor ladder when none is named. Only Argent exists on two ladders. Braavos is
/// restored only on its vendor's; an earlier scan's own-ladder Braavos records stay valid in the
/// vault, but no new one is made.
fn selection_path(selection: &RecoverySelection) -> Result<Ladder, CoreError> {
    let default = match selection.family {
        AccountFamily::OpenZeppelin => Ladder::Account,
        AccountFamily::Argent => Ladder::ArgentX,
        AccountFamily::Braavos => Ladder::Address,
    };
    let path = selection.ladder.unwrap_or(default);
    let allowed =
        path == default || (selection.family == AccountFamily::Argent && path == Ladder::Account);
    if !allowed {
        return Err(invalid("invalid recovery account selection"));
    }
    Ok(path)
}

/// Words one found account for the discovery screen.
pub(crate) fn candidate(found: &Found) -> RecoveryCandidate {
    let address = felt::canonical(&found.address);
    let class_hash = (found.family != AccountFamily::OpenZeppelin).then_some(&found.class_hash);
    RecoveryCandidate {
        key: selection_key(found.family, found.ladder, class_hash, found.account_index),
        family: found.family,
        ladder: found.ladder,
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
    let mut public_keys: HashMap<(Ladder, u32), Felt> = HashMap::new();
    let mut records = Vec::with_capacity(selections.len());
    for selection in selections {
        if !is_usable_account_index(selection.account_index) {
            return Err(invalid("invalid recovery account selection"));
        }
        let class_hash = selection_class(selection)?;
        let path = selection_path(selection)?;
        let key = selection_key(
            selection.family,
            path,
            class_hash.as_ref(),
            selection.account_index,
        );
        if !keys.insert(key) {
            return Err(invalid("duplicate recovery account selection"));
        }
        let coordinate = (path, selection.account_index);
        let public_key = match public_keys.get(&coordinate) {
            Some(key) => *key,
            None => {
                let key = payload.public_key(path, selection.account_index)?;
                public_keys.insert(coordinate, key);
                key
            }
        };
        records.push(record_at(
            selection.family,
            path,
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
            ladder: if family == AccountFamily::Braavos {
                Ladder::Address
            } else {
                Ladder::Account
            },
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
        // Ready's ladder never offers an account this wallet would create.
        let mut ready = found(AccountFamily::Argent, argent, 0);
        ready.ladder = Ladder::ArgentX;
        assert!(!keep(&ready, true));
    }

    #[test]
    fn scan_walks_each_familys_ladder_in_extension_order() {
        let argent = deployment_classes(AccountFamily::Argent).count();
        let braavos = deployment_classes(AccountFamily::Braavos).count();
        let shapes = scan_shapes(true);
        assert_eq!(shapes.len(), 2 + argent + braavos);
        assert_eq!(
            (shapes[0].family, shapes[0].ladder),
            (AccountFamily::OpenZeppelin, Ladder::Account)
        );
        assert_eq!(
            (shapes[1].ladder, shapes[1].class_hash),
            (Ladder::Account, Some(catalog().argent_default))
        );
        assert!(shapes[2..2 + argent]
            .iter()
            .all(|s| s.ladder == Ladder::ArgentX));
        assert!(shapes[2 + argent..]
            .iter()
            .all(|s| s.ladder == Ladder::Address));
        // A passphrase-protected phrase has no Ready accounts.
        assert_eq!(scan_shapes(false).len(), 2 + braavos);
    }

    #[test]
    fn selections_default_to_each_familys_vendor_ladder() {
        let pick = |family, ladder| RecoverySelection {
            family,
            account_index: 1,
            ladder,
            class_hash: None,
        };
        let path = |family, ladder| selection_path(&pick(family, ladder));
        assert_eq!(
            path(AccountFamily::OpenZeppelin, None).unwrap(),
            Ladder::Account
        );
        assert_eq!(path(AccountFamily::Argent, None).unwrap(), Ladder::ArgentX);
        assert_eq!(
            path(AccountFamily::Argent, Some(Ladder::Account)).unwrap(),
            Ladder::Account
        );
        assert_eq!(path(AccountFamily::Braavos, None).unwrap(), Ladder::Address);
        assert!(path(AccountFamily::OpenZeppelin, Some(Ladder::Address)).is_err());
        assert!(path(AccountFamily::Argent, Some(Ladder::Address)).is_err());
        assert!(path(AccountFamily::Braavos, Some(Ladder::Account)).is_err());
        assert!(path(AccountFamily::Braavos, Some(Ladder::ArgentX)).is_err());
    }
}
