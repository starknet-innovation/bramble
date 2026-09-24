//! Idle auto-lock: the extension's 30-minute rolling window, renewed only by user-initiated
//! operations and measured on the monotonic clock.

mod common;

use bramble_core::testing::IDLE_LOCK_MS;
use bramble_core::{CoreError, NetworkId, WalletStatus};
use common::{account_id, imported, PASSWORD};

#[test]
fn the_session_ends_after_thirty_idle_minutes() {
    let (_dir, clock, core) = imported();
    assert_eq!(IDLE_LOCK_MS, 30 * 60 * 1000);
    assert_eq!(core.session_remaining_ms(), Some(IDLE_LOCK_MS));
    clock.advance(IDLE_LOCK_MS - 1);
    assert_eq!(core.status(), WalletStatus::Unlocked);
    assert_eq!(core.session_remaining_ms(), Some(1));
    clock.advance(1);
    assert_eq!(core.status(), WalletStatus::Locked);
    assert!(matches!(
        core.accounts(NetworkId::Sepolia),
        Err(CoreError::Locked)
    ));
    assert_eq!(core.session_remaining_ms(), None);
    assert_eq!(core.security_status().session_remaining_ms, None);
}

#[test]
fn reads_never_renew_the_window() {
    let (_dir, clock, core) = imported();
    clock.advance(IDLE_LOCK_MS - 1_000);
    core.accounts(NetworkId::Sepolia).unwrap();
    core.status();
    core.security_status();
    core.session_remaining_ms();
    clock.advance(1_000);
    assert!(matches!(
        core.accounts(NetworkId::Mainnet),
        Err(CoreError::Locked)
    ));
}

#[test]
fn user_initiated_operations_renew_the_window() {
    let (_dir, clock, core) = imported();
    let first = account_id(&core);
    clock.advance(IDLE_LOCK_MS - 1_000);
    core.sign_hash_for_account(first.clone(), "0x1".into())
        .unwrap();
    clock.advance(IDLE_LOCK_MS - 1_000);
    core.add_regular_account(NetworkId::Sepolia).unwrap();
    clock.advance(IDLE_LOCK_MS - 1_000);
    // Deriving onto another network is a phrase operation, as in the extension.
    core.ensure_network_account(NetworkId::Mainnet).unwrap();
    clock.advance(IDLE_LOCK_MS - 1_000);
    core.reveal_recovery_phrase(PASSWORD.into()).unwrap();
    clock.advance(IDLE_LOCK_MS - 1_000);
    assert_eq!(core.status(), WalletStatus::Unlocked);
    clock.advance(1_000);
    assert_eq!(core.status(), WalletStatus::Locked);
    // Revealing while locked does not resurrect the session.
    core.reveal_recovery_phrase(PASSWORD.into()).unwrap();
    assert_eq!(core.status(), WalletStatus::Locked);
}

#[test]
fn an_unreadable_clock_locks_instead_of_extending_or_panicking() {
    let (_dir, clock, core) = imported();
    clock.set_monotonic(0);
    assert_eq!(core.status(), WalletStatus::Locked);

    core.unlock(PASSWORD.into()).unwrap();
    clock.reboot("boot-2", clock.monotonic() + 1);
    assert_eq!(core.session_remaining_ms(), None);
    assert_eq!(core.status(), WalletStatus::Locked);
}

#[test]
fn moving_the_wall_clock_does_not_touch_the_session() {
    let (_dir, clock, core) = imported();
    clock.shift_wall(-365 * 24 * 3_600_000);
    clock.advance(IDLE_LOCK_MS);
    assert_eq!(core.status(), WalletStatus::Locked);
    core.unlock(PASSWORD.into()).unwrap();
    clock.shift_wall(365 * 24 * 3_600_000);
    assert_eq!(core.session_remaining_ms(), Some(IDLE_LOCK_MS));
}

#[test]
fn lock_always_ends_the_session() {
    let (_dir, _clock, core) = imported();
    let first = account_id(&core);
    core.lock();
    assert_eq!(core.status(), WalletStatus::Locked);
    assert!(matches!(
        core.sign_hash_for_account(first, "0x1".into()),
        Err(CoreError::Locked)
    ));
}

#[test]
fn account_reads_and_preferences_are_passive() {
    // Labels, groups and selection are plain preferences in the extension: no `getPassphrase`,
    // so they never renew the window.
    let (_dir, clock, core) = imported();
    let first = account_id(&core);
    clock.advance(IDLE_LOCK_MS - 1_000);
    core.account_records(NetworkId::Sepolia).unwrap();
    core.active_account().unwrap();
    core.select_account(first.clone()).unwrap();
    core.set_account_label(first, "Savings".into()).unwrap();
    core.create_account_group("Long term".into(), "piggyBank".into())
        .unwrap();
    clock.advance(1_000);
    assert_eq!(core.status(), WalletStatus::Locked);
}
