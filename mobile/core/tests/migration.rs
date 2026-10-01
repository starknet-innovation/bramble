//! The one vault migration chain (`src/migrations.rs`), end to end over real files: a vault
//! written by the original core (v1), by vault-security (v2 container, account count), and by
//! the accounts branch before the merge (v2 records in a bare envelope), and a v3 records
//! container each migrates to the current v4 container on unlock; current data round-trips; invalid data fails closed with no
//! partial state.

mod common;

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use bramble_core::testing::{open_vault, seal_container_vault, seal_envelope_vault};
use bramble_core::{AccountFamily, CoreError, NetworkId, WalletStatus};
use common::{core, imported, open, FakeClock, PASSWORD, PHRASE};
use serde_json::{json, Value};

/// Written by the pre-migration core (commit 660a538e) from the published phrase with two
/// accounts. Public test data.
const V1_FIXTURE: &str = include_str!("fixtures/vault-v1.json");
const V1_PASSWORD: &str = "v1 fixture passphrase";
/// Written by vault-security's core (2785e57f): the published phrase imported, a second account
/// added (`accountCount: 2`), and a biometric slot under the wrap secret `[7; 32]` with no domain.
const V2_CONTAINER_FIXTURE: &str = include_str!("fixtures/vault-v2-container.json");
const V2_CONTAINER_PASSWORD: &str = "v2 fixture passphrase";
const V2_WRAP_SECRET: [u8; 32] = [7; 32];
/// Written by the accounts branch's core (e94b8ef2), whose payload v2 held records in a bare
/// envelope: OZ 0, Argent 0.4.0 at 1 and Braavos 1.0.0 at 2 on Sepolia, OZ 0 projected onto
/// Mainnet (active), the label "Savings" on OZ 0, and the Argent record in the group "Long term".
const V2_RECORDS_FIXTURE: &str = include_str!("fixtures/vault-v2-records.json");
const V2_RECORDS_PASSWORD: &str = "records fixture passphrase";

fn read(dir: &tempfile::TempDir) -> Value {
    serde_json::from_str(&std::fs::read_to_string(dir.path().join("vault.json")).unwrap()).unwrap()
}

fn write(dir: &tempfile::TempDir, value: &Value) {
    std::fs::write(dir.path().join("vault.json"), value.to_string()).unwrap();
}

fn v1_dir() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("vault.json"), V1_FIXTURE).unwrap();
    dir
}

#[test]
fn an_old_v1_vault_migrates_on_unlock_and_opens_again() {
    let dir = v1_dir();
    let clock = FakeClock::new();
    let core = open(dir.path(), &clock);
    assert_eq!(core.status(), WalletStatus::Locked);
    assert!(!core.security_status().biometric_enabled);
    core.unlock(V1_PASSWORD.into()).unwrap();
    let accounts = core.accounts(NetworkId::Sepolia).unwrap();
    assert_eq!(accounts.len(), 2);

    let migrated = read(&dir);
    assert_eq!(migrated["format"], "bramble.mobile.vault");
    assert_eq!(migrated["version"], 4);
    for network in [NetworkId::Mainnet, NetworkId::Sepolia] {
        let indices: Vec<u32> = core
            .account_records(network)
            .unwrap()
            .iter()
            .map(|record| record.account_index)
            .collect();
        assert_eq!(indices, [0, 1], "v1 showed every index on every network");
    }
    let v1: Value = serde_json::from_str(V1_FIXTURE).unwrap();
    assert_eq!(migrated["lineage"], v1["lineage"], "lineage is kept");
    assert_eq!(migrated["passwordSlot"]["iterations"], 600_000);

    let reopened = open(dir.path(), &clock);
    reopened.unlock(V1_PASSWORD.into()).unwrap();
    assert_eq!(reopened.accounts(NetworkId::Sepolia).unwrap(), accounts);
    assert_eq!(
        reopened
            .reveal_recovery_phrase(V1_PASSWORD.into())
            .unwrap()
            .words
            .join(" "),
        PHRASE
    );
    assert_eq!(
        read(&dir),
        migrated,
        "a second unlock does not migrate again"
    );
}

