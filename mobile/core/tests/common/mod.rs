//! Shared helpers for the account integration suites: a wallet in a temporary directory, and a
//! scripted in-memory JSON-RPC responder that plays the node for the discovery scan.

#![allow(dead_code)] // Each test crate uses a different subset of these helpers.

use std::collections::HashSet;
use std::sync::Arc;

use bramble_core::{
    AccountFamily, NetworkId, RecoveryScanStep, RecoverySelection, RpcRequest, RpcResponse,
    WalletCore,
};
use serde_json::{json, Value};

pub const PHRASE: &str =
    "habit hope tip crystal because grunt nation idea electric witness alert like";
pub const PASSWORD: &str = "a strong password";

pub fn core() -> (tempfile::TempDir, Arc<WalletCore>) {
    let dir = tempfile::tempdir().unwrap();
    let core = WalletCore::new(dir.path().to_string_lossy().into()).unwrap();
    (dir, core)
}

pub fn imported() -> (tempfile::TempDir, Arc<WalletCore>) {
    let (dir, core) = core();
    core.import_wallet(PASSWORD.into(), PHRASE.into(), None)
        .unwrap();
    (dir, core)
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
