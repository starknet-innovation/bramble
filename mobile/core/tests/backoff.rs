//! Wrong-passphrase backoff: enforced by the core, persisted across restarts, measured only on
//! the host's monotonic clock, and serialised so concurrent guesses are all counted.

mod common;

use std::sync::Arc;
use std::thread;

use bramble_core::testing::delay_ms;
use bramble_core::{CoreError, WalletStatus};
use common::{imported, open, PASSWORD, WRONG};

fn throttled(result: Result<(), CoreError>) -> u64 {
    match result {
        Err(CoreError::Throttled { retry_after_ms }) => retry_after_ms,
        other => panic!("expected Throttled, got {other:?}"),
    }
}

fn wrong(result: Result<(), CoreError>) {
    assert!(
        matches!(result, Err(CoreError::WrongPassword)),
        "expected WrongPassword, got {result:?}"
    );
}

#[test]
fn four_typos_are_free_then_the_delay_doubles_from_thirty_seconds() {
    let (_dir, clock, core) = imported();
    core.lock();
    for _ in 0..4 {
        wrong(core.unlock(WRONG.into()));
    }
    assert_eq!(core.security_status().retry_after_ms, 0);
    wrong(core.unlock(WRONG.into()));
    assert_eq!(throttled(core.unlock(PASSWORD.into())), 30_000);
    clock.advance(10_000);
    assert_eq!(throttled(core.unlock(PASSWORD.into())), 20_000);
    clock.advance(20_000);
    wrong(core.unlock(WRONG.into()));
    assert_eq!(throttled(core.unlock(PASSWORD.into())), 60_000);
    let status = core.security_status();
    assert_eq!((status.failed_attempts, status.retry_after_ms), (6, 60_000));
    assert_eq!(delay_ms(12), 3_600_000);
}

#[test]
fn the_counter_survives_a_restart_and_success_resets_it() {
    let (dir, clock, core) = imported();
    core.lock();
    for _ in 0..5 {
        wrong(core.unlock(WRONG.into()));
    }
    drop(core);
    let restarted = open(dir.path(), &clock);
    assert_eq!(throttled(restarted.unlock(PASSWORD.into())), 30_000);
    clock.advance(30_000);
    restarted.unlock(PASSWORD.into()).unwrap();
    assert_eq!(restarted.security_status().failed_attempts, 0);
    restarted.lock();
    wrong(restarted.unlock(WRONG.into()));
    assert_eq!(restarted.security_status().retry_after_ms, 0);
}

#[test]
fn moving_the_wall_clock_either_way_changes_nothing() {
    let (_dir, clock, core) = imported();
    core.lock();
    for _ in 0..5 {
        wrong(core.unlock(WRONG.into()));
    }
    // Settings > Date & Time, one day forward then two days back: the delay is untouched.
    clock.shift_wall(24 * 3_600_000);
    assert_eq!(throttled(core.unlock(PASSWORD.into())), 30_000);
    clock.shift_wall(-48 * 3_600_000);
    assert_eq!(throttled(core.unlock(PASSWORD.into())), 30_000);
    clock.advance(29_999);
    assert_eq!(throttled(core.unlock(PASSWORD.into())), 1);
}

#[test]
fn a_reboot_or_a_backwards_monotonic_clock_restarts_the_full_delay() {
    let (_dir, clock, core) = imported();
    core.lock();
    for _ in 0..6 {
        if core.security_status().retry_after_ms > 0 {
            clock.advance(core.security_status().retry_after_ms);
        }
        wrong(core.unlock(WRONG.into()));
    }
    clock.advance(59_000);
    assert_eq!(throttled(core.unlock(PASSWORD.into())), 1_000);
    // Rebooting to escape the last second costs the whole minute again.
    clock.reboot("boot-2", 5);
    assert_eq!(core.security_status().retry_after_ms, 60_000);
    assert_eq!(throttled(core.unlock(PASSWORD.into())), 60_000);
    clock.advance(30_000);
    assert_eq!(throttled(core.unlock(PASSWORD.into())), 30_000);
    // A monotonic value below the stamp (a host bug or tampering) restarts it too.
    clock.set_monotonic(1);
    assert_eq!(throttled(core.unlock(PASSWORD.into())), 60_000);
    clock.advance(60_000);
    core.unlock(PASSWORD.into()).unwrap();
}