/// A v1 envelope at the legacy 310 000 iterations, sealed here exactly as the extension's
/// envelope layout specifies (the core itself never writes this strength).
fn legacy_v1(password: &str) -> Value {
    let salt = [5u8; 16];
    let iv = [6u8; 12];
    let lineage = "cd".repeat(16);
    let commit = BASE64.encode([8u8; 16]);
    let mut key = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<sha2::Sha256>(password.as_bytes(), &salt, 310_000, &mut key);
    let plaintext =
        json!({"accountCount": 1, "mnemonic": PHRASE, "mnemonicPassphrase": null, "version": 1});
    let aad = format!("bramble.mobile.vault.v1\0{lineage}\0{commit}");
    let data = Aes256Gcm::new_from_slice(&key)
        .unwrap()
        .encrypt(
            &Nonce::from(iv),
            Payload {
                msg: plaintext.to_string().as_bytes(),
                aad: aad.as_bytes(),
            },
        )
        .unwrap();
    json!({
        "cipher": "AES-256-GCM", "commit": commit, "data": BASE64.encode(data),
        "iterations": 310_000, "iv": BASE64.encode(iv), "kdf": "PBKDF2-SHA-256",
        "lineage": lineage, "salt": BASE64.encode(salt), "scope": "bramble.mobile.vault.v1",
        "version": 3
    })
}

#[test]
fn a_legacy_strength_v1_vault_migrates_to_the_current_strength() {
    let dir = tempfile::tempdir().unwrap();
    write(&dir, &legacy_v1(PASSWORD));
    let core = open(dir.path(), &FakeClock::new());
    core.unlock(PASSWORD.into()).unwrap();
    assert_eq!(read(&dir)["passwordSlot"]["iterations"], 600_000);
    core.lock();
    core.unlock(PASSWORD.into()).unwrap();
}

#[test]
fn a_failed_migration_write_keeps_v1_and_the_next_write_commits_it() {
    let dir = v1_dir();
    // A directory where the temporary vault file would go makes only the vault write fail.
    let blocker = dir.path().join("vault.json.tmp");
    std::fs::create_dir(&blocker).unwrap();
    let core = open(dir.path(), &FakeClock::new());
    core.unlock(V1_PASSWORD.into()).unwrap();
    assert_eq!(core.status(), WalletStatus::Unlocked);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("vault.json")).unwrap(),
        V1_FIXTURE
    );
    assert!(core.add_account(NetworkId::Sepolia).is_err());
    std::fs::remove_dir(&blocker).unwrap();
    core.add_account(NetworkId::Sepolia).unwrap();
    assert_eq!(read(&dir)["version"], 4);
    core.lock();
    core.unlock(V1_PASSWORD.into()).unwrap();
    assert_eq!(core.accounts(NetworkId::Sepolia).unwrap().len(), 3);
}

#[test]
fn a_current_vault_round_trips() {
    let (dir, clock, core) = imported();
    let first = read(&dir);
    assert_eq!(first["version"], 4);
    assert_eq!(first["biometricSlot"], Value::Null);
    core.lock();
    let reopened = open(dir.path(), &clock);
    reopened.unlock(PASSWORD.into()).unwrap();
    assert_eq!(
        read(&dir),
        first,
        "unlocking a current vault writes nothing"
    );
}

fn refused(dir: &tempfile::TempDir, before: &Value) {
    let core = open(dir.path(), &FakeClock::new());
    let result = core.unlock(PASSWORD.into());
    assert!(
        matches!(result, Err(CoreError::Storage { .. })),
        "expected Storage, got {result:?}"
    );
    assert_eq!(core.status(), WalletStatus::Locked, "no partial state");
    assert_eq!(&read(dir), before, "the file is left as it was");
}

