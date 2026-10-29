//! The account catalog, embedded from `generated/accounts.json`, which
//! `scripts/generate-mobile-assets.ts` renders from the extension's `account-families.ts`,
//! `account-types.ts`, `parts.ts`, `groups.ts`, `recovery.ts` and `dom.ts`. There is no second
//! hand-written copy of a class hash, a nickname word, a group icon, or a recovery bound here.
//!
//! Constructor calldata is not read from this table: Krusty's `ArgentAccount` and
//! `BraavosAccount` own it, and a unit test proves both agree on every class.

use std::sync::OnceLock;

use serde::Deserialize;
use starknet_types_core::felt::Felt;

use crate::felt;

const CATALOG_JSON: &str = include_str!("../generated/accounts.json");

/// The account contract families the wallet can derive.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, uniffi::Enum)]
pub enum AccountFamily {
    OpenZeppelin,
    Argent,
    Braavos,
}

impl AccountFamily {
    /// The extension's `AccountContractType` spelling, used in stored records and selection keys.
    pub(crate) fn wire(self) -> &'static str {
        match self {
            Self::OpenZeppelin => "openzeppelin",
            Self::Argent => "argent",
            Self::Braavos => "braavos",
        }
    }

    pub(crate) fn from_wire(value: &str) -> Option<Self> {
        match value {
            "openzeppelin" => Some(Self::OpenZeppelin),
            "argent" => Some(Self::Argent),
            "braavos" => Some(Self::Braavos),
            _ => None,
        }
    }
}

/// One known account class, as the extension's `ACCOUNT_CLASSES` lists it. Read-only.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct AccountClassInfo {
    pub family: AccountFamily,
    /// Canonical class hash.
    pub class_hash: String,
    /// Diagnostic label, e.g. "argent 0.3.1"; never parsed.
    pub label: String,
    /// `knownAccountType`, e.g. "Ready Account (Argent 0.3.1)"; None for implementation-only classes.
    pub type_label: Option<String>,
    pub deployment: bool,
    pub implementation: bool,
    /// "stark-pair" or "argent-signer-array".
    pub authorization_shape: String,
}

/// How long copy feedback lasts, from the extension's `dom.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Record)]
pub struct CopyFeedback {
    pub confirm_ms: u32,
    pub success_toast_ms: u32,
    pub error_toast_ms: u32,
}

