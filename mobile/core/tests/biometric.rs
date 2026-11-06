//! Biometric slot: an opt-in second wrap of the DEK that never replaces the passphrase, dropped
//! only on a real enrolment change or a slot the wrap secret no longer opens.

mod common;

use bramble_core::{BiometricDomain, CoreError, NetworkId, WalletStatus};
use common::{imported, PASSWORD, WRONG};
use serde_json::Value;

const W: [u8; 32] = [42; 32];

fn vault(dir: &tempfile::TempDir) -> Value {
    serde_json::from_str(&std::fs::read_to_string(dir.path().join("vault.json")).unwrap()).unwrap()
}

fn state(bytes: &[u8]) -> BiometricDomain {
    BiometricDomain::State {
        value: bytes.to_vec(),
    }
}

#[test]
fn enable_then_unlock_with_the_wrap_secret() {
    let (dir, _clock, core) = imported();
    let accounts = core.accounts(NetworkId::Sepolia).unwrap();
    assert!(!core.security_status().biometric_enabled);
    core.enable_biometric_unlock(PASSWORD.into(), W.to_vec(), Some(b"domain-a".to_vec()))
        .unwrap();
    assert!(core.security_status().biometric_enabled);
    let slot = &vault(&dir)["biometricSlot"];
    assert_eq!(slot["domain"].as_str().unwrap().len(), 64);
    core.lock();
    core.unlock_with_biometric(W.to_vec()).unwrap();
    assert_eq!(core.status(), WalletStatus::Unlocked);
    assert_eq!(core.accounts(NetworkId::Sepolia).unwrap(), accounts);
}

#[test]
fn a_wrong_wrap_secret_drops_the_slot() {
    let (_dir, _clock, core) = imported();
    core.enable_biometric_unlock(PASSWORD.into(), W.to_vec(), None)
        .unwrap();
    core.lock();
    assert!(matches!(
        core.unlock_with_biometric(vec![1; 32]),
        Err(CoreError::BiometricInvalidated)
    ));
    assert!(!core.security_status().biometric_enabled);
    assert!(matches!(
        core.unlock_with_biometric(W.to_vec()),
        Err(CoreError::BiometricUnavailable)
    ));
    core.unlock(PASSWORD.into()).unwrap();
}

#[test]
fn a_wrap_secret_of_the_wrong_length_is_refused_and_not_counted() {
    let (_dir, _clock, core) = imported();
    for bad in [vec![], vec![1; 31], vec![1; 33]] {
        assert!(matches!(
            core.enable_biometric_unlock(PASSWORD.into(), bad.clone(), None),
            Err(CoreError::InvalidInput { .. })
        ));
        assert!(matches!(
            core.unlock_with_biometric(bad),
            Err(CoreError::InvalidInput { .. })
        ));
    }
    assert_eq!(core.security_status().failed_attempts, 0);
}

#[test]
fn enabling_needs_the_passphrase_and_is_counted() {
    let (_dir, _clock, core) = imported();
    assert!(matches!(
        core.enable_biometric_unlock(WRONG.into(), W.to_vec(), None),
        Err(CoreError::WrongPassword)
    ));
    assert_eq!(core.security_status().failed_attempts, 1);
    assert!(!core.security_status().biometric_enabled);
    assert!(matches!(
        core.unlock_with_biometric(W.to_vec()),
        Err(CoreError::BiometricUnavailable)
    ));
}

#[test]
fn an_enrolment_change_locks_and_drops_the_slot() {
    for changed in [state(b"domain-b"), BiometricDomain::NotEnrolled] {
        let (_dir, _clock, core) = imported();
        core.enable_biometric_unlock(PASSWORD.into(), W.to_vec(), Some(b"domain-a".to_vec()))
            .unwrap();
        core.reconcile_biometric_domain(state(b"domain-a")).unwrap();
        assert_eq!(core.status(), WalletStatus::Unlocked);
        assert!(matches!(
            core.reconcile_biometric_domain(changed),
            Err(CoreError::BiometricInvalidated)
        ));
        assert_eq!(core.status(), WalletStatus::Locked);
        assert!(!core.security_status().biometric_enabled);
    }
}

