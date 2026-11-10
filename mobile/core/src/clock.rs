//! The only time source the core has: a host clock that is monotonic and scoped to one boot.
//!
//! There is deliberately no wall clock. The rules that depend on time (the passphrase backoff in
//! `security` and the idle lock in `wallet`) are measured on a clock the user cannot set, so
//! Settings > Date & Time cannot shorten a delay or extend a session. Readings from different
//! boots are incomparable, and every comparison is checked (`wallet_core::host::ClockReading`):
//! "time unknown" restarts a delay and ends a session, and nothing on these paths can panic
//! across the FFI.

pub(crate) use wallet_core::host::ClockReading;

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

/// The UniFFI clock as the shared core's `Clock`, so `ClockReading::read` takes it.
impl wallet_core::host::Clock for &dyn HostClock {
    fn monotonic_ms(&self) -> u64 {
        HostClock::monotonic_ms(*self)
    }

    fn boot_id(&self) -> String {
        HostClock::boot_id(*self)
    }
}