/// Discovery bounds, the extension's `RECOVERY_SCAN_LIMITS`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecoveryLimits {
    pub batch_size: u32,
    pub default_count: u32,
    pub max_index: u32,
    /// Ceiling on indices one scan covers, so an endpoint that reports every probe deployed
    /// cannot extend the gap-limit walk forever.
    pub max_scanned_indexes: u32,
    pub max_selections: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawClass {
    authorization_shape: String,
    class_hash: String,
    constructor_shape: String,
    deployment: bool,
    family: String,
    implementation: bool,
    label: String,
    type_label: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawCopyFeedback {
    confirm_ms: u32,
    error_toast_ms: u32,
    success_toast_ms: u32,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawFamilyNames {
    argent: String,
    braavos: String,
    openzeppelin: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawOpenZeppelin {
    class_hash: String,
    type_label: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawBraavos {
    deployment_class_hash: String,
    implementation_class_hash: String,
    signing_class_hashes: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawCatalog {
    #[serde(rename = "generatedBy")]
    _generated_by: String,
    argent_default_class_hash: String,
    braavos: RawBraavos,
    classes: Vec<RawClass>,
    copy_feedback: RawCopyFeedback,
    family_names: RawFamilyNames,
    group_icons: Vec<String>,
    name_adjectives: Vec<String>,
    name_animals: Vec<String>,
    open_zeppelin: RawOpenZeppelin,
    recovery_limits: RecoveryLimits,
    reserved_agent_index: u32,
}

/// One class with its hash parsed.
#[derive(Debug, Clone)]
pub(crate) struct ClassEntry {
    pub family: AccountFamily,
    pub class_hash: Felt,
    pub constructor_shape: String,
    pub info: AccountClassInfo,
}

pub(crate) struct Catalog {
    pub classes: Vec<ClassEntry>,
    pub argent_default: Felt,
    /// `BRAAVOS_DEPLOYMENT_CLASS_HASH`: the one Braavos class this wallet deploys.
    pub braavos_deployment: Felt,
    /// `BRAAVOS_CURRENT_IMPLEMENTATION_CLASS_HASH`: what a Braavos deployment installs.
    pub braavos_implementation: Felt,
    /// `BRAAVOS_SIGNING_CLASS_HASHES`: the implementations a deployed Braavos account may run.
    pub braavos_signing: Vec<Felt>,
    pub open_zeppelin_class: Felt,
    pub open_zeppelin_type_label: Option<String>,
    pub family_names: [String; 3],
    pub adjectives: Vec<String>,
    pub animals: Vec<String>,
    pub group_icons: Vec<String>,
    pub limits: RecoveryLimits,
    /// strkd's agent account index (`RESERVED_AGENT_ACCOUNT_INDEX`, #336): never derived,
    /// scanned, restored or created.
    pub reserved_agent_index: u32,
    pub copy_feedback: CopyFeedback,
}

fn class_felt(value: &str) -> Felt {
    felt::parse_non_zero(value).expect("catalog class hash is a non-zero felt")
}

fn load() -> Catalog {
    let raw: RawCatalog =
        serde_json::from_str(CATALOG_JSON).expect("bundled account catalog parses");
    let classes = raw
        .classes
        .into_iter()
        .map(|class| {
            let family = AccountFamily::from_wire(&class.family)
                .filter(|family| *family != AccountFamily::OpenZeppelin)
                .expect("catalog classes are argent or braavos");
            let class_hash = class_felt(&class.class_hash);
            ClassEntry {
                family,
                class_hash,
                constructor_shape: class.constructor_shape,
                info: AccountClassInfo {
                    family,
                    class_hash: felt::canonical(&class_hash),
                    label: class.label,
                    type_label: class.type_label,
                    deployment: class.deployment,
                    implementation: class.implementation,
                    authorization_shape: class.authorization_shape,
                },
            }
        })
        .collect::<Vec<_>>();
    assert!(
        raw.name_adjectives.len() == 30 && raw.name_animals.len() == 30,
        "nickname lists hold 30 words each"
    );
    assert!(!raw.group_icons.is_empty(), "group icons exist");
    Catalog {
        classes,
        argent_default: class_felt(&raw.argent_default_class_hash),
        braavos_deployment: class_felt(&raw.braavos.deployment_class_hash),
        braavos_implementation: class_felt(&raw.braavos.implementation_class_hash),
        braavos_signing: raw
            .braavos
            .signing_class_hashes
            .iter()
            .map(|hash| class_felt(hash))
            .collect(),
        open_zeppelin_class: class_felt(&raw.open_zeppelin.class_hash),
        open_zeppelin_type_label: raw.open_zeppelin.type_label,
        family_names: [
            raw.family_names.openzeppelin,
            raw.family_names.argent,
            raw.family_names.braavos,
        ],
        adjectives: raw.name_adjectives,
        animals: raw.name_animals,
        group_icons: raw.group_icons,
        limits: raw.recovery_limits,
        reserved_agent_index: raw.reserved_agent_index,
        copy_feedback: CopyFeedback {
            confirm_ms: raw.copy_feedback.confirm_ms,
            success_toast_ms: raw.copy_feedback.success_toast_ms,
            error_toast_ms: raw.copy_feedback.error_toast_ms,
        },
    }
}

/// The catalog, validated once on first use.
pub(crate) fn catalog() -> &'static Catalog {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    CATALOG.get_or_init(load)
}

/// Classes an account of `family` can have been deployed with, in the extension's table order.
pub(crate) fn deployment_classes(
    family: AccountFamily,
) -> impl Iterator<Item = &'static ClassEntry> {
    catalog()
        .classes
        .iter()
        .filter(move |entry| entry.family == family && entry.info.deployment)
}

/// The catalog entry for a class hash, if known.
pub(crate) fn class_entry(class_hash: &Felt) -> Option<&'static ClassEntry> {
    catalog()
        .classes
        .iter()
        .find(|entry| entry.class_hash == *class_hash)
}

/// `knownAccountType` for a stored class.
pub(crate) fn type_label(family: AccountFamily, class_hash: &Felt) -> Option<String> {
    if family == AccountFamily::OpenZeppelin {
        return (catalog().open_zeppelin_class == *class_hash)
            .then(|| catalog().open_zeppelin_type_label.clone())
            .flatten();
    }
    class_entry(class_hash).and_then(|entry| entry.info.type_label.clone())
}

/// How a class expects a transaction to be authorised. OpenZeppelin is a bare `(r, s)`.
pub(crate) fn authorization_shape(family: AccountFamily, class_hash: &Felt) -> String {
    match family {
        AccountFamily::OpenZeppelin => "stark-pair".into(),
        _ => class_entry(class_hash)
            .map(|entry| entry.info.authorization_shape.clone())
            .unwrap_or_else(|| "stark-pair".into()),
    }
}

/// `accountFamilyName`: "Bramble", "Ready", or "Braavos".
#[uniffi::export]
pub fn account_family_name(family: AccountFamily) -> String {
    let names = &catalog().family_names;
    match family {
        AccountFamily::OpenZeppelin => names[0].clone(),
        AccountFamily::Argent => names[1].clone(),
        AccountFamily::Braavos => names[2].clone(),
    }
}

/// Every known Argent and Braavos class, in the extension's table order.
#[uniffi::export]
pub fn account_classes() -> Vec<AccountClassInfo> {
    catalog()
        .classes
        .iter()
        .map(|entry| entry.info.clone())
        .collect()
}

/// The icons a group may carry, the extension's `GROUP_ICONS`.
#[uniffi::export]
pub fn group_icons() -> Vec<String> {
    catalog().group_icons.clone()
}

/// Copy-feedback timings, from the extension's `dom.ts`.
#[uniffi::export]
pub fn copy_feedback() -> CopyFeedback {
    catalog().copy_feedback
}

/// Discovery bounds, the extension's `RECOVERY_SCAN_LIMITS`.
#[uniffi::export]
pub fn recovery_limits() -> RecoveryLimits {
    catalog().limits
}

#[cfg(test)]
mod tests {
    use super::*;
    use krusty_kms::{AccountClass, ArgentAccount, ArgentConstructorLayout, BraavosAccount};

    #[test]
    fn krusty_constructors_agree_with_the_extension_table() {
        let key = Felt::from(42u64);
        for entry in deployment_classes(AccountFamily::Argent) {
            let layout = ArgentAccount::layout_for_class_hash(&entry.class_hash)
                .expect("krusty knows every Argent deployment class");
            let expected = match entry.constructor_shape.as_str() {
                "owner-guardian" => ArgentConstructorLayout::OwnerGuardianFelts,
                "signer-owner-guardian-option" => {
                    ArgentConstructorLayout::SignerWithOptionalGuardian
                }
                other => panic!("unexpected Argent shape {other}"),
            };
            assert_eq!(layout, expected, "{}", entry.info.label);
        }
        for entry in deployment_classes(AccountFamily::Braavos) {
            assert_eq!(entry.constructor_shape, "public-key");
            let braavos = BraavosAccount::with_class_hash(entry.class_hash);
            assert_eq!(braavos.build_constructor_calldata(&key), vec![key]);
        }
    }

    #[test]
    fn open_zeppelin_class_is_krustys_on_every_network() {
        for chain in [
            krusty_kms_common::ChainId::Mainnet,
            krusty_kms_common::ChainId::Sepolia,
        ] {
            assert_eq!(
                crate::kms::oz_class_hash(chain).unwrap(),
                catalog().open_zeppelin_class
            );
        }
    }

    #[test]
    fn families_and_labels() {
        assert_eq!(account_family_name(AccountFamily::OpenZeppelin), "Bramble");
        assert_eq!(account_family_name(AccountFamily::Argent), "Ready");
        assert_eq!(deployment_classes(AccountFamily::Argent).count(), 3);
        assert_eq!(deployment_classes(AccountFamily::Braavos).count(), 2);
        assert_eq!(
            type_label(AccountFamily::Argent, &catalog().argent_default).as_deref(),
            Some("Ready Account (Argent)")
        );
        assert_eq!(recovery_limits().max_selections, 40);
        assert_eq!(copy_feedback().confirm_ms, 1400);
    }
}