#[test]
fn a_lockout_or_unavailable_biometry_keeps_the_slot_and_the_session() {
    let (_dir, _clock, core) = imported();
    core.enable_biometric_unlock(PASSWORD.into(), W.to_vec(), Some(b"domain-a".to_vec()))
        .unwrap();
    // A non-matching face, a cancel or a lockout never reaches the core as a failure; the host
    // reports lockout as Unavailable when reconciling.
    core.reconcile_biometric_domain(BiometricDomain::Unavailable)
        .unwrap();
    assert_eq!(core.status(), WalletStatus::Unlocked);
    assert!(core.security_status().biometric_enabled);
    core.lock();
    core.unlock_with_biometric(W.to_vec()).unwrap();
}

#[test]
fn an_edited_domain_hash_no_longer_opens_the_slot() {
    // The domain hash is authenticated: blanking it (to skip the enrolment check) or swapping it
    // for another hash turns the slot into one the wrap secret cannot open, which drops it.
    for forged in ["", &"0".repeat(64)] {
        let (dir, clock, core) = imported();
        core.enable_biometric_unlock(PASSWORD.into(), W.to_vec(), Some(b"domain-a".to_vec()))
            .unwrap();
        core.lock();
        drop(core);
        let mut file = vault(&dir);
        file["biometricSlot"]["domain"] = Value::String(forged.into());
        std::fs::write(dir.path().join("vault.json"), file.to_string()).unwrap();
        let core = common::open(dir.path(), &clock);
        assert!(matches!(
            core.unlock_with_biometric(W.to_vec()),
            Err(CoreError::BiometricInvalidated)
        ));
        assert!(!core.security_status().biometric_enabled);
        core.unlock(PASSWORD.into()).unwrap();
    }
}

#[test]
fn a_slot_without_a_domain_survives_reconciling() {
    let (_dir, _clock, core) = imported();
    core.enable_biometric_unlock(PASSWORD.into(), W.to_vec(), None)
        .unwrap();
    core.reconcile_biometric_domain(state(b"anything")).unwrap();
    assert!(core.security_status().biometric_enabled);
}

#[test]
fn the_platform_reporting_invalidation_locks_and_drops_the_slot() {
    let (_dir, _clock, core) = imported();
    core.enable_biometric_unlock(PASSWORD.into(), W.to_vec(), None)
        .unwrap();
    core.biometric_invalidated().unwrap();
    assert_eq!(core.status(), WalletStatus::Locked);
    assert!(!core.security_status().biometric_enabled);
}

#[test]
fn disabling_needs_no_key_and_works_while_locked() {
    let (_dir, _clock, core) = imported();
    core.enable_biometric_unlock(PASSWORD.into(), W.to_vec(), None)
        .unwrap();
    core.lock();
    core.disable_biometric_unlock().unwrap();
    assert!(!core.security_status().biometric_enabled);
    assert!(matches!(
        core.unlock_with_biometric(W.to_vec()),
        Err(CoreError::BiometricUnavailable)
    ));
}

#[test]
fn adding_an_account_reseals_only_the_payload() {
    let (dir, _clock, core) = imported();
    core.enable_biometric_unlock(PASSWORD.into(), W.to_vec(), None)
        .unwrap();
    core.lock();
    core.unlock_with_biometric(W.to_vec()).unwrap();
    let before = vault(&dir);
    core.add_account(NetworkId::Sepolia).unwrap();
    let after = vault(&dir);
    assert_eq!(before["passwordSlot"], after["passwordSlot"]);
    assert_eq!(before["biometricSlot"], after["biometricSlot"]);
    assert_ne!(before["payload"], after["payload"]);
    core.lock();
    core.unlock(PASSWORD.into()).unwrap();
    assert_eq!(core.accounts(NetworkId::Sepolia).unwrap().len(), 2);
}

#[test]
fn revealing_after_a_biometric_unlock_still_needs_the_passphrase() {
    let (_dir, _clock, core) = imported();
    core.enable_biometric_unlock(PASSWORD.into(), W.to_vec(), None)
        .unwrap();
    core.lock();
    core.unlock_with_biometric(W.to_vec()).unwrap();
    assert!(matches!(
        core.reveal_recovery_phrase(WRONG.into()),
        Err(CoreError::WrongPassword)
    ));
    assert_eq!(
        core.reveal_recovery_phrase(PASSWORD.into())
            .unwrap()
            .words
            .len(),
        12
    );
}

#[test]
fn a_locked_call_after_lock_cannot_reinstall_a_session() {
    let (_dir, _clock, core) = imported();
    core.enable_biometric_unlock(PASSWORD.into(), W.to_vec(), None)
        .unwrap();
    core.lock();
    core.unlock_with_biometric(W.to_vec()).unwrap();
    core.lock();
    assert_eq!(core.status(), WalletStatus::Locked);
}
