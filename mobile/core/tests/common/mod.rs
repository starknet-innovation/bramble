//! Shared test doubles: a hand-driven host clock, a core over a temporary directory, and a
//! scripted in-memory JSON-RPC responder that plays the node for the discovery scan.
#![allow(dead_code)] // Each test crate uses a different subset of these helpers.

use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use bramble_core::{
    AccountFamily, HostClock, NetworkId, RecoveryScanStep, RecoverySelection, RpcRequest,
    RpcResponse, WalletCore,
};
use serde_json::{json, Value};

/// Readers for the extension-written portfolio parity fixture.
pub mod portfolio;

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

/// A core with the published phrase imported (unlocked) and still waiting for discovery: no
/// accounts yet, `recovery_pending` set.
pub fn pending() -> (tempfile::TempDir, Arc<FakeClock>, Arc<WalletCore>) {
    let (dir, clock, core) = core();
    core.import_wallet(PASSWORD.into(), PHRASE.into(), None)
        .unwrap();
    (dir, clock, core)
}

/// A core with the published phrase imported (unlocked) and OZ index 0 restored on Sepolia and
/// active, as after "Find your accounts". Its id is `account_id(&core)`.
pub fn imported() -> (tempfile::TempDir, Arc<FakeClock>, Arc<WalletCore>) {
    let (dir, clock, core) = pending();
    core.restore_recovered_accounts(NetworkId::Sepolia, vec![oz(0)])
        .unwrap();
    (dir, clock, core)
}

/// The active account's record id.
pub fn account_id(core: &WalletCore) -> String {
    core.active_account()
        .unwrap()
        .expect("an active account")
        .id
}

pub fn selection(family: AccountFamily, index: u32, class_hash: Option<&str>) -> RecoverySelection {
    RecoverySelection {
        family,
        account_index: index,
        class_hash: class_hash.map(str::to_string),
    }
}

pub fn oz(index: u32) -> RecoverySelection {
    selection(AccountFamily::OpenZeppelin, index, None)
}

/// A node that knows which addresses are deployed and which hold a token balance.
#[derive(Default)]
pub struct Node {
    pub deployed: HashSet<String>,
    pub funded: HashSet<String>,
    /// Answer class-hash probes with this raw error instead (e.g. a rate limit).
    pub failure: Option<Value>,
}

impl Node {
    pub fn answer(&self, request: &RpcRequest) -> RpcResponse {
        let body: Value = serde_json::from_str(&request.body).unwrap();
        let id = body["id"].clone();
        let reply = match body["method"].as_str().unwrap() {
            "starknet_getClassHashAt" => {
                let address = body["params"]["contract_address"].as_str().unwrap();
                if let Some(error) = &self.failure {
                    json!({ "jsonrpc": "2.0", "id": id, "error": error })
                } else if self.deployed.contains(address) {
                    json!({ "jsonrpc": "2.0", "id": id, "result": "0x1d1777db36cdd06dd62cfde77b1b6ae06412af95d57a13dc40ac77b8a702381" })
                } else {
                    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": 20, "message": "Contract not found" } })
                }
            }
            "starknet_call" => {
                let account = body["params"]["request"]["calldata"][0].as_str().unwrap();
                let low = if self.funded.contains(account) {
                    "0x5"
                } else {
                    "0x0"
                };
                json!({ "jsonrpc": "2.0", "id": id, "result": [low, "0x0"] })
            }
            other => panic!("unexpected method {other}"),
        };
        RpcResponse {
            id: request.id,
            body: reply.to_string(),
        }
    }

    pub fn answer_all(&self, step: &RecoveryScanStep) -> Vec<RpcResponse> {
        step.requests
            .iter()
            .map(|request| self.answer(request))
            .collect()
    }

    /// Runs one batch to completion (class-hash round, then balances if any).
    pub fn run_batch(
        &self,
        core: &WalletCore,
        network: NetworkId,
        manual: Option<u32>,
    ) -> RecoveryScanStep {
        let mut step = core.recovery_scan_next(network, manual).unwrap();
        while !step.requests.is_empty() {
            step = core.recovery_scan_submit(self.answer_all(&step)).unwrap();
        }
        step
    }

    /// Runs the whole default scan.
    pub fn run_scan(&self, core: &WalletCore, network: NetworkId) -> RecoveryScanStep {
        loop {
            let step = self.run_batch(core, network, None);
            if step.complete {
                return step;
            }
        }
    }
}
