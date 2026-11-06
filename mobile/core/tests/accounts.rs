//! Account management through the public core surface: signing by record (a shared key at one
//! index signs every family there; the send plan decides which account may use it), the network
//! switch, adding accounts, labels, groups, the count → records migration, and fail-closed
//! handling of a tampered vault. The migration chain across every historical vault file is
//! covered in `migration.rs`.

mod common;

use bramble_core::testing::{open_vault, seal_container_vault, seal_envelope_vault};
use bramble_core::{account_classes, AccountFamily, CoreError, NetworkId};
use common::{core, open, own, oz, pending, selection, PASSWORD, PHRASE};
use serde_json::Value;

fn class_of(label: &str) -> String {
    account_classes()
        .into_iter()
        .find(|class| class.label == label)
        .unwrap()
        .class_hash
}

#[test]
fn every_record_signs_through_one_gate_with_its_index_key() {
    let (_dir, _clock, core) = pending();
    assert!(
        core.sign_hash_for_account("SN_SEPOLIA:0x1".into(), "0x1".into())
            .is_err(),
        "a pending vault signs nothing"
    );

    let braavos_class = class_of("braavos 1.0.0");
    let argent_class = class_of("argent 0.4.0");
    let restored = core
        .restore_recovered_accounts(
            NetworkId::Sepolia,
            vec![
                oz(0),
                selection(AccountFamily::Braavos, 0, Some(&braavos_class)),
                selection(AccountFamily::Braavos, 1, Some(&braavos_class)),
                own(AccountFamily::Argent, 0, Some(&argent_class)),
                selection(AccountFamily::Argent, 0, Some(&argent_class)),
            ],
        )
        .unwrap();
    let (ozr, braavos0, argent0, ready0) = (&restored[0], &restored[1], &restored[3], &restored[4]);
    assert_eq!(
        ozr.public_key, braavos0.public_key,
        "index 0 is the same key on this wallet's ladder and Braavos's"
    );
    assert_ne!(
        ready0.public_key, ozr.public_key,
        "Ready's ETH-seeded ladder is a different key (issue 505)"
    );
    assert_ne!(
        restored[2].public_key, ozr.public_key,
        "Braavos's index 1 is on its own address ladder"
    );
    assert_eq!(braavos0.type_label.as_deref(), Some("Braavos Account"));

    let signed = core
        .sign_hash_for_account(ozr.id.clone(), "0x1".into())
        .unwrap();
    assert_eq!(signed.public_key, ozr.public_key);
    // Braavos signs only inside a send plan, after its live class and signers are checked
    // (`transactions_braavos_parity.rs`); a raw hash would skip those checks.
    assert!(matches!(
        core.sign_hash_for_account(braavos0.id.clone(), "0x1".into()),
        Err(CoreError::InvalidInput { .. })
    ));
    assert!(matches!(
        core.sign_hash_for_account("SN_SEPOLIA:0x1".into(), "0x1".into()),
        Err(CoreError::InvalidInput { .. })
    ));
    // Argent on this wallet's ladder shares index 0's key too and passes the same gate: the plan
    // wraps its signature in the `argent-signer-array` layout (`transactions_argent_parity.rs`).
    assert_eq!(argent0.public_key, ozr.public_key);
    assert_eq!(argent0.authorization_shape, "argent-signer-array");
    let ready = core
        .sign_hash_for_account(argent0.id.clone(), "0x1".into())
        .unwrap();
    assert_eq!(
        ready, signed,
        "one key per index; the record only chooses the layout"
    );
    // The deprecated OZ-only view never lists the Braavos records.
    let legacy = core.accounts(NetworkId::Sepolia).unwrap();
    assert_eq!(legacy.len(), 1);
    assert_eq!(legacy[0].address, ozr.address);
}

