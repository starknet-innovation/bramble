//! Wrong-passphrase backoff, persisted in `security.json` beside the vault.
//!
//! Enforced here rather than in the UI: every passphrase entry point in `WalletCore` runs
//! `check` → `begin_attempt` → KDF → `reset` under one attempt mutex, so the counter is read,
//! checked, incremented and made durable before PBKDF2 starts, and two concurrent calls can never
//! both spend the same allowance. Delays count down only in monotonic time (`clock`): a new boot
//! or a backwards clock restarts the full delay, and the wall clock is never consulted.
//!
//! The file is not encrypted or authenticated (there is no key after a failed attempt). Anyone
//! able to edit it can already copy `vault.json` and guess offline, so it defends against guessing
//! through the device's own UI only. A malformed file fails closed at the first backoff step.

use std::fs;
use std::io::ErrorKind;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::clock::ClockReading;
use crate::files::{storage, write_atomic};
use crate::CoreError;

pub(crate) const SECURITY_FILE: &str = "security.json";
const STATE_VERSION: u32 = 1;
/// Failures allowed with no delay (typos).
pub const FREE_ATTEMPTS: u32 = 4;
/// The first delay, after the fifth failure; it doubles per further failure.
pub const BASE_DELAY_MS: u64 = 30_000;
/// The delay never exceeds one hour.
pub const MAX_DELAY_MS: u64 = 3_600_000;

/// Delay owed after `failed` consecutive wrong passphrases.
pub fn delay_ms(failed: u32) -> u64 {
    if failed <= FREE_ATTEMPTS {
        return 0;
    }
    let doublings = failed - FREE_ATTEMPTS - 1;
    if doublings >= 16 {
        return MAX_DELAY_MS;
    }
    (BASE_DELAY_MS << doublings).min(MAX_DELAY_MS)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SecurityState {
    version: u32,
    pub failed_attempts: u32,
    boot_id: String,
    monotonic_at_failure_ms: u64,
}

impl SecurityState {
    fn stamped(failed_attempts: u32, now: &ClockReading) -> Self {
        Self {
            version: STATE_VERSION,
            failed_attempts,
            boot_id: now.boot_id.clone(),
            monotonic_at_failure_ms: now.monotonic_ms,
        }
    }

    /// Milliseconds before another attempt is allowed. `None` means the stamp cannot be compared
    /// with `now` (new boot, clock went backwards): the caller restarts the full delay.
    fn remaining_ms(&self, now: &ClockReading) -> Option<u64> {
        let delay = delay_ms(self.failed_attempts);
        if delay == 0 {
            return Some(0);
        }
        let elapsed = now.elapsed_since(&self.boot_id, self.monotonic_at_failure_ms)?;
        Some(delay.saturating_sub(elapsed))
    }
}

/// What reading the file found.
enum Loaded {
    Valid(SecurityState),
    Missing,
    Malformed,
}

fn read(dir: &Path) -> Result<Loaded, CoreError> {
    let text = match fs::read_to_string(dir.join(SECURITY_FILE)) {
        Ok(text) => text,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Loaded::Missing),
        Err(error) if error.kind() == ErrorKind::InvalidData => return Ok(Loaded::Malformed),
        Err(_) => return Err(storage("read security state")),
    };
    Ok(match serde_json::from_str::<SecurityState>(&text) {
        Ok(state) if state.version == STATE_VERSION && state.boot_id.len() <= 256 => {
            Loaded::Valid(state)
        }
        _ => Loaded::Malformed,
    })
}

fn save(dir: &Path, state: &SecurityState) -> Result<(), CoreError> {
    let body = serde_json::to_vec(state).map_err(|_| storage("serialise security state"))?;
    write_atomic(dir, SECURITY_FILE, &body)
}

/// Loads the state for an attempt. A malformed file is rewritten as five failures stamped now:
/// never a reset to zero, and never a long lockout of the owner.
fn load(dir: &Path, now: &ClockReading) -> Result<SecurityState, CoreError> {
    match read(dir)? {
        Loaded::Valid(state) => Ok(state),
        Loaded::Missing => Ok(SecurityState::stamped(0, now)),
        Loaded::Malformed => {
            let state = SecurityState::stamped(FREE_ATTEMPTS + 1, now);
            save(dir, &state)?;
            Ok(state)
        }
    }
}

/// Refuses the attempt while a delay is owed. When the stamp is from another boot or the future,
/// it is re-stamped with `now` and the full delay starts again. Call under the attempt mutex.
pub(crate) fn check(dir: &Path, now: &ClockReading) -> Result<SecurityState, CoreError> {
    let mut state = load(dir, now)?;
    match state.remaining_ms(now) {
        Some(0) => Ok(state),
        Some(retry_after_ms) => Err(CoreError::Throttled { retry_after_ms }),
        None => {
            state.boot_id.clone_from(&now.boot_id);
            state.monotonic_at_failure_ms = now.monotonic_ms;
            save(dir, &state)?;
            Err(CoreError::Throttled {
                retry_after_ms: delay_ms(state.failed_attempts),
            })
        }
    }
}

