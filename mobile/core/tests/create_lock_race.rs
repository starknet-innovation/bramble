mod common;

use std::thread;
use std::time::Duration;

use bramble_core::{CoreError, WalletStatus};
use common::PASSWORD;

/// A lock that overtakes `create_wallet` wins (no session is installed), but the vault it wrote
/// stays, locked, with its backup pending. Both hosts rely on exactly this: they route to Unlock,
/// and the unlock resumes at Save phrase, so the phrase the failed call dropped is still offered.
#[test]
fn a_lock_during_creation_leaves_a_locked_vault_whose_backup_is_still_owed() {
    let (dir, _clock, core) = common::core();
    let creator = {
        let core = std::sync::Arc::clone(&core);
        thread::spawn(move || core.create_wallet(PASSWORD.into(), 12))
    };
    // The host locks while PBKDF2 runs (the app went to the background).
    thread::sleep(Duration::from_millis(150));
    core.lock();
    assert!(matches!(creator.join().unwrap(), Err(CoreError::Locked)));
    assert!(dir.path().join("vault.json").exists());
    assert_eq!(core.status(), WalletStatus::Locked);
    assert!(matches!(
        core.create_wallet(PASSWORD.into(), 12),
        Err(CoreError::WalletExists)
    ));
    core.unlock(PASSWORD.into()).unwrap();
    assert!(core.backup_pending().unwrap());
}
