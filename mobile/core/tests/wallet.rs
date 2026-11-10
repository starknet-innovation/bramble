//! Lifecycle invariants of `WalletCore`: what is reachable in each state, and what is persisted.

mod common;

use bramble_core::{
    AccountFamily, CoreError, NetworkId, RecoverySelection, WalletCore, WalletStatus,
};
use common::{FakeClock, PASSWORD, PHRASE};

fn core() -> (tempfile::TempDir, std::sync::Arc<bramble_core::WalletCore>) {
    let (dir, _clock, core) = common::core();
    (dir, core)
}

fn reopen(dir: &tempfile::TempDir) -> std::sync::Arc<bramble_core::WalletCore> {
    common::open(dir.path(), &FakeClock::new())
}

/// An imported wallet waits for discovery; restore its OZ index 0 on `network`.
fn restore_first(core: &WalletCore, network: NetworkId) {
    core.restore_recovered_accounts(
        network,
        vec![RecoverySelection {
            family: AccountFamily::OpenZeppelin,
            account_index: 0,
            ladder: None,
            class_hash: None,
        }],
    )
    .unwrap();
}

#[test]
fn lifecycle_gates_every_key_operation() {
    let (dir, core) = core();
    assert_eq!(core.status(), WalletStatus::NoWallet);
    assert!(matches!(
        core.accounts(NetworkId::Sepolia),
        Err(CoreError::NoWallet)
    ));

    let phrase = core
        .create_wallet_on_network(PASSWORD.into(), 12, NetworkId::Sepolia)
        .unwrap();
    assert_eq!(phrase.words.len(), 12);
    assert_eq!(core.status(), WalletStatus::Unlocked);
    let first = core.accounts(NetworkId::Sepolia).unwrap();
    assert_eq!(
        first.len(),
        1,
        "create writes OZ index 0 on the chosen network"
    );
    assert!(core.accounts(NetworkId::Mainnet).unwrap().is_empty());
    let first_id = core.active_account().unwrap().unwrap().id;

    core.lock();
    assert_eq!(core.status(), WalletStatus::Locked);
    assert!(matches!(
        core.accounts(NetworkId::Sepolia),
        Err(CoreError::Locked)
    ));
    assert!(matches!(
        core.sign_hash_for_account(first_id.clone(), "0x1".into()),
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
    assert!(core.recovery_pending().unwrap());
    assert!(core.accounts(NetworkId::Sepolia).unwrap().is_empty());
    assert!(
        core.add_account(NetworkId::Sepolia).is_err(),
        "no adding before discovery"
    );
    restore_first(&core, NetworkId::Sepolia);
    let second = core.add_regular_account(NetworkId::Sepolia).unwrap();
    assert_eq!(second.account_index, 1);
    assert!(core
        .sign_hash_for_account(second.id.clone(), "0x1".into())
        .is_ok());
    assert!(matches!(
        core.sign_hash_for_account("SN_SEPOLIA:0x2".into(), "0x1".into()),
        Err(CoreError::InvalidInput { .. })
    ));
    assert!(matches!(
        core.sign_hash_for_account(second.id, "0xZZ".into()),
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

/// The shared core seals under any passphrase, so the minimum is Bramble's to hold on every
/// path that makes a vault. Seven characters is one under it; nothing may reach the disk.
#[test]
fn a_passphrase_under_the_minimum_is_refused_on_create_and_on_import() {
    use bramble_core::testing::{seal_container_vault, seal_envelope_vault, MIN_PASSWORD_LENGTH};
    let short = "p".repeat(MIN_PASSWORD_LENGTH - 1);
    let (dir, core) = core();
    let refused = |result: Result<(), CoreError>| {
        assert!(matches!(result, Err(CoreError::InvalidInput { .. })));
        assert!(!dir.path().join("vault.json").exists());
    };
    refused(core.create_wallet(short.clone(), 12).map(|_| ()));
    refused(
        core.create_wallet_on_network(short.clone(), 12, NetworkId::Sepolia)
            .map(|_| ()),
    );
    refused(core.import_wallet(short.clone(), PHRASE.into(), None));
    let path = dir.path().to_str().unwrap();
    refused(seal_envelope_vault(path, &short, "{}"));
    refused(seal_container_vault(path, &short, 2, "{}"));
    core.import_wallet("p".repeat(MIN_PASSWORD_LENGTH), PHRASE.into(), None)
        .unwrap();
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
    restore_first(&plain, NetworkId::Sepolia);
    restore_first(&protected, NetworkId::Sepolia);
    assert_ne!(
        plain.accounts(NetworkId::Sepolia).unwrap(),
        protected.accounts(NetworkId::Sepolia).unwrap()
    );
}

#[test]
fn a_new_wallet_never_inherits_metadata_left_without_a_vault() {
    let (dir, core) = core();
    for file in ["contacts.json", "multisigs.json", "coordination.json"] {
        std::fs::write(dir.path().join(file), "{\"version\":1}").unwrap();
    }
    core.import_wallet(PASSWORD.into(), PHRASE.into(), None)
        .unwrap();
    for file in ["contacts.json", "multisigs.json", "coordination.json"] {
        assert!(!dir.path().join(file).exists(), "{file}");
    }
}