/// Counts the attempt as failed and makes that durable *before* the KDF runs, so killing the app
/// mid-attempt cannot earn a free guess. A write failure refuses the attempt.
pub(crate) fn begin_attempt(
    dir: &Path,
    state: &SecurityState,
    now: &ClockReading,
) -> Result<(), CoreError> {
    save(
        dir,
        &SecurityState::stamped(state.failed_attempts.saturating_add(1), now),
    )
}

/// Clears the counter after the passphrase was proven correct.
pub(crate) fn reset(dir: &Path, now: &ClockReading) -> Result<(), CoreError> {
    save(dir, &SecurityState::stamped(0, now))
}

/// Passive view for the UI: `(failed attempts, ms until the next attempt)`. Never writes.
pub(crate) fn status(dir: &Path, now: &ClockReading) -> (u32, u64) {
    match read(dir) {
        Ok(Loaded::Valid(state)) => {
            let retry = state
                .remaining_ms(now)
                .unwrap_or_else(|| delay_ms(state.failed_attempts));
            (state.failed_attempts, retry)
        }
        Ok(Loaded::Missing) => (0, 0),
        Ok(Loaded::Malformed) | Err(_) => (FREE_ATTEMPTS + 1, delay_ms(FREE_ATTEMPTS + 1)),
    }
}

/// Removes the state with the wallet it belonged to.
pub(crate) fn remove(dir: &Path) -> Result<(), CoreError> {
    match fs::remove_file(dir.join(SECURITY_FILE)) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(_) => Err(storage("remove security state")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(boot: &str, ms: u64) -> ClockReading {
        ClockReading {
            boot_id: boot.into(),
            monotonic_ms: ms,
        }
    }

    #[test]
    fn schedule_is_four_free_then_doubling_from_thirty_seconds_to_one_hour() {
        let expected = [
            (0, 0),
            (1, 0),
            (4, 0),
            (5, 30_000),
            (6, 60_000),
            (7, 120_000),
            (8, 240_000),
            (9, 480_000),
            (10, 960_000),
            (11, 1_920_000),
            (12, 3_600_000),
            (13, 3_600_000),
            (40, 3_600_000),
            (u32::MAX, 3_600_000),
        ];
        for (failed, delay) in expected {
            assert_eq!(delay_ms(failed), delay, "after {failed} failures");
        }
    }

    #[test]
    fn the_counter_is_durable_before_the_kdf_could_run() {
        let dir = tempfile::tempdir().unwrap();
        let now = at("boot", 10);
        let state = check(dir.path(), &now).unwrap();
        begin_attempt(dir.path(), &state, &now).unwrap();
        // This is the point at which an entry point starts PBKDF2: the failure is already on disk.
        let on_disk: SecurityState =
            serde_json::from_str(&fs::read_to_string(dir.path().join(SECURITY_FILE)).unwrap())
                .unwrap();
        assert_eq!(on_disk.failed_attempts, 1);
    }

    #[test]
    fn a_new_boot_or_a_backwards_clock_restarts_the_full_delay() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), &SecurityState::stamped(5, &at("a", 1_000))).unwrap();
        assert!(matches!(
            check(dir.path(), &at("a", 21_000)),
            Err(CoreError::Throttled {
                retry_after_ms: 10_000
            })
        ));
        // Reboot: the stamp moves to now and the whole 30 s is owed again.
        assert!(matches!(
            check(dir.path(), &at("b", 5)),
            Err(CoreError::Throttled {
                retry_after_ms: 30_000
            })
        ));
        assert!(check(dir.path(), &at("b", 30_005)).is_ok());
        // Backwards within a boot restarts too.
        save(dir.path(), &SecurityState::stamped(5, &at("b", 50_000))).unwrap();
        assert!(matches!(
            check(dir.path(), &at("b", 49_000)),
            Err(CoreError::Throttled {
                retry_after_ms: 30_000
            })
        ));
    }

    #[test]
    fn a_malformed_file_fails_closed_at_the_first_delay() {
        let dir = tempfile::tempdir().unwrap();
        for garbage in ["", "{", "{\"version\":9}", "[]", "{\"version\":1,\"failedAttempts\":0,\"bootId\":\"a\",\"monotonicAtFailureMs\":0,\"x\":1}"] {
            fs::write(dir.path().join(SECURITY_FILE), garbage).unwrap();
            assert_eq!(status(dir.path(), &at("a", 0)), (5, 30_000));
            assert!(matches!(
                check(dir.path(), &at("a", 0)),
                Err(CoreError::Throttled {
                    retry_after_ms: 30_000
                })
            ));
        }
        fs::write(dir.path().join(SECURITY_FILE), [0xff, 0xfe]).unwrap();
        assert!(matches!(
            check(dir.path(), &at("a", 0)),
            Err(CoreError::Throttled { .. })
        ));
    }
}
