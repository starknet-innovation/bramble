//! The mobile core reproduces the extension's account rules bit for bit.
//! `tests/fixtures/accounts-parity-{families,rules}.json` are written by `bun run mobile:parity` from the extension's
//! own code (`deriveAccount` over the real Krusty WASM package, `accountDisplayName`,
//! `accountLabel`, `isLabel`, `createGroup`, and the discovery row helpers), and
//! `tests/conformance/mobile-accounts-parity.test.ts` keeps it in step with the extension.

mod common;

use std::collections::BTreeMap;

use bramble_core::testing::recovery_candidate;
use bramble_core::{
    account_display_name, account_label, is_account_label, AccountFamily, Ladder, NetworkId,
    RecoverySelection,
};
use serde_json::Value;

/// The derivation vectors, committed one file per network and read here as one set.
/// The phrase comes from the mainnet file; `split_family_fixtures_agree_on_the_phrase` checks
/// the sepolia file carries the same mnemonic and passphrase.
fn families() -> Value {
    let mut whole: Value = serde_json::from_str(include_str!(
        "fixtures/accounts-parity-families-mainnet.json"
    ))
    .unwrap();
    let sepolia: Value = serde_json::from_str(include_str!(
        "fixtures/accounts-parity-families-sepolia.json"
    ))
    .unwrap();
    let more = sepolia["vectors"].as_array().unwrap().clone();
    whole["vectors"].as_array_mut().unwrap().extend(more);
    whole
}

#[test]
fn split_family_fixtures_agree_on_the_phrase() {
    let mainnet: Value = serde_json::from_str(include_str!(
        "fixtures/accounts-parity-families-mainnet.json"
    ))
    .unwrap();
    let sepolia: Value = serde_json::from_str(include_str!(
        "fixtures/accounts-parity-families-sepolia.json"
    ))
    .unwrap();
    assert_eq!(mainnet["mnemonic"], sepolia["mnemonic"]);
    assert_eq!(mainnet["passphrase"], sepolia["passphrase"]);
}

fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/accounts-parity-rules.json")).unwrap()
}

fn family(value: &Value) -> AccountFamily {
    match value.as_str().unwrap() {
        "openzeppelin" => AccountFamily::OpenZeppelin,
        "argent" => AccountFamily::Argent,
        "braavos" => AccountFamily::Braavos,
        other => panic!("unexpected family {other}"),
    }
}

/// The ladder a vector was derived on: the extension's kind, with Braavos's `starknet-bip44`
/// always on Braavos's address axis (`bip44Axes`).
fn ladder(vector: &Value) -> Ladder {
    match (
        vector["derivation"].as_str().unwrap(),
        vector["accountContractType"].as_str().unwrap(),
    ) {
        ("argentx-bip44", "argent") => Ladder::ArgentX,
        ("starknet-bip44", "braavos") => Ladder::Address,
        ("starknet-bip44", _) => Ladder::Account,
        other => panic!("unexpected derivation {other:?}"),
    }
}

fn network(value: &Value) -> NetworkId {
    match value.as_str().unwrap() {
        "SN_MAIN" => NetworkId::Mainnet,
        "SN_SEPOLIA" => NetworkId::Sepolia,
        other => panic!("unexpected network {other}"),
    }
}

fn text(value: &Value) -> String {
    value.as_str().unwrap().to_string()
}

