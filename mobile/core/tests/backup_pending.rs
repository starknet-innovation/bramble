//! The backup-pending flag (vault version 4, `src/backup.rs`): set when a wallet is created,
//! kept across lock and restart, cleared only by `confirm_backup`; never set by an import; and
//! the version-3 → 4 migration over a real file written by the version-3 core.

mod common;

use bramble_core::testing::open_vault;
use bramble_core::{CoreError, NetworkId};
use common::{core, open, pending, FakeClock, PASSWORD};
use serde_json::Value;

/// Written by the version-3 core (88666b49): the published phrase imported, OZ 0 and 1 restored
/// on Sepolia, and a biometric slot under the wrap secret `[7; 32]` with no domain. Public test
/// data.
const V3_FIXTURE: &str = include_str!("fixtures/vault-v3-container.json");
const V3_PASSWORD: &str = "v3 fixture passphrase";
const V3_WRAP_SECRET: [u8; 32] = [7; 32];

fn read(dir: &tempfile::TempDir) -> Value {
    serde_json::from_str(&std::fs::read_to_string(dir.path().join("vault.json")).unwrap()).unwrap()
}

fn stored_payload(dir: &tempfile::TempDir, password: &str) -> Value {
    serde_json::from_str(&open_vault(&dir.path().to_string_lossy(), password).unwrap()).unwrap()
}

#[test]
fn a_created_wallet_stays_backup_pending_until_confirmed() {
    let (dir, clock, core) = core();
    let words = core
        .create_wallet_on_network(PASSWORD.into(), 12, NetworkId::Sepolia)
        .unwrap()
        .words;
    assert!(core.backup_pending().unwrap());
    assert_eq!(stored_payload(&dir, PASSWORD)["backupPending"], true);

    // A lock (or a restart) before Confirm backup leaves it owed.
    core.lock();
    assert!(matches!(core.backup_pending(), Err(CoreError::Locked)));
    assert!(matches!(core.confirm_backup(), Err(CoreError::Locked)));
    let restarted = open(dir.path(), &clock);
    restarted.unlock(PASSWORD.into()).unwrap();
    assert!(restarted.backup_pending().unwrap());
    // The words come back only through the password-checked path.
    assert_eq!(
        restarted
            .reveal_recovery_phrase(PASSWORD.into())
            .unwrap()
            .words,
        words
    );

    restarted.confirm_backup().unwrap();
    assert!(!restarted.backup_pending().unwrap());
    restarted.confirm_backup().unwrap(); // idempotent
    assert_eq!(stored_payload(&dir, PASSWORD)["backupPending"], false);
    restarted.lock();
    let again = open(dir.path(), &clock);
    again.unlock(PASSWORD.into()).unwrap();
    assert!(!again.backup_pending().unwrap(), "cleared for good");
    assert_eq!(read(&dir)["version"], 4);
}

#[test]
fn an_imported_wallet_is_never_backup_pending() {
    let (dir, _clock, core) = pending();
    assert!(!core.backup_pending().unwrap());
    assert_eq!(stored_payload(&dir, PASSWORD)["backupPending"], false);
}

#[test]
fn no_wallet_has_no_backup_state() {
    let (_dir, _clock, core) = core();
    assert!(matches!(core.backup_pending(), Err(CoreError::NoWallet)));
}

#[test]
fn a_version_three_container_migrates_in_place_with_no_backup_owed() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("vault.json"), V3_FIXTURE).unwrap();
    let before: Value = serde_json::from_str(V3_FIXTURE).unwrap();
    assert_eq!(before["version"], 3);
    let clock = FakeClock::new();
    let core = open(dir.path(), &clock);
    assert!(core.security_status().biometric_enabled);
    core.unlock(V3_PASSWORD.into()).unwrap();

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
    assert!(!core.backup_pending().unwrap());
    assert_eq!(core.account_records(NetworkId::Sepolia).unwrap().len(), 2);
    let payload = stored_payload(&dir, V3_PASSWORD);
    assert_eq!(payload["version"], 4);
    assert_eq!(payload["backupPending"], false);

    // Still opens by biometrics, and a second unlock writes nothing.
    core.lock();
    core.unlock_with_biometric(V3_WRAP_SECRET.to_vec()).unwrap();
    assert_eq!(read(&dir), after);
}

#[test]
fn a_version_three_container_also_migrates_on_biometric_unlock() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("vault.json"), V3_FIXTURE).unwrap();
    let core = open(dir.path(), &FakeClock::new());
    core.unlock_with_biometric(V3_WRAP_SECRET.to_vec()).unwrap();
    assert_eq!(read(&dir)["version"], 4);
    assert!(!core.backup_pending().unwrap());
    core.lock();
    core.unlock(V3_PASSWORD.into()).unwrap();
    assert_eq!(core.account_records(NetworkId::Sepolia).unwrap().len(), 2);
}