#[test]
fn switching_network_keeps_picks_or_projects_like_the_extension() {
    let (dir, clock, core) = pending();
    let argent_031 = class_of("argent 0.3.1");
    let braavos_base = class_of("braavos base");
    let restored = core
        .restore_recovered_accounts(
            NetworkId::Sepolia,
            vec![
                oz(0),
                selection(AccountFamily::Argent, 2, Some(&argent_031)),
                selection(AccountFamily::Braavos, 3, Some(&braavos_base)),
            ],
        )
        .unwrap();

    // Active is on Sepolia: kept.
    let kept = core
        .ensure_network_account(NetworkId::Sepolia)
        .unwrap()
        .unwrap();
    assert_eq!(kept.id, restored[0].id);

    // Argent 0.3.1 projects with its class and salt kept (same address on both chains).
    core.select_account(restored[1].id.clone()).unwrap();
    let argent = core
        .ensure_network_account(NetworkId::Mainnet)
        .unwrap()
        .unwrap();
    assert_eq!(argent.network, NetworkId::Mainnet);
    assert_eq!(argent.family, AccountFamily::Argent);
    assert_eq!(argent.class_hash, restored[1].class_hash);
    assert_eq!(argent.deployment_salt, restored[1].deployment_salt);
    assert_eq!(argent.address, restored[1].address);
    assert!(argent.active);

    // Back on Sepolia the first Sepolia record is picked, not projected again.
    let picked = core
        .ensure_network_account(NetworkId::Sepolia)
        .unwrap()
        .unwrap();
    assert_eq!(picked.id, restored[0].id);

    // A Mainnet record exists now, so switching back picks it rather than projecting OZ.
    let mainnet = core
        .ensure_network_account(NetworkId::Mainnet)
        .unwrap()
        .unwrap();
    assert_eq!(mainnet.id, argent.id);
    assert_eq!(core.account_records(NetworkId::Mainnet).unwrap().len(), 1);

    // Braavos projects too.
    let (_dir2, _clock2, other) = pending();
    other
        .restore_recovered_accounts(
            NetworkId::Sepolia,
            vec![selection(AccountFamily::Braavos, 3, Some(&braavos_base))],
        )
        .unwrap();
    let projected = other
        .ensure_network_account(NetworkId::Mainnet)
        .unwrap()
        .unwrap();
    assert_eq!(projected.family, AccountFamily::Braavos);
    assert_eq!(projected.class_hash, restored[2].class_hash);

    // Projection persists across lock and unlock.
    core.lock();
    let reopened = open(dir.path(), &clock);
    reopened.unlock(PASSWORD.into()).unwrap();
    assert_eq!(reopened.active_account().unwrap().unwrap().id, argent.id);
}

#[test]
fn oz_projects_with_the_other_networks_class() {
    let (_dir, _clock, core) = common::core();
    core.create_wallet_on_network(PASSWORD.into(), 12, NetworkId::Sepolia)
        .unwrap();
    let sepolia = core.active_account().unwrap().unwrap();
    let mainnet = core
        .ensure_network_account(NetworkId::Mainnet)
        .unwrap()
        .unwrap();
    assert_eq!(mainnet.family, AccountFamily::OpenZeppelin);
    assert_eq!(mainnet.account_index, 0);
    assert_eq!(mainnet.public_key, sepolia.public_key);
    assert_eq!(mainnet.id, format!("SN_MAIN:{}", mainnet.address));
    assert_eq!(mainnet.deployment_salt, None);
}

#[test]
fn regular_accounts_take_the_lowest_free_index_and_become_active() {
    let (_dir, _clock, core) = pending();
    let argent = class_of("argent 0.4.0");
    core.restore_recovered_accounts(
        NetworkId::Sepolia,
        vec![
            oz(0),
            own(AccountFamily::Argent, 1, Some(&argent)),
            // Ready's ladder is a separate ETH-seeded tree: its index 2 holds no index here.
            selection(AccountFamily::Argent, 2, Some(&argent)),
            oz(3),
        ],
    )
    .unwrap();
    let added = core.add_regular_account(NetworkId::Sepolia).unwrap();
    assert_eq!(
        added.account_index, 2,
        "index 1 is held by the own-ladder Argent account; Ready's index 2 is not"
    );
    assert!(added.active);
    assert_eq!(added.family, AccountFamily::OpenZeppelin);
    assert_eq!(
        added.type_label.as_deref(),
        Some("Bramble Account (OpenZeppelin AccountUpgradeable)")
    );
    let next = core.add_regular_account(NetworkId::Sepolia).unwrap();
    assert_eq!(next.account_index, 4);
    assert_eq!(
        core.add_regular_account(NetworkId::Mainnet)
            .unwrap()
            .account_index,
        0
    );
}

#[test]
fn labels_and_groups_are_sealed_and_validated() {
    let (dir, clock, core) = pending();
    let restored = core
        .restore_recovered_accounts(NetworkId::Sepolia, vec![oz(0), oz(1)])
        .unwrap();
    let id = restored[0].id.clone();
    assert_eq!(
        restored[0].display_name,
        bramble_core::friendly_account_name(restored[0].address.clone())
    );
    assert_eq!(
        core.set_account_label(id.clone(), "  Savings ".into())
            .unwrap()
            .as_deref(),
        Some("Savings")
    );
    assert!(core.set_account_label(id.clone(), "x".repeat(65)).is_err());
    assert!(core
        .set_account_label("SN_MAIN:0x1".into(), "Other".into())
        .is_err());

    let group = core
        .create_account_group("Long term".into(), "piggyBank".into())
        .unwrap();
    assert_eq!(group.id, "long-term");
    core.set_account_group(id.clone(), Some(group.id.clone()))
        .unwrap();
    let renamed = core
        .update_account_group(group.id.clone(), "Savings pot".into(), "coins".into())
        .unwrap();
    assert_eq!(
        (renamed.id.as_str(), renamed.icon.as_str()),
        ("long-term", "coins")
    );

    core.lock();
    let reopened = open(dir.path(), &clock);
    reopened.unlock(PASSWORD.into()).unwrap();
    let record = &reopened.account_records(NetworkId::Sepolia).unwrap()[0];
    assert_eq!(record.label.as_deref(), Some("Savings"));
    assert_eq!(record.display_name, "Savings");
    assert_eq!(record.group_id.as_deref(), Some("long-term"));
    let on_disk = std::fs::read_to_string(dir.path().join("vault.json")).unwrap();
    assert!(
        !on_disk.contains("Savings"),
        "labels are sealed, never plain"
    );

    reopened
        .set_account_label(id.clone(), "   ".into())
        .unwrap();
    reopened.delete_account_group("long-term".into()).unwrap();
    let record = &reopened.account_records(NetworkId::Sepolia).unwrap()[0];
    assert_eq!(record.label, None);
    assert_eq!(record.group_id, None);
}

