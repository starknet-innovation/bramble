//! Flow tests for the Nostr and multisig surface: joins over recorded RPC bodies, the trust
//! judgement (including a saved contact forging a snapshot), and the checkpoint and held-list
//! rules the review fixed (`docs/nostr-multisig.md` §4, §5).

use super::*;
use crate::coordination::Held;
use crate::ffi_coordination::CoordinationSyncOutcome;
use serde_json::{json, Value};

const PHRASE: &str = "habit hope tip crystal because grunt nation idea electric witness alert like";
const PASSWORD: &str = "a strong password";
const SEPOLIA_CHAIN: &str = "0x534e5f5345504f4c4941";
const NOW: u64 = 1_750_000_000;

fn wallet(phrase: &str, passphrase: Option<&str>) -> (tempfile::TempDir, Arc<WalletCore>) {
    let dir = tempfile::tempdir().unwrap();
    let core = WalletCore::new(dir.path().to_string_lossy().into()).unwrap();
    core.import_wallet(
        PASSWORD.into(),
        phrase.into(),
        passphrase.map(str::to_string),
    )
    .unwrap();
    (dir, core)
}

/// Another participant: a freshly generated wallet whose phrase is discarded unread, so no
/// phrase besides the published E2E one appears in source.
fn fresh_wallet() -> (tempfile::TempDir, Arc<WalletCore>) {
    let dir = tempfile::tempdir().unwrap();
    let core = WalletCore::new(dir.path().to_string_lossy().into()).unwrap();
    drop(core.create_wallet(PASSWORD.into(), 12).unwrap());
    (dir, core)
}

fn key(core: &WalletCore, index: usize) -> String {
    core.accounts(NetworkId::Sepolia).unwrap()[index]
        .public_key
        .clone()
}

fn respond(read: &MultisigAuthorityRead, result: Value) {
    let request = read.next_request().unwrap();
    let body = json!({"jsonrpc":"2.0","id":request.id,"result":result}).to_string();
    read.accept_response(request.id, body).unwrap();
}

fn respond_error(read: &MultisigAuthorityRead, code: i64) {
    let request = read.next_request().unwrap();
    let body =
        json!({"jsonrpc":"2.0","id":request.id,"error":{"code":code,"message":"x"}}).to_string();
    read.accept_response(request.id, body).unwrap();
}

/// Drives a read to `Available` with the given threshold and GUIDs (in node order).
fn available_read(address: &str, threshold: u32, guids: &[String]) -> Arc<MultisigAuthorityRead> {
    let read = MultisigAuthorityRead::new(NetworkId::Sepolia, address.into()).unwrap();
    respond(&read, json!(SEPOLIA_CHAIN));
    respond(&read, json!({"block_hash":"0xabc","block_number":7}));
    respond(&read, json!(argent_multisig::class_hash()));
    respond(&read, json!([format!("0x{threshold:x}")]));
    let mut signers = vec![json!(format!("0x{:x}", guids.len()))];
    signers.extend(guids.iter().map(|g| json!(g)));
    respond(&read, Value::Array(signers));
    assert_eq!(read.status(), Some(MultisigAuthorityStatus::Available));
    read
}

fn stored_record(dir: &tempfile::TempDir) -> Value {
    let text = std::fs::read_to_string(dir.path().join("multisigs.json")).unwrap();
    serde_json::from_str::<Value>(&text).unwrap()["records"][0].clone()
}

#[test]
fn nostr_key_ignores_the_bip39_passphrase_and_needs_a_session() {
    let (_plain_dir, plain) = wallet(PHRASE, None);
    let (_pass_dir, with_passphrase) = wallet(PHRASE, Some("extra words"));
    let coordination_key = plain.nostr_public_key().unwrap();
    assert_eq!(coordination_key.len(), 64);
    assert_eq!(
        with_passphrase.nostr_public_key().unwrap(),
        coordination_key
    );
    assert_ne!(
        key(&plain, 0),
        key(&with_passphrase, 0),
        "Stark keys do use the passphrase"
    );
    plain.lock();
    assert!(matches!(plain.nostr_public_key(), Err(CoreError::Locked)));
    assert!(matches!(
        plain.contacts(NetworkId::Sepolia),
        Err(CoreError::Locked)
    ));
}

