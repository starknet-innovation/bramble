//! The chain's own invariants: adjacency, determinism, each historical payload shape, and the
//! layouts each shape is accepted in. Vault files written by each branch are covered end to end
//! in `tests/migration.rs`.

use super::*;
use crate::container::{parse, Randomness, StoredVault};
use crate::kms::Ladder;
use crate::networks::NetworkId;
use crate::vault::SealingKey;

// The repository's published test phrase (tests/e2e/wallet-helpers.ts). Public test data.
const PHRASE: &str = "habit hope tip crystal because grunt nation idea electric witness alert like";

fn fixed_randomness() -> Randomness {
    Randomness {
        dek_iv: [1; 12],
        dek_commit: [2; 16],
        payload_iv: [3; 12],
        payload_commit: [4; 16],
    }
}

fn records_json(version: u32) -> Vec<u8> {
    let mut payload = VaultPayload::new(PHRASE.into(), None, Some(NetworkId::Sepolia)).unwrap();
    payload.version = version;
    if version < 4 {
        // `backupPending` exists from version 4 on.
        payload.backup_pending = None;
    }
    if version < 5 {
        // So does `ladder` from version 5.
        for record in &mut payload.accounts {
            record.ladder = None;
        }
    }
    payload.to_json().unwrap().to_vec()
}

fn records_value(version: u32) -> serde_json::Value {
    serde_json::from_slice(&records_json(version)).unwrap()
}

#[test]
fn steps_are_adjacent_and_end_at_the_current_version() {
    for (index, (from, _)) in VAULT_MIGRATIONS.iter().enumerate() {
        assert_eq!(*from, index as u32 + 1);
    }
    assert_eq!(VAULT_MIGRATIONS.len() as u32 + 1, VAULT_VERSION);
}

#[test]
fn a_count_payload_becomes_one_oz_record_per_index_per_network() {
    for version in [1, 2] {
        let (payload, migrated) =
            migrate(stage(&counted_json(version, 2, PHRASE)).unwrap()).unwrap();
        assert!(migrated);
        assert_eq!(payload.version, VAULT_VERSION);
        assert_eq!(
            payload.accounts.len(),
            4,
            "two indices on each of two networks"
        );
        assert!(payload
            .accounts
            .iter()
            .all(|record| record.family() == AccountFamily::OpenZeppelin));
        assert_eq!(payload.accounts[0].network(), NetworkId::Mainnet);
        assert_eq!(payload.accounts[0].account_index, 0);
        assert_eq!(
            payload.active_account_id.as_deref(),
            Some(payload.accounts[0].id.as_str())
        );
        assert!(!payload.recovery_pending);
        assert_eq!(payload.backup_pending, Some(false));
        assert!(payload.labels.is_empty() && payload.groups.is_empty());
    }
}

#[test]
fn the_accounts_branch_records_payload_is_retagged_unchanged() {
    let (payload, migrated) = migrate(stage(&records_json(2)).unwrap()).unwrap();
    assert!(migrated);
    let (current, _) = migrate(stage(&records_json(VAULT_VERSION)).unwrap()).unwrap();
    assert_eq!(payload.accounts, current.accounts);
    assert_eq!(payload.active_account_id, current.active_account_id);
}

#[test]
fn a_version_three_payload_gains_a_clear_backup_flag_and_nothing_else() {
    let (payload, migrated) = migrate(stage(&records_json(3)).unwrap()).unwrap();
    assert!(migrated);
    assert_eq!(payload.version, VAULT_VERSION);
    assert_eq!(
        payload.backup_pending,
        Some(false),
        "a v3 wallet is never re-prompted"
    );
    let v3 = records_value(3);
    let mut v4: serde_json::Value = serde_json::from_slice(&payload.to_json().unwrap()).unwrap();
    // The chain runs on to version 5, which only labels each record's ladder.
    for record in v4["accounts"].as_array_mut().unwrap() {
        record.as_object_mut().unwrap().remove("ladder");
    }
    assert!(v3.get("backupPending").is_none());
    assert_eq!(v4["backupPending"], false);
    for key in [
        "accounts",
        "activeAccountId",
        "groups",
        "labels",
        "mnemonic",
        "recoveryPending",
    ] {
        assert_eq!(v3[key], v4[key], "{key} is carried over unchanged");
    }
}