fn v1_payload(count: u32) -> String {
    format!(
        r#"{{"accountCount":{count},"mnemonic":"{PHRASE}","mnemonicPassphrase":null,"version":1}}"#
    )
}

#[test]
fn a_version_one_vault_migrates_to_records_on_every_network() {
    let (dir, _clock, core) = core();
    let path = dir.path().to_string_lossy().to_string();
    seal_envelope_vault(&path, PASSWORD, &v1_payload(2)).unwrap();
    core.unlock(PASSWORD.into()).unwrap();
    for network in [NetworkId::Mainnet, NetworkId::Sepolia] {
        let records = core.account_records(network).unwrap();
        let indices: Vec<_> = records.iter().map(|r| r.account_index).collect();
        assert_eq!(indices, [0, 1]);
        assert!(records
            .iter()
            .all(|r| r.family == AccountFamily::OpenZeppelin));
    }
    assert_eq!(
        core.active_account().unwrap().unwrap().network,
        NetworkId::Mainnet
    );
    let payload: Value = serde_json::from_str(&open_vault(&path, PASSWORD).unwrap()).unwrap();
    assert_eq!(payload["version"], 5, "the migration was written back");
    assert_eq!(payload["accounts"].as_array().unwrap().len(), 4);

    let (bad, _clock, core) = common::core();
    let bad_path = bad.path().to_string_lossy().to_string();
    seal_envelope_vault(&bad_path, PASSWORD, &v1_payload(0)).unwrap();
    assert!(matches!(
        core.unlock(PASSWORD.into()),
        Err(CoreError::Storage { .. })
    ));
}

#[test]
fn a_tampered_or_malformed_records_vault_fails_closed() {
    let (dir, clock, core) = pending();
    core.restore_recovered_accounts(NetworkId::Sepolia, vec![oz(0)])
        .unwrap();
    core.lock();
    let path = dir.path().to_string_lossy().to_string();
    let good: Value = serde_json::from_str(&open_vault(&path, PASSWORD).unwrap()).unwrap();

    let reject = |mutate: &dyn Fn(&mut Value), why: &str| {
        let mut payload = good.clone();
        mutate(&mut payload);
        seal_container_vault(&path, PASSWORD, 3, &payload.to_string()).unwrap();
        // Each refusal counts as a failed attempt; start every case unthrottled.
        let _ = std::fs::remove_file(dir.path().join("security.json"));
        let fresh = open(dir.path(), &clock);
        assert!(
            matches!(
                fresh.unlock(PASSWORD.into()),
                Err(CoreError::Storage { .. })
            ),
            "{why}"
        );
    };
    let other = "0x2cd1d9d3c7ab3b52b2b61327e14c5cfa4e9f2ec5d2de8ac6e7a3c1c1c7e0e4b";
    reject(
        &|p| p["accounts"][0]["address"] = other.into(),
        "address that does not re-derive",
    );
    reject(
        &|p| p["accounts"][0]["id"] = "SN_MAIN:0x1".into(),
        "id not network:address",
    );
    reject(
        &|p| p["accounts"][0]["deploymentSalt"] = "0x0".into(),
        "salt on OZ",
    );
    reject(
        &|p| p["accounts"][0]["family"] = "braavos".into(),
        "family swapped",
    );
    reject(
        &|p| p["activeAccountId"] = "SN_SEPOLIA:0x1".into(),
        "unknown active account",
    );
    reject(
        &|p| p["recoveryPending"] = true.into(),
        "pending with accounts",
    );
    reject(
        &|p| p["labels"] = serde_json::json!({ "SN_SEPOLIA:0x1": "x" }),
        "label for nobody",
    );
    reject(&|p| p["extra"] = 1.into(), "unknown field");
    let id = good["accounts"][0]["id"].clone();
    reject(
        &|p| {
            p["groups"] = serde_json::json!([
                { "accountIds": [id.clone()], "icon": "folder", "id": "a", "name": "A" },
                { "accountIds": [id.clone()], "icon": "star", "id": "b", "name": "B" }
            ])
        },
        "one account in two groups",
    );
    reject(&|p| p["version"] = 4.into(), "a newer payload");
    reject(
        &|p| p["version"] = 2.into(),
        "payload older than its container",
    );
}
