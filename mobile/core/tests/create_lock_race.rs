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
    // The host locks while PBKDF2 runs (the app went to the background). How long that takes
    // depends on the machine and the build, so the lock is tried at widening delays until one
    // lands inside the key derivation; a lock that lands before or after it is no race at all.
    for delay_ms in [
        1, 2, 4, 8, 15, 25, 40, 60, 90, 135, 200, 300, 450, 700, 1_000, 1_500,
    ] {
        let (dir, _clock, core) = common::core();
        let creator = {
            let core = std::sync::Arc::clone(&core);
            thread::spawn(move || core.create_wallet(PASSWORD.into(), 12))
        };
        thread::sleep(Duration::from_millis(delay_ms));
        core.lock();
        match creator.join().unwrap() {
            Ok(_) => continue,
            Err(error) => assert!(matches!(error, CoreError::Locked), "{error:?}"),
        }
        assert!(dir.path().join("vault.json").exists());
        assert_eq!(core.status(), WalletStatus::Locked);
        assert!(matches!(
            core.create_wallet(PASSWORD.into(), 12),
            Err(CoreError::WalletExists)
        ));
        core.unlock(PASSWORD.into()).unwrap();
        assert!(core.backup_pending().unwrap());
        return;
    }
    panic!("no lock landed while the vault key was being derived");
}