#[test]
fn a_version_four_payload_labels_every_record_on_its_own_ladder_and_nothing_else() {
    let (payload, migrated) = migrate(stage(&records_json(4)).unwrap()).unwrap();
    assert!(migrated);
    assert_eq!(payload.version, 5);
    assert!(payload
        .accounts
        .iter()
        .all(|record| record.ladder == Some(Ladder::Account)));
    let v4 = records_value(4);
    let v5: serde_json::Value = serde_json::from_slice(&payload.to_json().unwrap()).unwrap();
    assert!(v4["accounts"][0].get("ladder").is_none());
    assert_eq!(v5["accounts"][0]["ladder"], "account");
    let mut unlabelled = v5.clone();
    for record in unlabelled["accounts"].as_array_mut().unwrap() {
        record.as_object_mut().unwrap().remove("ladder");
    }
    assert_eq!(unlabelled["accounts"], v4["accounts"], "no record moves");
    for key in [
        "activeAccountId",
        "backupPending",
        "groups",
        "labels",
        "mnemonic",
    ] {
        assert_eq!(v4[key], v5[key], "{key} is carried over unchanged");
    }
}

// An earlier scan walked Braavos on this wallet's own ladder. Such a record keeps its address
// rather than moving to Braavos's ladder, where the same index is a different account.
#[test]
fn a_version_four_braavos_record_off_index_zero_keeps_its_address() {
    let mut payload = VaultPayload::new(PHRASE.into(), None, Some(NetworkId::Sepolia)).unwrap();
    let class = crate::account_catalog::deployment_classes(AccountFamily::Braavos)
        .next()
        .unwrap()
        .class_hash;
    let legacy = payload
        .derive(
            AccountFamily::Braavos,
            Ladder::Account,
            3,
            Some(&class),
            None,
            NetworkId::Sepolia,
        )
        .unwrap();
    let vendor = payload
        .derive(
            AccountFamily::Braavos,
            Ladder::Address,
            3,
            Some(&class),
            None,
            NetworkId::Sepolia,
        )
        .unwrap();
    assert_ne!(
        legacy.address, vendor.address,
        "the ladders differ off index zero"
    );
    payload.accounts.push(legacy.clone());
    payload.version = 4;
    for record in &mut payload.accounts {
        record.ladder = None;
    }
    let (migrated, _) = migrate(stage(&payload.to_json().unwrap()).unwrap()).unwrap();
    let kept = migrated.record(&legacy.id).expect("the record is kept");
    assert_eq!(kept.address, legacy.address);
    assert_eq!(kept.ladder, Some(Ladder::Account));
}

#[test]
fn a_created_payload_is_backup_pending_and_an_imported_one_is_not() {
    let created = VaultPayload::new(PHRASE.into(), None, Some(NetworkId::Sepolia)).unwrap();
    assert_eq!(created.backup_pending, Some(true));
    let imported = VaultPayload::new(PHRASE.into(), None, None).unwrap();
    assert_eq!(imported.backup_pending, Some(false));
    let (reopened, migrated) = migrate(stage(&created.to_json().unwrap()).unwrap()).unwrap();
    assert!(!migrated);
    assert_eq!(reopened.backup_pending, Some(true), "the flag round-trips");
}

#[test]
fn the_current_payload_does_not_move() {
    let (_, migrated) = migrate(stage(&records_json(VAULT_VERSION)).unwrap()).unwrap();
    assert!(!migrated);
}

#[test]
fn invalid_payloads_fail_closed() {
    let refused = |plaintext: &[u8]| {
        stage(plaintext)
            .and_then(migrate)
            .map(|_| ())
            .expect_err("refused")
    };
    for bad in [
        counted_json(0, 1, PHRASE).to_vec(),  // no such version
        counted_json(3, 1, PHRASE).to_vec(),  // a count payload is never version 3
        counted_json(4, 1, PHRASE).to_vec(),  // a count payload is never version 4
        counted_json(5, 1, PHRASE).to_vec(),  // a count payload is never version 5
        counted_json(6, 1, PHRASE).to_vec(),  // from the future
        counted_json(1, 0, PHRASE).to_vec(),  // no accounts
        counted_json(1, 33, PHRASE).to_vec(), // above the old cap
        counted_json(1, 1, "not a phrase").to_vec(),
        records_json(1), // records were never version 1
        records_json(6),
        b"{\"version\":2}".to_vec(),
        b"[]".to_vec(),
    ] {
        assert!(matches!(refused(&bad), CoreError::Storage { .. }));
    }
    // `backupPending` before version 4, or missing or mistyped from version 4 on.
    for version in [2, 3] {
        let mut early = records_value(version);
        early["backupPending"] = false.into();
        assert!(matches!(
            refused(&serde_json::to_vec(&early).unwrap()),
            CoreError::Storage { .. }
        ));
    }
    for missing in [serde_json::Value::Null, "yes".into(), 1.into()] {
        let mut current = records_value(4);
        if missing.is_null() {
            current.as_object_mut().unwrap().remove("backupPending");
        } else {
            current["backupPending"] = missing;
        }
        assert!(matches!(
            refused(&serde_json::to_vec(&current).unwrap()),
            CoreError::Storage { .. }
        ));
    }
    // `ladder` before version 5; missing, unknown, or on a ladder its family never walks from
    // version 5 on.
    let mut early = records_value(4);
    early["accounts"][0]["ladder"] = "account".into();
    let mut wrong_ladder = records_value(5);
    wrong_ladder["accounts"][0]["ladder"] = "address".into(); // an OZ record
    let mut unknown = records_value(5);
    unknown["accounts"][0]["ladder"] = "ledger".into();
    let mut missing = records_value(5);
    missing["accounts"][0]
        .as_object_mut()
        .unwrap()
        .remove("ladder");
    for bad in [early, wrong_ladder, unknown, missing] {
        assert!(matches!(
            refused(&serde_json::to_vec(&bad).unwrap()),
            CoreError::Storage { .. }
        ));
    }
    // A stored record that does not re-derive from the phrase is tampering.
    let mut tampered: serde_json::Value = serde_json::from_slice(&records_json(2)).unwrap();
    tampered["accounts"][0]["publicKey"] = "0x1".into();
    assert!(matches!(
        refused(&serde_json::to_vec(&tampered).unwrap()),
        CoreError::Storage { .. }
    ));
}