#[test]
fn authority_reads_settle_every_status() {
    let read = MultisigAuthorityRead::new(NetworkId::Sepolia, "0x123".into()).unwrap();
    let first = read.next_request().unwrap();
    assert!(
        read.accept_response(first.id + 1, "{}".into()).is_err(),
        "id mismatch refused"
    );
    respond(&read, json!("0x534e5f4d41494e"));
    assert_eq!(
        read.status(),
        Some(MultisigAuthorityStatus::NetworkUnavailable),
        "wrong chain"
    );

    let undeployed = MultisigAuthorityRead::new(NetworkId::Sepolia, "0x123".into()).unwrap();
    respond(&undeployed, json!(SEPOLIA_CHAIN));
    respond(&undeployed, json!({"block_hash":"0xabc","block_number":7}));
    respond_error(&undeployed, 20);
    assert_eq!(
        undeployed.status(),
        Some(MultisigAuthorityStatus::Undeployed)
    );

    let other_class = MultisigAuthorityRead::new(NetworkId::Sepolia, "0x123".into()).unwrap();
    respond(&other_class, json!(SEPOLIA_CHAIN));
    respond(&other_class, json!({"block_hash":"0xabc","block_number":7}));
    respond(
        &other_class,
        json!("0x1d1777db36cdd06dd62cfde77b1b6ae06412af95d57a13dc40ac77b8a702381"),
    );
    assert_eq!(
        other_class.status(),
        Some(MultisigAuthorityStatus::UnsupportedClass)
    );

    let bad = MultisigAuthorityRead::new(NetworkId::Sepolia, "0x123".into()).unwrap();
    respond(&bad, json!(SEPOLIA_CHAIN));
    respond(&bad, json!({"block_hash":"0xabc","block_number":7}));
    respond(&bad, json!(argent_multisig::class_hash()));
    respond(&bad, json!(["0x3"]));
    respond(&bad, json!(["0x2", "0x1", "0x1"]));
    assert_eq!(
        bad.status(),
        Some(MultisigAuthorityStatus::InvalidConfig),
        "duplicate GUIDs"
    );

    let repinned = MultisigAuthorityRead::new(NetworkId::Sepolia, "0x123".into()).unwrap();
    respond(&repinned, json!(SEPOLIA_CHAIN));
    for _ in 0..2 {
        respond(&repinned, json!({"block_hash":"0xabc","block_number":7}));
        respond_error(&repinned, 24);
        assert_eq!(repinned.status(), None, "re-pins after Block not found");
    }
    respond(&repinned, json!({"block_hash":"0xabc","block_number":7}));
    respond_error(&repinned, 24);
    assert_eq!(
        repinned.status(),
        Some(MultisigAuthorityStatus::NetworkUnavailable),
        "three attempts"
    );

    let transport = MultisigAuthorityRead::new(NetworkId::Sepolia, "0x123".into()).unwrap();
    let request = transport.next_request().unwrap();
    transport.transport_failed(request.id);
    assert_eq!(
        transport.status(),
        Some(MultisigAuthorityStatus::NetworkUnavailable)
    );
}

#[test]
fn a_join_stores_current_config_only_when_every_guid_resolves() {
    let (dir, core) = wallet(PHRASE, None);
    core.add_account(NetworkId::Sepolia).unwrap();
    let keys = [key(&core, 0), key(&core, 1)];
    let mut guids: Vec<String> = keys
        .iter()
        .map(|k| argent_multisig::signer_guid_hex(k).unwrap())
        .collect();
    guids.reverse();
    let joined = core
        .add_multisig(available_read("0x123", 2, &guids))
        .unwrap();
    assert!(joined.has_current_config);
    assert_eq!(joined.threshold, Some(2));
    assert_eq!(joined.local_signer_indexes, [0, 1]);
    let record = stored_record(&dir);
    let normalized = argent_multisig_normalize(ArgentMultisigConfig {
        threshold: 2,
        signer_public_keys: keys.to_vec(),
    })
    .unwrap();
    assert_eq!(
        record["currentConfig"],
        json!({"signerPublicKeys": normalized.signer_public_keys, "threshold": 2})
    );
    assert_eq!(record["classHash"], json!(argent_multisig::class_hash()));

    // One GUID nobody here knows: no currentConfig, authority kept in `observed` only.
    let (other_dir, other) = wallet(PHRASE, None);
    let unknown = argent_multisig::signer_guid_hex("0x777").unwrap();
    let partial = other
        .add_multisig(available_read("0x456", 1, &[guids[0].clone(), unknown]))
        .unwrap();
    assert!(!partial.has_current_config);
    assert_eq!(partial.signer_count, 2);
    assert!(partial.signer_public_keys.is_empty());
    let stored = stored_record(&other_dir);
    assert!(stored.get("currentConfig").is_none());
    let file: Value = serde_json::from_str(
        &std::fs::read_to_string(other_dir.path().join("multisigs.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(file["observed"][0]["threshold"], json!(1));

    let refused = MultisigAuthorityRead::new(NetworkId::Sepolia, "0x789".into()).unwrap();
    respond(&refused, json!("0x0"));
    assert!(
        core.add_multisig(refused).is_err(),
        "network-unavailable is refused"
    );
}

#[test]
fn setups_require_a_local_deployment_signer_and_rederive() {
    let (_dir, core) = wallet(PHRASE, None);
    let config = ArgentMultisigConfig {
        threshold: 1,
        signer_public_keys: vec![key(&core, 0), "0x456".into()],
    };
    let saved = core
        .save_multisig_setup(
            NetworkId::Sepolia,
            Some(" Team ".into()),
            config.clone(),
            "0x0".into(),
            0,
        )
        .unwrap();
    assert_eq!(saved.name.as_deref(), Some("Team"));
    assert_eq!(saved.deployment.as_ref().unwrap().address, saved.address);
    assert_eq!(saved.local_signer_indexes, [0]);
    let outsider = ArgentMultisigConfig {
        threshold: 1,
        signer_public_keys: vec!["0x456".into()],
    };
    assert!(core
        .save_multisig_setup(NetworkId::Sepolia, None, outsider, "0x0".into(), 0)
        .is_err());
    assert!(core
        .save_multisig_setup(
            NetworkId::Sepolia,
            Some("x".repeat(49)),
            config,
            "0x0".into(),
            0
        )
        .is_err());
    assert_eq!(core.multisigs(NetworkId::Sepolia).unwrap().len(), 1);
    assert!(core.multisigs(NetworkId::Mainnet).unwrap().is_empty());
    core.remove_multisig(saved.id).unwrap();
    assert!(core.multisigs(NetworkId::Sepolia).unwrap().is_empty());
}

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
        .save_multisig_setup(NetworkId::Sepolia, None, config, "0x0".into(), 0)
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
        .with_phrase(|m, _, _| nostr::wrap(m, 0, &to, "bramble.multisig", content, NOW))
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