#[test]
fn invalid_containers_fail_closed() {
    let (dir, _clock, core) = imported();
    core.lock();
    let good = read(&dir);
    let mut cases: Vec<Value> = Vec::new();
    let mut edit = |f: &dyn Fn(&mut Value)| {
        let mut value = good.clone();
        f(&mut value);
        cases.push(value);
    };
    edit(&|v| v["format"] = json!("bramble.other"));
    edit(&|v| v["version"] = json!(5));
    edit(&|v| v["version"] = json!(3)); // a v4 payload under a v3 label
    edit(&|v| v["version"] = json!(2)); // a v4 payload under a v2 label
    edit(&|v| v["version"] = json!(1));
    edit(&|v| v["extra"] = json!(true));
    edit(&|v| v["lineage"] = json!("00".repeat(16)));
    edit(&|v| v["lineage"] = json!("AB".repeat(16)));
    edit(&|v| v["payload"]["scope"] = json!("bramble.mobile.vault.v1"));
    edit(&|v| v["payload"]["iv"] = json!(BASE64.encode([0u8; 11])));
    edit(&|v| v["passwordSlot"]["scope"] = json!("bramble.mobile.payload.v2"));
    edit(&|v| {
        v["biometricSlot"] = json!({"id": "ab".repeat(16), "iv": BASE64.encode([0u8; 12]),
                                     "data": BASE64.encode([0u8; 47]), "domain": ""})
    });
    edit(&|v| {
        v["biometricSlot"] = json!({"id": "short", "iv": BASE64.encode([0u8; 12]),
                                     "data": BASE64.encode([0u8; 48]), "domain": ""})
    });
    edit(&|v| {
        v.as_object_mut()
            .unwrap()
            .remove("passwordSlot")
            .map(drop)
            .unwrap_or(())
    });
    edit(&|v| *v = json!({"something": "else"}));
    for case in cases {
        write(&dir, &case);
        refused(&dir, &case);
    }
    let truncated = good.to_string();
    std::fs::write(
        dir.path().join("vault.json"),
        &truncated[..truncated.len() / 2],
    )
    .unwrap();
    let core = open(dir.path(), &FakeClock::new());
    assert!(matches!(
        core.unlock(PASSWORD.into()),
        Err(CoreError::Storage { .. })
    ));
}

#[test]
fn slots_and_payloads_cannot_be_swapped_between_vaults() {
    let (dir_a, _a, core_a) = imported();
    let (dir_b, _b, core_b) = core();
    core_b
        .import_wallet(PASSWORD.into(), PHRASE.into(), None)
        .unwrap();
    core_a.lock();
    core_b.lock();
    let (a, b) = (read(&dir_a), read(&dir_b));

    let mut payload_swapped = a.clone();
    payload_swapped["payload"] = b["payload"].clone();
    write(&dir_a, &payload_swapped);
    refused(&dir_a, &payload_swapped);

    let mut slot_swapped = a.clone();
    slot_swapped["passwordSlot"] = b["passwordSlot"].clone();
    write(&dir_a, &slot_swapped);
    refused(&dir_a, &slot_swapped);
}

fn fixture_dir(text: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("vault.json"), text).unwrap();
    dir
}

#[test]
fn a_vault_security_v2_container_migrates_in_place_on_passphrase_unlock() {
    let dir = fixture_dir(V2_CONTAINER_FIXTURE);
    let before: Value = serde_json::from_str(V2_CONTAINER_FIXTURE).unwrap();
    let clock = FakeClock::new();
    let core = open(dir.path(), &clock);
    assert!(core.security_status().biometric_enabled);
    core.unlock(V2_CONTAINER_PASSWORD.into()).unwrap();

    let after = read(&dir);
    assert_eq!(after["version"], 4);
    assert_eq!(after["lineage"], before["lineage"]);
    assert_eq!(
        after["passwordSlot"], before["passwordSlot"],
        "same DEK, no KDF re-run"
    );
    assert_eq!(
        after["biometricSlot"], before["biometricSlot"],
        "the slot survives"
    );
    for network in [NetworkId::Mainnet, NetworkId::Sepolia] {
        let records = core.account_records(network).unwrap();
        assert_eq!(records.len(), 2, "accountCount 2 on {network:?}");
        assert!(records
            .iter()
            .all(|r| r.family == AccountFamily::OpenZeppelin));
    }
    assert_eq!(
        core.active_account().unwrap().unwrap().network,
        NetworkId::Mainnet
    );

    // The migrated file still opens by biometrics, and a second unlock writes nothing.
    core.lock();
    core.unlock_with_biometric(V2_WRAP_SECRET.to_vec()).unwrap();
    assert_eq!(read(&dir), after);
}

#[test]
fn a_vault_security_v2_container_migrates_on_biometric_unlock_too() {
    let dir = fixture_dir(V2_CONTAINER_FIXTURE);
    let core = open(dir.path(), &FakeClock::new());
    core.unlock_with_biometric(V2_WRAP_SECRET.to_vec()).unwrap();
    assert_eq!(
        read(&dir)["version"],
        4,
        "no passphrase needed: the DEK re-seals it"
    );
    assert_eq!(core.account_records(NetworkId::Sepolia).unwrap().len(), 2);
    core.lock();
    core.unlock(V2_CONTAINER_PASSWORD.into()).unwrap();
    assert_eq!(core.account_records(NetworkId::Mainnet).unwrap().len(), 2);
}

