//! Vault file v1 → v2: old data migrates on the first passphrase unlock, current data round-trips,
//! and invalid data fails closed with no partial state.

mod common;

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use bramble_core::{CoreError, NetworkId, WalletStatus};
use common::{core, imported, open, FakeClock, PASSWORD, PHRASE};
use serde_json::{json, Value};

/// Written by the pre-migration core (commit 660a538e) from the published phrase with two
/// accounts. Public test data.
const V1_FIXTURE: &str = include_str!("fixtures/vault-v1.json");
const V1_PASSWORD: &str = "v1 fixture passphrase";

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
    assert_eq!(migrated["version"], 2);
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
    assert_eq!(read(&dir)["version"], 2);
    core.lock();
    core.unlock(V1_PASSWORD.into()).unwrap();
    assert_eq!(core.accounts(NetworkId::Sepolia).unwrap().len(), 3);
}

#[test]
fn a_current_v2_vault_round_trips() {
    let (dir, clock, core) = imported();
    let first = read(&dir);
    assert_eq!(first["version"], 2);
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
    edit(&|v| v["version"] = json!(3));
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
