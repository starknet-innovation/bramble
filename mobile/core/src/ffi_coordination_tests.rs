//! Coordination sync flows over the helpers in `ffi_nostr_multisig_tests.rs`: the trust judgement
//! (including a saved contact forging a snapshot), and the checkpoint and held-list rules
//! (`docs/nostr-multisig.md` §4, §5).

use super::*;

struct Coordination {
    _dirs: Vec<tempfile::TempDir>,
    ours: Arc<WalletCore>,
    cosigner: Arc<WalletCore>,
    stranger: Arc<WalletCore>,
    record: MultisigRecord,
}

/// Our 2-of-2 setup with a saved co-signer, and a stranger saved as an ordinary payee whose card
/// carries a Nostr key.
fn coordination() -> Coordination {
    let (dir_a, ours) = wallet(PHRASE, None);
    let (dir_b, cosigner) = fresh_wallet();
    let (dir_c, stranger) = fresh_wallet();
    let config = ArgentMultisigConfig {
        threshold: 2,
        signer_public_keys: vec![key(&ours, 0), key(&cosigner, 0)],
    };
    let record = ours
        .save_multisig_setup(
            NetworkId::Sepolia,
            None,
            config,
            "0x0".into(),
            account_id(&ours, 0),
        )
        .unwrap();
    for (label, wallet) in [("Bob", &cosigner), ("Payee", &stranger)] {
        let account = &wallet.accounts(NetworkId::Sepolia).unwrap()[0];
        ours.save_contact(
            NetworkId::Sepolia,
            label.into(),
            account.address.clone(),
            Some(account.public_key.clone()),
            Some(wallet.nostr_public_key().unwrap()),
        )
        .unwrap();
    }
    Coordination {
        _dirs: vec![dir_a, dir_b, dir_c],
        ours,
        cosigner,
        stranger,
        record,
    }
}

fn package(record_id: &str, guids: Vec<String>, threshold: u32) -> String {
    json!({"intent":{"accountId":record_id,"configSnapshot":{"classHash":argent_multisig::class_hash(),"signerGuids":guids,"threshold":threshold},"id":"x"},
           "kind":"bramble.argent-multisig-intent","version":1})
    .to_string()
}

fn wrap_from(sender: &WalletCore, recipient: &WalletCore, content: &str) -> Value {
    let to = recipient.nostr_public_key().unwrap();
    let wrapped = sender
        .with_phrase(|m, _| nostr::wrap(m, 0, &to, "bramble.multisig", content, NOW))
        .unwrap();
    serde_json::from_str(&wrapped).unwrap()
}

fn sync(ours: &WalletCore, record_id: &str, now: u64, events: &[Value]) -> CoordinationSyncOutcome {
    let plan = ours.coordination_sync_begin(record_id.into(), now).unwrap();
    for event in events {
        plan.accept_frame(0, json!(["EVENT", "mcw-1", event]).to_string());
    }
    plan.accept_frame(0, json!(["EOSE", "mcw-1"]).to_string());
    plan.relay_ended(1);
    ours.coordination_sync_finish(plan).unwrap()
}

fn coordination_file(core: &WalletCore) -> coordination::File {
    coordination::load(core.data_dir()).unwrap()
}

#[test]
fn a_saved_contact_forging_a_snapshot_is_authenticated_but_untrusted() {
    let c = coordination();
    let own_guid = argent_multisig::signer_guid_hex(&key(&c.stranger, 0)).unwrap();
    let forged = wrap_from(
        &c.stranger,
        &c.ours,
        &package(&c.record.id, vec![own_guid], 1),
    );
    let outcome = sync(&c.ours, &c.record.id, NOW, std::slice::from_ref(&forged));
    assert_eq!((outcome.received, outcome.trusted, outcome.held), (1, 0, 0));
    let file = coordination_file(&c.ours);
    assert!(
        file.checkpoints[0]
            .event_ids
            .contains(&forged["id"].as_str().unwrap().to_string()),
        "marked seen"
    );
    assert!(file.held.is_empty());
}