#[test]
fn every_passphrase_entry_point_shares_one_counter() {
    let (_dir, _clock, core) = imported();
    wrong(core.reveal_recovery_phrase(WRONG.into()).map(drop));
    wrong(core.delete_wallet(WRONG.into()));
    wrong(core.enable_biometric_unlock(WRONG.into(), vec![1; 32], None));
    core.lock();
    wrong(core.unlock(WRONG.into()));
    assert_eq!(core.security_status().failed_attempts, 4);
    wrong(core.reveal_recovery_phrase(WRONG.into()).map(drop));
    assert_eq!(throttled(core.delete_wallet(PASSWORD.into())), 30_000);
    assert_eq!(
        throttled(core.reveal_recovery_phrase(PASSWORD.into()).map(drop)),
        30_000
    );
    assert_eq!(
        throttled(core.enable_biometric_unlock(PASSWORD.into(), vec![1; 32], None)),
        30_000
    );
    assert_eq!(core.status(), WalletStatus::Locked);
}

#[test]
fn a_throttled_call_never_reads_the_vault_and_a_missing_vault_is_not_counted() {
    let (dir, _clock, core) = imported();
    core.lock();
    for _ in 0..5 {
        wrong(core.unlock(WRONG.into()));
    }
    let vault = dir.path().join("vault.json");
    let saved = std::fs::read(&vault).unwrap();
    std::fs::write(&vault, b"not json").unwrap();
    assert_eq!(throttled(core.unlock(PASSWORD.into())), 30_000);
    std::fs::remove_file(&vault).unwrap();
    assert_eq!(throttled(core.unlock(PASSWORD.into())), 30_000);
    std::fs::write(&vault, saved).unwrap();

    let (_empty, _clock, fresh) = common::core();
    assert!(matches!(
        fresh.unlock(PASSWORD.into()),
        Err(CoreError::NoWallet)
    ));
    assert_eq!(fresh.security_status().failed_attempts, 0);
}

#[test]
fn a_malformed_state_file_throttles_instead_of_resetting() {
    let (dir, _clock, core) = imported();
    core.lock();
    std::fs::write(dir.path().join("security.json"), b"{\"failedAttempts\":0}").unwrap();
    assert_eq!(throttled(core.unlock(PASSWORD.into())), 30_000);
    assert_eq!(core.security_status().failed_attempts, 5);
}

#[test]
fn concurrent_guesses_are_all_counted_and_each_one_ran_the_kdf() {
    let (_dir, _clock, core) = imported();
    core.lock();
    let calls: Vec<_> = (0..12)
        .map(|index| {
            let core = Arc::clone(&core);
            thread::spawn(move || match index % 3 {
                0 => core.unlock(WRONG.into()),
                1 => core.reveal_recovery_phrase(WRONG.into()).map(drop),
                _ => core.delete_wallet(WRONG.into()),
            })
        })
        .collect();
    let (mut kdf_runs, mut refused) = (0u32, 0u32);
    for call in calls {
        match call.join().unwrap() {
            // A wrong passphrase can only be reported after PBKDF2 ran on it.
            Err(CoreError::WrongPassword) => kdf_runs += 1,
            Err(CoreError::Throttled { .. }) => refused += 1,
            other => panic!("unexpected {other:?}"),
        }
    }
    assert_eq!(
        kdf_runs, 5,
        "four free guesses plus the one that earns the delay"
    );
    assert_eq!(refused, 7);
    assert_eq!(core.security_status().failed_attempts, kdf_runs);
}

#[test]
fn biometric_unlock_works_while_throttled_and_does_not_reset_the_counter() {
    let (_dir, _clock, core) = imported();
    core.enable_biometric_unlock(PASSWORD.into(), vec![7; 32], None)
        .unwrap();
    core.lock();
    for _ in 0..5 {
        wrong(core.unlock(WRONG.into()));
    }
    core.unlock_with_biometric(vec![7; 32]).unwrap();
    assert_eq!(core.status(), WalletStatus::Unlocked);
    let status = core.security_status();
    assert_eq!((status.failed_attempts, status.retry_after_ms), (5, 30_000));
}