#[test]
fn an_accounts_branch_records_vault_migrates_into_a_container() {
    let dir = fixture_dir(V2_RECORDS_FIXTURE);
    let envelope: Value = serde_json::from_str(V2_RECORDS_FIXTURE).unwrap();
    let clock = FakeClock::new();
    let core = open(dir.path(), &clock);
    assert!(!core.security_status().biometric_enabled);
    core.unlock(V2_RECORDS_PASSWORD.into()).unwrap();

    let after = read(&dir);
    assert_eq!(after["format"], "bramble.mobile.vault");
    assert_eq!(after["version"], 4);
    assert_eq!(after["lineage"], envelope["lineage"], "lineage is kept");
    let sepolia = core.account_records(NetworkId::Sepolia).unwrap();
    let families: Vec<_> = sepolia
        .iter()
        .map(|r| (r.family, r.account_index))
        .collect();
    assert_eq!(
        families,
        [
            (AccountFamily::OpenZeppelin, 0),
            (AccountFamily::Argent, 1),
            (AccountFamily::Braavos, 2)
        ]
    );
    assert_eq!(sepolia[0].label.as_deref(), Some("Savings"));
    assert_eq!(sepolia[1].group_id.as_deref(), Some("long-term"));
    assert!(sepolia[2].view_only);
    let active = core.active_account().unwrap().unwrap();
    assert_eq!(active.network, NetworkId::Mainnet);
    assert_eq!(active.public_key, sepolia[0].public_key);

    core.lock();
    let reopened = open(dir.path(), &clock);
    reopened.unlock(V2_RECORDS_PASSWORD.into()).unwrap();
    assert_eq!(
        reopened.account_records(NetworkId::Sepolia).unwrap(),
        sepolia
    );
    assert_eq!(read(&dir), after, "migrates once");
}

fn payload_count(version: u32) -> String {
    json!({"accountCount": 1, "mnemonic": PHRASE, "mnemonicPassphrase": null, "version": version})
        .to_string()
}

#[test]
fn each_layout_refuses_payloads_it_was_never_written_with() {
    let (dir, clock, core) = imported();
    core.lock();
    let path = dir.path().to_string_lossy().to_string();
    let records: Value = serde_json::from_str(&open_vault(&path, PASSWORD).unwrap()).unwrap();
    let with_version = |version: u32| {
        let mut payload = records.clone();
        payload["version"] = json!(version);
        payload.to_string()
    };
    // (why, container version or None for a bare envelope, payload)
    let cases = [
        (
            "an envelope never held a count payload tagged 2",
            None,
            payload_count(2),
        ),
        (
            "an envelope never held records tagged 3",
            None,
            with_version(3),
        ),
        (
            "an envelope never held records tagged 1",
            None,
            with_version(1),
        ),
        (
            "a container never held a v1 payload",
            Some(2),
            payload_count(1),
        ),
        (
            "a v2 container never held records",
            Some(2),
            with_version(2),
        ),
        (
            "a v3 container never held a count",
            Some(3),
            payload_count(3),
        ),
        (
            "container and payload versions are bound",
            Some(3),
            payload_count(2),
        ),
        (
            "a v3 container's records never carried backupPending",
            Some(3),
            with_version(3),
        ),
        (
            "a v4 container never held a count",
            Some(4),
            payload_count(4),
        ),
    ];
    for (why, container, payload) in cases {
        match container {
            None => seal_envelope_vault(&path, PASSWORD, &payload).unwrap(),
            Some(version) => seal_container_vault(&path, PASSWORD, version, &payload).unwrap(),
        }
        let before = read(&dir);
        // Each refusal counts as a failed attempt; start every case unthrottled.
        let _ = std::fs::remove_file(dir.path().join("security.json"));
        let fresh = open(dir.path(), &clock);
        let result = fresh.unlock(PASSWORD.into());
        assert!(
            matches!(result, Err(CoreError::Storage { .. })),
            "{why}: {result:?}"
        );
        assert_eq!(read(&dir), before, "{why}: the file is left as it was");
    }
}