#[test]
fn each_layout_accepts_only_the_versions_it_was_written_with() {
    let counted = |version| stage(&counted_json(version, 1, PHRASE)).unwrap();
    let records = |version| stage(&records_json(version)).unwrap();
    assert!(envelope_accepts(&counted(1)));
    assert!(envelope_accepts(&records(2)));
    assert!(!envelope_accepts(&counted(2)));
    assert!(!envelope_accepts(&records(3)));
    assert!(container_accepts(&counted(2), 2));
    assert!(container_accepts(&records(3), 3));
    assert!(container_accepts(&records(4), 4));
    assert!(
        !container_accepts(&records(4), 3),
        "payload and container versions are bound"
    );
    assert!(!container_accepts(&counted(1), 1));
    assert!(
        !container_accepts(&records(2), 2),
        "the accounts branch never wrote a container"
    );
    assert!(
        !container_accepts(&counted(2), 3),
        "payload and container versions are bound"
    );
    assert!(!container_accepts(&records(3), 2));
    assert!(!container_accepts(&counted(2), 4));
}

#[test]
fn sealing_a_migrated_vault_is_deterministic_given_its_randomness() {
    let key = SealingKey::fixed("fixture passphrase", [7; 16], &"ab".repeat(16));
    let (payload, _) = migrate(stage(&counted_json(1, 3, PHRASE)).unwrap()).unwrap();
    let seal = || {
        serde_json::to_string(
            &seal_migrated(&payload, &key, &[9; 32], &fixed_randomness()).unwrap(),
        )
        .unwrap()
    };
    let first = seal();
    assert_eq!(first, seal());
    // Golden: the exact file this input must produce. A change here changes stored bytes.
    let golden: serde_json::Value = serde_json::from_str(include_str!(
        "../tests/fixtures/migration-v1-to-v5.golden.json"
    ))
    .unwrap();
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&first).unwrap(),
        golden
    );
    let StoredVault::Container(file) = parse(&first).unwrap() else {
        panic!("expected a container")
    };
    assert_eq!(file.version, VAULT_VERSION);
    let dek = file.open_dek_with(&key).unwrap();
    assert_eq!(*dek, [9; 32]);
    let opened = open_container(*file, dek).unwrap();
    assert!(!opened.migrated);
    assert_eq!(opened.payload.accounts.len(), 6);
}

#[test]
fn a_version_two_container_is_resealed_in_place() {
    let key = SealingKey::fixed("fixture passphrase", [7; 16], &"ab".repeat(16));
    let dek = [9u8; 32];
    let file =
        container::seal_new(&key, &dek, &counted_json(2, 1, PHRASE), &fixed_randomness()).unwrap();
    let file = VaultFile { version: 2, ..file };
    let mut with_slot = file.clone();
    with_slot.biometric_slot = Some(file.seal_biometric(&dek, &[5; 32], String::new()).unwrap());
    let opened = open_container(with_slot.clone(), zeroize::Zeroizing::new(dek)).unwrap();
    assert!(opened.migrated);
    assert_eq!(opened.container.version, VAULT_VERSION);
    assert_eq!(opened.container.lineage, with_slot.lineage);
    assert_eq!(opened.container.password_slot, with_slot.password_slot);
    assert_eq!(opened.container.biometric_slot, with_slot.biometric_slot);
    assert_eq!(*opened.container.open_biometric(&[5; 32]).unwrap(), dek);
    assert_eq!(opened.payload.accounts.len(), 2);
}
