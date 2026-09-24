//! Lifecycle invariants of `WalletCore`: what is reachable in each state, and what is persisted.

mod common;

use bramble_core::{CoreError, NetworkId, WalletStatus};
use common::{FakeClock, PASSWORD, PHRASE};

fn core() -> (tempfile::TempDir, std::sync::Arc<bramble_core::WalletCore>) {
    let (dir, _clock, core) = common::core();
    (dir, core)
}

fn reopen(dir: &tempfile::TempDir) -> std::sync::Arc<bramble_core::WalletCore> {
    common::open(dir.path(), &FakeClock::new())
}

#[test]
fn lifecycle_gates_every_key_operation() {
    let (dir, core) = core();
    assert_eq!(core.status(), WalletStatus::NoWallet);
    assert!(matches!(
        core.accounts(NetworkId::Sepolia),
        Err(CoreError::NoWallet)
    ));

    let phrase = core.create_wallet(PASSWORD.into(), 12).unwrap();
    assert_eq!(phrase.words.len(), 12);
    assert_eq!(core.status(), WalletStatus::Unlocked);
    let first = core.accounts(NetworkId::Sepolia).unwrap();

    core.lock();
    assert_eq!(core.status(), WalletStatus::Locked);
    assert!(matches!(
        core.accounts(NetworkId::Sepolia),
        Err(CoreError::Locked)
    ));
    assert!(matches!(
        core.sign_hash(0, "0x1".into()),
        Err(CoreError::Locked)
    ));
    assert!(matches!(
        core.unlock("wrong password".into()),
        Err(CoreError::WrongPassword)
    ));

    // A fresh core over the same directory sees the persisted vault.
    let reopened = reopen(&dir);
    assert_eq!(reopened.status(), WalletStatus::Locked);
    reopened.unlock(PASSWORD.into()).unwrap();
    assert_eq!(reopened.accounts(NetworkId::Sepolia).unwrap(), first);
    assert_eq!(
        reopened
            .reveal_recovery_phrase(PASSWORD.into())
            .unwrap()
            .words,
        phrase.words
    );
}

#[test]
fn the_vault_on_disk_never_contains_the_phrase() {
    let (dir, core) = core();
    core.import_wallet(PASSWORD.into(), PHRASE.to_uppercase(), None)
        .unwrap();
    let on_disk = std::fs::read_to_string(dir.path().join("vault.json")).unwrap();
    for word in PHRASE.split(' ') {
        assert!(!on_disk.contains(word), "vault leaks {word}");
    }
    assert!(on_disk.contains("\"iterations\":600000"));
    assert!(on_disk.contains("\"format\":\"bramble.mobile.vault\""));
}

#[test]
fn added_accounts_persist_and_are_bounded_to_known_indexes() {
    let (dir, core) = core();
    core.import_wallet(PASSWORD.into(), PHRASE.into(), None)
        .unwrap();
    let second = core.add_account(NetworkId::Sepolia).unwrap();
    assert_eq!(second.index, 1);
    assert!(core.sign_hash(1, "0x1".into()).is_ok());
    assert!(matches!(
        core.sign_hash(2, "0x1".into()),
        Err(CoreError::InvalidInput { .. })
    ));
    assert!(matches!(
        core.sign_hash(0, "0xZZ".into()),
        Err(CoreError::InvalidInput { .. })
    ));

    let reopened = reopen(&dir);
    reopened.unlock(PASSWORD.into()).unwrap();
    assert_eq!(reopened.accounts(NetworkId::Sepolia).unwrap().len(), 2);
}

#[test]
fn refuses_weak_input_and_double_creation() {
    let (_dir, core) = core();
    assert!(matches!(
        core.create_wallet("short".into(), 12),
        Err(CoreError::InvalidInput { .. })
    ));
    assert!(matches!(
        core.create_wallet(PASSWORD.into(), 13),
        Err(CoreError::InvalidInput { .. })
    ));
    let invalid = PHRASE.replace("like", "habit");
    assert!(matches!(
        core.import_wallet(PASSWORD.into(), invalid, None),
        Err(CoreError::InvalidInput { .. })
    ));
    core.import_wallet(PASSWORD.into(), PHRASE.into(), None)
        .unwrap();
    assert!(matches!(
        core.create_wallet(PASSWORD.into(), 12),
        Err(CoreError::WalletExists)
    ));
}

#[test]
fn delete_requires_the_password() {
    let (_dir, core) = core();
    core.import_wallet(PASSWORD.into(), PHRASE.into(), None)
        .unwrap();
    assert!(core.delete_wallet("wrong password".into()).is_err());
    assert_eq!(core.status(), WalletStatus::Unlocked);
    core.delete_wallet(PASSWORD.into()).unwrap();
    assert_eq!(core.status(), WalletStatus::NoWallet);
}

#[test]
fn bip39_passphrase_changes_every_account() {
    let (_a, plain) = core();
    let (_b, protected) = core();
    plain
        .import_wallet(PASSWORD.into(), PHRASE.into(), None)
        .unwrap();
    protected
        .import_wallet(PASSWORD.into(), PHRASE.into(), Some("extra words".into()))
        .unwrap();
    assert_ne!(
        plain.accounts(NetworkId::Sepolia).unwrap(),
        protected.accounts(NetworkId::Sepolia).unwrap()
    );
}
