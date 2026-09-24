//! Shared test doubles: a hand-driven host clock and a core over a temporary directory.
#![allow(dead_code)]

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use bramble_core::{HostClock, WalletCore};

/// The repository's published E2E phrase; never holds funds.
pub const PHRASE: &str =
    "habit hope tip crystal because grunt nation idea electric witness alert like";
pub const PASSWORD: &str = "a strong password";
pub const WRONG: &str = "wrong password";

/// A host clock the test moves by hand. `wall_ms` models the user-settable date: the core has no
/// way to read it, which is exactly what the clock tests prove by moving it.
pub struct FakeClock {
    monotonic: AtomicU64,
    boot: Mutex<String>,
    pub wall_ms: AtomicU64,
}

impl FakeClock {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            monotonic: AtomicU64::new(1_000_000),
            boot: Mutex::new("boot-1".into()),
            wall_ms: AtomicU64::new(1_790_000_000_000),
        })
    }

    pub fn advance(&self, ms: u64) {
        self.monotonic.fetch_add(ms, Ordering::SeqCst);
    }

    pub fn set_monotonic(&self, ms: u64) {
        self.monotonic.store(ms, Ordering::SeqCst);
    }

    pub fn monotonic(&self) -> u64 {
        self.monotonic.load(Ordering::SeqCst)
    }

    pub fn reboot(&self, id: &str, monotonic: u64) {
        *self.boot.lock().unwrap() = id.into();
        self.set_monotonic(monotonic);
    }

    /// Moves the user-settable date; must never change any core decision.
    pub fn shift_wall(&self, delta_ms: i64) {
        let now = self.wall_ms.load(Ordering::SeqCst) as i64;
        self.wall_ms
            .store((now + delta_ms) as u64, Ordering::SeqCst);
    }
}

impl HostClock for FakeClock {
    fn monotonic_ms(&self) -> u64 {
        self.monotonic.load(Ordering::SeqCst)
    }

    fn boot_id(&self) -> String {
        self.boot.lock().unwrap().clone()
    }
}

pub fn open(dir: &std::path::Path, clock: &Arc<FakeClock>) -> Arc<WalletCore> {
    WalletCore::new(dir.to_string_lossy().into(), clock.clone()).unwrap()
}

pub fn core() -> (tempfile::TempDir, Arc<FakeClock>, Arc<WalletCore>) {
    let dir = tempfile::tempdir().unwrap();
    let clock = FakeClock::new();
    let core = open(dir.path(), &clock);
    (dir, clock, core)
}

/// A core with the published phrase imported (unlocked).
pub fn imported() -> (tempfile::TempDir, Arc<FakeClock>, Arc<WalletCore>) {
    let (dir, clock, core) = core();
    core.import_wallet(PASSWORD.into(), PHRASE.into(), None)
        .unwrap();
    (dir, clock, core)
}
