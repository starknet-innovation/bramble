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

/// A host clock that never moves, so no session idles out mid-test.
struct StillClock;

impl crate::HostClock for StillClock {
    fn monotonic_ms(&self) -> u64 {
        1_000_000
    }

    fn boot_id(&self) -> String {
        "boot".into()
    }
}

fn new_core(dir: &tempfile::TempDir) -> Arc<WalletCore> {
    WalletCore::new(dir.path().to_string_lossy().into(), Arc::new(StillClock)).unwrap()
}

/// An imported wallet with OpenZeppelin account 0 restored on Sepolia.
fn wallet(phrase: &str, passphrase: Option<&str>) -> (tempfile::TempDir, Arc<WalletCore>) {
    let dir = tempfile::tempdir().unwrap();
    let core = new_core(&dir);
    core.import_wallet(
        PASSWORD.into(),
        phrase.into(),
        passphrase.map(str::to_string),
    )
    .unwrap();
    core.restore_recovered_accounts(
        NetworkId::Sepolia,
        vec![crate::RecoverySelection {
            family: crate::AccountFamily::OpenZeppelin,
            account_index: 0,
            ladder: None,
            class_hash: None,
        }],
    )
    .unwrap();
    (dir, core)
}

/// Another participant: a freshly generated wallet whose phrase is discarded unread, so no
/// phrase besides the published E2E one appears in source.
fn fresh_wallet() -> (tempfile::TempDir, Arc<WalletCore>) {
    let dir = tempfile::tempdir().unwrap();
    let core = new_core(&dir);
    drop(
        core.create_wallet_on_network(PASSWORD.into(), 12, NetworkId::Sepolia)
            .unwrap(),
    );
    (dir, core)
}

fn key(core: &WalletCore, index: usize) -> String {
    core.accounts(NetworkId::Sepolia).unwrap()[index]
        .public_key
        .clone()
}

/// The record id of OpenZeppelin account `index` on Sepolia.
fn account_id(core: &WalletCore, index: usize) -> String {
    let key = key(core, index);
    core.account_records(NetworkId::Sepolia)
        .unwrap()
        .into_iter()
        .find(|record| record.public_key == key)
        .unwrap()
        .id
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
    assert_eq!(
        joined.local_signer_account_ids,
        [account_id(&core, 0), account_id(&core, 1)]
    );
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
            account_id(&core, 0),
        )
        .unwrap();
    assert_eq!(saved.name.as_deref(), Some("Team"));
    assert_eq!(saved.deployment.as_ref().unwrap().address, saved.address);
    assert_eq!(saved.local_signer_account_ids, [account_id(&core, 0)]);
    let outsider = ArgentMultisigConfig {
        threshold: 1,
        signer_public_keys: vec!["0x456".into()],
    };
    assert!(core
        .save_multisig_setup(
            NetworkId::Sepolia,
            None,
            outsider,
            "0x0".into(),
            account_id(&core, 0)
        )
        .is_err());
    assert!(core
        .save_multisig_setup(
            NetworkId::Sepolia,
            Some("x".repeat(49)),
            config,
            "0x0".into(),
            account_id(&core, 0)
        )
        .is_err());
    assert_eq!(core.multisigs(NetworkId::Sepolia).unwrap().len(), 1);
    assert!(core.multisigs(NetworkId::Mainnet).unwrap().is_empty());
    core.remove_multisig(saved.id).unwrap();
    assert!(core.multisigs(NetworkId::Sepolia).unwrap().is_empty());
}

/// Coordination sync flows (trust, held packages, checkpoints, lock and delete), split out to keep
/// each file under the size limit; they share this module's helpers.
#[path = "ffi_coordination_tests.rs"]
mod coordination_flows;