#[test]
fn every_family_and_class_derives_the_extensions_address() {
    let fixture = families();
    // Group vectors by (network, passphrase): each group is one restore on one vault.
    let mut groups: BTreeMap<(String, Option<String>), Vec<&Value>> = BTreeMap::new();
    for vector in fixture["vectors"].as_array().unwrap() {
        let key = (
            text(&vector["networkId"]),
            vector["passphrase"].as_str().map(str::to_string),
        );
        groups.entry(key).or_default().push(vector);
    }
    assert_eq!(groups.len(), 3);
    for ((net, passphrase), vectors) in groups {
        let (_dir, _clock, core) = common::core();
        core.import_wallet(
            "parity password".into(),
            text(&fixture["mnemonic"]),
            passphrase.clone(),
        )
        .unwrap();
        let selections = vectors
            .iter()
            .map(|vector| RecoverySelection {
                family: family(&vector["accountContractType"]),
                account_index: u32::try_from(vector["accountIndex"].as_u64().unwrap()).unwrap(),
                ladder: Some(ladder(vector)),
                class_hash: vector["requestedClassHash"].as_str().map(str::to_string),
            })
            .collect();
        let records = core
            .restore_recovered_accounts(network(&Value::String(net.clone())), selections)
            .unwrap();
        for (record, vector) in records.iter().zip(&vectors) {
            let context = format!("{net} {passphrase:?} {}", vector["accountIndex"]);
            assert_eq!(
                record.address,
                text(&vector["address"]),
                "address {context}"
            );
            assert_eq!(record.public_key, text(&vector["publicKeyX"]), "{context}");
            assert_eq!(record.class_hash, text(&vector["classHash"]), "{context}");
            assert_eq!(
                record.deployment_salt.as_deref(),
                vector["deploymentSalt"].as_str(),
                "{context}"
            );
            assert_eq!(record.id, format!("{net}:{}", record.address));
        }
    }
}

#[test]
fn names_and_truncation_match() {
    for case in fixture()["names"].as_array().unwrap() {
        let address = text(&case["address"]);
        assert_eq!(
            account_display_name(address.clone(), None),
            text(&case["name"]),
            "{address:?}"
        );
        assert_eq!(
            account_label(address.clone()),
            text(&case["short"]),
            "{address:?}"
        );
    }
}

#[test]
fn labels_normalise_like_the_preferences_store() {
    let (_dir, _clock, core) = common::pending();
    let record = core
        .restore_recovered_accounts(NetworkId::Sepolia, vec![common::oz(0)])
        .unwrap()
        .remove(0);
    for case in fixture()["labels"].as_array().unwrap() {
        let value = text(&case["value"]);
        let valid = case["valid"].as_bool().unwrap();
        assert_eq!(is_account_label(value.clone()), valid, "{value:?}");
        let stored = core.set_account_label(record.id.clone(), value.clone());
        match case["stored"].as_str() {
            Some(expected) => assert_eq!(stored.unwrap().as_deref(), Some(expected)),
            // Invalid text is refused unless it trims to nothing, which clears the label.
            None if value.trim().is_empty() => assert_eq!(stored.unwrap(), None),
            None => assert!(stored.is_err(), "{value:?}"),
        }
    }
}

#[test]
fn group_ids_follow_create_group() {
    let (_dir, _clock, core) = common::pending();
    core.restore_recovered_accounts(NetworkId::Sepolia, vec![common::oz(0)])
        .unwrap();
    for case in fixture()["groups"].as_array().unwrap() {
        let created = core.create_account_group(text(&case["name"]), "folder".into());
        match case["id"].as_str() {
            Some(id) => {
                let group = created.unwrap();
                assert_eq!(group.id, id);
                assert_eq!(group.name, text(&case["storedName"]));
            }
            None => assert!(created.is_err(), "{:?}", case["name"]),
        }
    }
}

#[test]
fn discovery_rows_are_worded_like_the_extension() {
    let fixture = fixture();
    let vectors = fixture["recovery"].as_array().unwrap();
    assert!(!vectors.is_empty());
    for case in vectors {
        let row = recovery_candidate(
            family(&case["accountContractType"]),
            ladder(case),
            case["classHash"].as_str().unwrap(),
            u32::try_from(case["accountIndex"].as_u64().unwrap()).unwrap(),
            "0x1",
            case["deployed"].as_bool().unwrap(),
            case["funded"].as_bool().unwrap(),
        );
        assert_eq!(row.title, text(&case["title"]));
        assert_eq!(row.hint, text(&case["hint"]), "{}", row.title);
        assert_eq!(row.key, text(&case["key"]));
        assert_eq!(
            row.selectable,
            case["selectable"].as_bool().unwrap(),
            "{}",
            row.key
        );
    }
}

#[test]
fn the_nickname_of_a_real_account_is_never_account_one() {
    let (_dir, _clock, core) = common::core();
    core.create_wallet_on_network(common::PASSWORD.into(), 12, NetworkId::Sepolia)
        .unwrap();
    let record = core.active_account().unwrap().unwrap();
    assert!(!record.display_name.starts_with("Account"));
    assert_eq!(
        record.display_name,
        account_display_name(record.address.clone(), None)
    );
}
