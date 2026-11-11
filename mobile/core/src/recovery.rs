//! Account discovery rules and restore, reproducing the extension's `onboarding-ops.ts`
//! (which shapes to scan, which are creatable), `recovery-account-ui.ts` (row titles, hints,
//! selectability), and `vault/src/service/recovery.ts` (selection checks and atomic restore).
//! The scan itself, its candidates and its keep rule are `wallet_core::accounts::scan`;
//! `recovery_scan.rs` feeds it these rules.
//!
//! The host supplies only coordinates, `(family, ladder, index, class)`, never an address or a
//! key: every restored record is re-derived here from the phrase.

use std::collections::{HashMap, HashSet};

use starknet_types_core::felt::Felt;
use wallet_core::accounts::advisory::Restriction;
use wallet_core::accounts::scan::{Found, SaltRule, ScanShape};

use crate::account_address::{argent_shape, resolve_class};
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
    /// A warning on its own line in the danger colour (`privacyPoolCopy`): another wallet
    /// registered this account with the privacy pool. The row stays selectable.
    #[uniffi(default = None)]
    pub note: Option<String>,
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

/// `recoveryScanShapes` (issues 505, 734): OZ on this wallet's ladder; every Argent release on the
/// same ladder (accounts this wallet made, and Xverse's, which derive there); every Argent release
/// but Xverse's on Ready's ladder; and every Braavos class on Braavos's. Ready takes no BIP-39
/// passphrase, so a phrase opened with one has no Ready accounts and `with_ready` drops those
/// shapes rather than failing the scan. Each class goes through `resolve_class` (OZ's is Krusty's
/// on `network`), with the catalog's Argent layout, Bramble's salt (`0x0` for OZ, the public key
/// otherwise) and whether it is creatable.
pub(crate) fn scan_shapes(
    with_ready: bool,
    network: NetworkId,
) -> Result<Vec<ScanShape>, CoreError> {
    let mut coordinates = vec![(AccountFamily::OpenZeppelin, Ladder::Account, None)];
    coordinates.extend(deployment_classes(AccountFamily::Argent).map(|entry| {
        (
            AccountFamily::Argent,
            Ladder::Account,
            Some(entry.class_hash),
        )
    }));
    if with_ready {
        coordinates.extend(
            deployment_classes(AccountFamily::Argent)
                .filter(|entry| entry.class_hash != catalog().argent_xverse)
                .map(|entry| {
                    (
                        AccountFamily::Argent,
                        Ladder::ArgentX,
                        Some(entry.class_hash),
                    )
                }),
        );
    }
    coordinates.extend(deployment_classes(AccountFamily::Braavos).map(|entry| {
        (
            AccountFamily::Braavos,
            Ladder::Address,
            Some(entry.class_hash),
        )
    }));
    coordinates
        .into_iter()
        .map(|(family, ladder, class_hash)| {
            let class_hash = resolve_class(family, class_hash.as_ref(), network)?;
            Ok(ScanShape {
                family,
                ladder,
                class_hash,
                argent_shape: argent_shape(family, &class_hash)?,
                salt: if family == AccountFamily::OpenZeppelin {
                    SaltRule::Zero
                } else {
                    SaltRule::PublicKey
                },
                creatable: is_creatable(family, ladder, &class_hash),
            })
        })
        .collect()
}

/// `RESTRICTION_COPY`.
fn restriction_copy(restriction: Restriction) -> &'static str {
    match restriction {
        Restriction::Guardian => "has a guardian",
        Restriction::OwnerChanged => "owner key changed",
        Restriction::OwnerType => "unsupported signer",
        Restriction::Release => "unsupported release",
        Restriction::StrongSigner => "2FA active",
    }
}

/// Whether the scan lists this coordinate with no history (`isCreatableCandidate`, on each
/// family's own ladder): this wallet's OZ account, Argent at the release it deploys, or Braavos at
/// the class the current Braavos app deploys (issue 718). The Braavos row is listed view only:
/// `selectable` still requires history, so nothing here mints a vendor account.
pub(crate) fn is_creatable(family: AccountFamily, path: Ladder, class_hash: &Felt) -> bool {
    match family {
        AccountFamily::OpenZeppelin => path == Ladder::Account,
        AccountFamily::Argent => path == Ladder::Account && *class_hash == catalog().argent_default,
        AccountFamily::Braavos => {
            path == Ladder::Address && *class_hash == catalog().braavos_deployment
        }
    }
}

/// Whether this wallet can deploy an account of this class (the UI's `deployableHere`), on any
/// ladder: a funded Ready account at the release Bramble deploys or at Xverse's build of it, or a
/// Braavos one at the modern deployment class, is ready to deploy.
fn deployable_here(family: AccountFamily, class_hash: &Felt) -> bool {
    match family {
        AccountFamily::OpenZeppelin => true,
        AccountFamily::Argent => {
            *class_hash == catalog().argent_default || *class_hash == catalog().argent_xverse
        }
        AccountFamily::Braavos => *class_hash == catalog().braavos_deployment,
    }
}

/// `candidateName`: `Account N`, with the Argent release when it is not the one Bramble creates.
fn name(found: &Found) -> String {
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

/// `candidateTitle`: the name plus the key ladder, so rows sharing an index are told apart.
fn title(found: &Found) -> String {
    if found.ladder == Ladder::ArgentX {
        format!("{} · Ready extension", name(found))
    } else {
        name(found)
    }
}

fn hint(found: &Found) -> String {
    // `candidateState`: a funded, undeployed Braavos account deploys from here at the modern
    // deployment class; an older base-class counterfactual still cannot.
    if found.family == AccountFamily::Braavos && !found.deployed && found.funded {
        return if deployable_here(found.family, &found.class_hash) {
            "Funded and ready to deploy"
        } else {
            "Funded, not deployed · view only for now"
        }
        .into();
    }
    // `activityState`, whose deployed branch is `deployedState`.
    if found.deployed {
        return match found.restriction {
            Some(restriction) => {
                format!(
                    "Deployed on Starknet · {} · view only",
                    restriction_copy(restriction)
                )
            }
            None => "Deployed on Starknet".into(),
        };
    }
    let text = if found.funded {
        if deployable_here(found.family, &found.class_hash) {
            "Funded and ready to deploy"
        } else {
            "Funded on Starknet — Bramble cannot deploy this Argent release"
        }
    } else if found.family == AccountFamily::Argent {
        "No on-chain activity found — Bramble only imports existing Ready accounts"
    } else if found.family == AccountFamily::Braavos {
        "No on-chain activity found — Bramble only imports existing Braavos accounts"
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
        note: found
            .privacy_elsewhere
            .then(|| privacy_pool_note(found.family)),
    }
}

/// `privacyPoolCopy`: the Ready group names Ready; the check only knows the key is not this
/// wallet's, so other groups say "another wallet".
fn privacy_pool_note(family: AccountFamily) -> String {
    let wallet = if family == AccountFamily::Argent {
        "Ready"
    } else {
        "another wallet"
    };
    format!("Private balances off · privacy previously set up in {wallet} and cannot be imported to Bramble")
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
#[path = "recovery_tests.rs"]
mod tests;
