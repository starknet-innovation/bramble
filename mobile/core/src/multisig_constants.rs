//! Multisig and Nostr coordination constants, embedded from `generated/multisig.json`, which
//! `scripts/generate-mobile-assets.ts` renders from the extension modules that own each value
//! (`MULTISIG_LIMITS`, `ARGENT_MULTISIG_CONTRACT`, `MULTISIG_NOSTR_RELAYS`, the Nostr bounds, the
//! relay socket limits, and the coordination lookbacks). Nothing here is restated by hand.

use std::sync::OnceLock;

use serde::Deserialize;
use wallet_core::accounts::multisig::ArgentMultisigClass;

const CONSTANTS_JSON: &str = include_str!("../generated/multisig.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArgentMultisig {
    pub class_hash: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Coordination {
    pub identifier: String,
    pub incremental_lookback_seconds: u64,
    pub max_checkpoints: usize,
    pub max_seen_event_ids: usize,
    pub max_sync_seconds: u64,
    pub sync_lookback_seconds: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Limits {
    pub multisigs: usize,
    pub name_length: usize,
    pub signers: usize,
    pub summary_length: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Nostr {
    pub max_application_data_bytes: usize,
    pub max_batch_items: usize,
    pub max_event_json_bytes: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Relays {
    pub defaults: Vec<String>,
    pub max_frame_bytes: usize,
    pub timeout_ms: u32,
}

/// Every constant in `generated/multisig.json`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Constants {
    pub argent_multisig: ArgentMultisig,
    pub card_network_ids: Vec<String>,
    pub coordination: Coordination,
    #[serde(rename = "generatedBy")]
    _generated_by: String,
    pub limits: Limits,
    pub nostr: Nostr,
    pub relays: Relays,
}

fn load() -> Constants {
    let constants: Constants =
        serde_json::from_str(CONSTANTS_JSON).expect("bundled multisig constants parse");
    assert!(
        crate::felt::parse_non_zero(&constants.argent_multisig.class_hash).is_some(),
        "pinned class hash is a felt"
    );
    assert!(
        !constants.relays.defaults.is_empty()
            && constants
                .relays
                .defaults
                .iter()
                .all(|url| url.starts_with("wss://")),
        "default relays are secure"
    );
    // `wallet_core::nostr` enforces these bounds with its own constants; the extension's values,
    // rendered here, are what they have to be.
    assert!(
        constants.nostr.max_event_json_bytes == wallet_core::nostr::MAX_EVENT_JSON_BYTES
            && constants.nostr.max_application_data_bytes
                == wallet_core::nostr::MAX_APPLICATION_DATA_BYTES
            && constants.nostr.max_batch_items == wallet_core::nostr::MAX_BATCH_ITEMS
            && constants.relays.max_frame_bytes == wallet_core::nostr::relay::MAX_RELAY_FRAME_BYTES,
        "the shared core's Nostr bounds are the extension's"
    );
    constants
}

/// The embedded constants, parsed and sanity-checked once.
pub fn get() -> &'static Constants {
    static CONSTANTS: OnceLock<Constants> = OnceLock::new();
    CONSTANTS.get_or_init(load)
}

/// Bramble's Argent Multisig class (`argentMultisig.classHash`, `limits.signers`), built once so
/// every caller of `wallet_core::accounts` passes the same value.
pub fn argent_multisig_class() -> &'static ArgentMultisigClass {
    static CLASS: OnceLock<ArgentMultisigClass> = OnceLock::new();
    CLASS.get_or_init(|| {
        let constants = get();
        ArgentMultisigClass::new(
            &constants.argent_multisig.class_hash,
            constants.limits.signers,
        )
        .expect("pinned multisig class is a non-zero felt with a signer limit")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constants_load_with_the_extension_values() {
        let c = get();
        assert_eq!(c.limits.signers, 32);
        assert_eq!(c.limits.name_length, 48);
        assert_eq!(c.nostr.max_batch_items, 50);
        assert_eq!(c.relays.max_frame_bytes, 140_000);
        assert_eq!(c.coordination.identifier, "bramble.multisig");
        assert!(c.card_network_ids.iter().any(|id| id == "SN_MAIN"));
    }
}
