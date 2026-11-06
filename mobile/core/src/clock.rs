//! The only time source the core has: a host clock that is monotonic and scoped to one boot.
//!
//! There is deliberately no wall clock. The rules that depend on time (the passphrase backoff in
//! `security` and the idle lock in `wallet`) are measured on a clock the user cannot set, so
//! Settings > Date & Time cannot shorten a delay or extend a session. Readings from different
//! boots are incomparable, and every comparison is checked: "time unknown" restarts a delay and
//! ends a session, and nothing on these paths can panic across the FFI.

/// Host clock injected into `WalletCore`. The core never reads time any other way.
///
/// Trust boundary: implemented in Swift/Kotlin. A host that lies can only hurt its own user; the
/// core still never trusts a reading across a boot change or a backwards step.
#[uniffi::export(with_foreign)]
pub trait HostClock: Send + Sync {
    /// Milliseconds on a clock that keeps counting while the device sleeps and that the user
    /// cannot set (iOS `mach_continuous_time`; Android `SystemClock.elapsedRealtime()`).
    fn monotonic_ms(&self) -> u64;
    /// An identifier that changes on every boot (iOS `kern.bootsessionuuid`; Android
    /// `Settings.Global.BOOT_COUNT`).
    fn boot_id(&self) -> String;
}

/// Longest boot identifier kept; a longer host value is cut, which only makes boots look equal
/// when a host returns absurdly long ids.
const MAX_BOOT_ID_LEN: usize = 128;

/// One reading of the host clock.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ClockReading {
    pub boot_id: String,
    pub monotonic_ms: u64,
}

impl ClockReading {
    pub fn read(clock: &dyn HostClock) -> Self {
        let mut boot_id = clock.boot_id();
        if boot_id.len() > MAX_BOOT_ID_LEN {
            let mut end = MAX_BOOT_ID_LEN;
            while !boot_id.is_char_boundary(end) {
                end -= 1;
            }
            boot_id.truncate(end);
        }
        Self {
            boot_id,
            monotonic_ms: clock.monotonic_ms(),
        }
    }

    /// Milliseconds from `earlier` to `self`, or `None` when they cannot be compared: a different
    /// boot, or a clock that went backwards. Callers treat `None` as the strict outcome.
    pub fn elapsed_since(&self, earlier_boot: &str, earlier_ms: u64) -> Option<u64> {
        if self.boot_id != earlier_boot {
            return None;
        }
        self.monotonic_ms.checked_sub(earlier_ms)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn readings_only_compare_within_one_boot_and_forwards() {
        let now = ClockReading {
            boot_id: "a".into(),
            monotonic_ms: 100,
        };
        assert_eq!(now.elapsed_since("a", 40), Some(60));
        assert_eq!(now.elapsed_since("a", 100), Some(0));
        assert_eq!(now.elapsed_since("a", 101), None);
        assert_eq!(now.elapsed_since("b", 40), None);
    }
}