#[test]
fn a_trusted_package_is_held_and_the_checkpoint_still_advances() {
    let c = coordination();
    let authority = c.record.deployment.as_ref().unwrap().signer_guids.clone();
    let genuine = wrap_from(
        &c.cosigner,
        &c.ours,
        &package(&c.record.id, authority.clone(), 2),
    );
    let wrong_threshold = wrap_from(&c.cosigner, &c.ours, &package(&c.record.id, authority, 1));
    let outcome = sync(
        &c.ours,
        &c.record.id,
        NOW,
        &[genuine.clone(), wrong_threshold],
    );
    assert_eq!(
        (
            outcome.received,
            outcome.trusted,
            outcome.held,
            outcome.imported
        ),
        (2, 1, 1, 0)
    );
    let file = coordination_file(&c.ours);
    assert_eq!(
        file.checkpoints[0].synced_at, NOW,
        "held packages never freeze syncedAt"
    );
    assert_eq!(file.checkpoints[0].event_ids.len(), 2);
    assert_eq!(file.held.len(), 1);
    assert_eq!(file.held[0].event_id, genuine["id"].as_str().unwrap());

    // The next sync starts three days behind the new checkpoint and skips what it has seen.
    let plan = c
        .ours
        .coordination_sync_begin(c.record.id.clone(), NOW + 60)
        .unwrap();
    let request: Value = serde_json::from_str(&plan.open_frame(0)).unwrap();
    assert_eq!(request[2]["since"], json!(NOW - 3 * 24 * 60 * 60));
    let again = sync(&c.ours, &c.record.id, NOW + 60, &[genuine]);
    assert_eq!(again.received, 0);
    assert_eq!(
        coordination_file(&c.ours).checkpoints[0].synced_at,
        NOW + 60
    );
}

#[test]
fn the_held_list_stays_within_its_caps() {
    let mut file = coordination::File {
        version: 1,
        ..Default::default()
    };
    let account = "SN_SEPOLIA:0x123".to_string();
    let held = |n: u64, at: u64| Held {
        account_id: account.clone(),
        created_at: at,
        event_id: format!("{n:064x}"),
    };
    coordination::record_held(&mut file, (0..60).map(|n| held(n, NOW - n)).collect(), NOW);
    assert_eq!(file.held.len(), 50);
    assert_eq!(file.held[0].created_at, NOW, "newest first");
    coordination::record_held(&mut file, vec![held(99, NOW - 31 * 24 * 60 * 60)], NOW);
    assert!(
        file.held
            .iter()
            .all(|h| h.event_id != format!("{:064x}", 99)),
        "outside the lookback"
    );
    coordination::record_held(&mut file, vec![], NOW + 30 * 24 * 60 * 60 + 100);
    assert!(file.held.is_empty(), "everything aged out");
}

#[test]
fn a_rejoin_replaces_current_config_with_the_fresh_resolved_authority() {
    let (dir, core) = wallet(PHRASE, None);
    core.add_account(NetworkId::Sepolia).unwrap();
    let guids: Vec<String> = [key(&core, 0), key(&core, 1)]
        .iter()
        .map(|k| argent_multisig::signer_guid_hex(k).unwrap())
        .collect();
    core.add_multisig(available_read("0x123", 2, &guids))
        .unwrap();
    // Rotation: signer 1 removed, threshold lowered. The stored authority must follow.
    let rotated = core
        .add_multisig(available_read("0x123", 1, &guids[..1]))
        .unwrap();
    assert_eq!((rotated.threshold, rotated.signer_count), (Some(1), 1));
    assert_eq!(stored_record(&dir)["currentConfig"]["threshold"], json!(1));
    // An unresolved read keeps the stored config, as the extension's addRecord does.
    let unknown = argent_multisig::signer_guid_hex("0x777").unwrap();
    core.add_multisig(available_read("0x123", 2, &[guids[0].clone(), unknown]))
        .unwrap();
    let kept = &stored_record(&dir)["currentConfig"];
    assert_eq!(kept["threshold"], json!(1));
    assert_eq!(kept["signerPublicKeys"], json!([key(&core, 0)]));
}

#[test]
fn deleting_the_wallet_removes_the_metadata_files() {
    let c = coordination();
    let dir = c.ours.data_dir().to_path_buf();
    c.ours
        .set_nostr_relay_url("wss://relay.team.example".into())
        .unwrap();
    assert!(c.ours.relay_policy().unwrap().is_custom);
    assert_eq!(
        c.ours.relay_policy().unwrap().relay_urls,
        ["wss://relay.team.example"]
    );
    for file in ["contacts.json", "multisigs.json", "coordination.json"] {
        assert!(dir.join(file).exists(), "{file}");
    }
    c.ours.delete_wallet(PASSWORD.into()).unwrap();
    for file in ["contacts.json", "multisigs.json", "coordination.json"] {
        assert!(!dir.join(file).exists(), "{file}");
    }
}

#[test]
fn syncing_stops_when_the_wallet_locks() {
    let c = coordination();
    let authority = c.record.deployment.as_ref().unwrap().signer_guids.clone();
    let genuine = wrap_from(&c.cosigner, &c.ours, &package(&c.record.id, authority, 2));
    let plan = c
        .ours
        .coordination_sync_begin(c.record.id.clone(), NOW)
        .unwrap();
    plan.accept_frame(0, json!(["EVENT", "mcw-1", genuine]).to_string());
    plan.relay_ended(0);
    plan.relay_ended(1);
    c.ours.lock();
    assert!(matches!(
        c.ours.coordination_sync_finish(plan),
        Err(CoreError::Locked)
    ));
}
