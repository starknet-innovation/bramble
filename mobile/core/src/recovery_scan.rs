//! The sans-IO discovery scan. The core derives each batch's candidate addresses and hands the
//! host JSON-RPC bodies; the host POSTs them through its chain-verified client and passes the
//! bodies back; the core judges them. State lives only in the unlocked session and is dropped on
//! lock, as the extension's `recovery-cache.ts` is keyed by (fingerprint, network).
//!
//! Probe judging follows `isAccountDeployed` / `isContractNotFoundError`: a felt result is
//! deployed; error code 20 or a "contract not found" message is not deployed; anything else, or a
//! missing, duplicate or foreign id, pauses the scan with the batch left to be retried.

use std::collections::HashMap;

use serde_json::{json, Value};
use starknet_types_core::felt::Felt;

use crate::account_catalog::catalog;
use crate::account_store::{VaultPayload, MAX_ACCOUNT_INDEX};
use crate::kms_accounts::family_address;
use crate::networks::{self, NetworkId};
use crate::recovery::{candidate, keep, scan_shapes, Found, RecoveryCandidate};
use crate::rpc::{self, rpc_error, RpcRequest, RpcResponse, MAX_RESPONSE_BYTES};
use crate::{felt, CoreError};

/// Candidates one scan may accumulate (manual checks add up to six each).
const MAX_CANDIDATES: usize = 512;
/// JSON-RPC error code for "contract not found".
const CONTRACT_NOT_FOUND: i64 = 20;

/// Where the scan stands after a call.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct RecoveryScanStep {
    /// Bodies to POST and return through `recovery_scan_submit`; empty once a batch is judged.
    pub requests: Vec<RpcRequest>,
    pub candidates: Vec<RecoveryCandidate>,
    /// Indices checked so far (the extension's `nextIndex`).
    pub checked: u32,
    pub complete: bool,
    pub status: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Pending {
    ClassHash(usize),
    Balance(usize),
}

struct Probe {
    found: Found,
}

struct Batch {
    end: u32,
    manual: bool,
    probes: Vec<Probe>,
    outstanding: HashMap<u64, Pending>,
}

/// One scan's in-memory state.
pub(crate) struct ScanState {
    fingerprint: Felt,
    network: NetworkId,
    candidates: Vec<Found>,
    next_index: u32,
    batch: Option<Batch>,
    next_id: u64,
}

fn paused() -> CoreError {
    rpc_error("account search paused")
}

fn class_hash_request(id: u64, address: &Felt) -> String {
    rpc::envelope(
        id,
        "starknet_getClassHashAt",
        json!({ "block_id": "latest", "contract_address": felt::canonical(address) }),
    )
}

/// Judges a `starknet_getClassHashAt` response: `Ok(true)` deployed, `Ok(false)` not deployed.
pub(crate) fn judge_class_hash(body: &str, id: u64) -> Result<bool, CoreError> {
    if body.len() > MAX_RESPONSE_BYTES {
        return Err(paused());
    }
    let value: Value = serde_json::from_str(body).map_err(|_| paused())?;
    if value.get("jsonrpc") != Some(&json!("2.0")) || value.get("id") != Some(&json!(id)) {
        return Err(paused());
    }
    if let Some(result) = value.get("result") {
        return result
            .as_str()
            .and_then(felt::parse)
            .map(|_| true)
            .ok_or_else(paused);
    }
    let error = value.get("error").ok_or_else(paused)?;
    let code = error.get("code").and_then(Value::as_i64);
    let message = error.get("message").and_then(Value::as_str).unwrap_or("");
    if code == Some(CONTRACT_NOT_FOUND) || message.to_lowercase().contains("contract not found") {
        return Ok(false);
    }
    Err(paused())
}

impl ScanState {
    fn new(fingerprint: Felt, network: NetworkId) -> Self {
        Self {
            fingerprint,
            network,
            candidates: Vec::new(),
            next_index: 0,
            batch: None,
            next_id: 1,
        }
    }

    fn allocate_id(&mut self) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    fn step(&self, requests: Vec<RpcRequest>) -> RecoveryScanStep {
        let count = catalog().limits.default_count;
        let complete = self.next_index >= count;
        let status = if !requests.is_empty() && self.next_index == 0 {
            "Searching every account type…".to_string()
        } else if complete {
            format!(
                "Search complete. Checked {} indices across every account type.",
                self.next_index
            )
        } else {
            format!("Checked {} of {count} indices…", self.next_index)
        };
        RecoveryScanStep {
            requests,
            candidates: self.candidates.iter().map(candidate).collect(),
            checked: self.next_index,
            complete,
            status,
        }
    }
}

/// Starts (or restarts) the next batch: the next four indices, or one manual index.
pub(crate) fn next(
    state: &mut Option<ScanState>,
    payload: &VaultPayload,
    network: NetworkId,
    manual_index: Option<u32>,
) -> Result<RecoveryScanStep, CoreError> {
    let fingerprint = payload.public_key(0)?;
    let same =
        matches!(state, Some(scan) if scan.fingerprint == fingerprint && scan.network == network);
    if !same {
        *state = Some(ScanState::new(fingerprint, network));
    }
    let scan = state.as_mut().expect("scan state was just ensured");
    // An abandoned batch (a failed POST, a retry) is re-issued from the same index.
    scan.batch = None;
    let limits = catalog().limits;
    let (start, end) = match manual_index {
        Some(index) if index > MAX_ACCOUNT_INDEX.min(limits.max_index) => {
            return Err(CoreError::InvalidInput {
                reason: "enter a valid non-negative account index".into(),
            })
        }
        Some(index) => (index, index),
        None if scan.next_index >= limits.default_count => return Ok(scan.step(Vec::new())),
        None => {
            let start = scan.next_index;
            (
                start,
                (start + limits.batch_size - 1).min(limits.default_count - 1),
            )
        }
    };
    if scan.candidates.len() >= MAX_CANDIDATES {
        return Err(CoreError::InvalidInput {
            reason: "too many accounts checked".into(),
        });
    }
    let chain = network.chain();
    let mut probes = Vec::new();
    for account_index in start..=end {
        let public_key = payload.public_key(account_index)?;
        for shape in scan_shapes() {
            let placed = family_address(
                shape.family,
                shape.class_hash.as_ref(),
                None,
                &public_key,
                chain,
            )?;
            probes.push(Probe {
                found: Found {
                    family: shape.family,
                    class_hash: placed.class_hash,
                    account_index,
                    address: placed.address,
                    deployed: false,
                    funded: false,
                },
            });
        }
    }
    let mut outstanding = HashMap::new();
    let mut requests = Vec::new();
    for (position, probe) in probes.iter().enumerate() {
        let id = scan.allocate_id();
        outstanding.insert(id, Pending::ClassHash(position));
        requests.push(RpcRequest::new(
            id,
            class_hash_request(id, &probe.found.address),
        ));
    }
    scan.batch = Some(Batch {
        end,
        manual: manual_index.is_some(),
        probes,
        outstanding,
    });
    Ok(scan.step(requests))
}

// Checks that `responses` answer exactly the outstanding ids, each once.
fn matched(
    batch: &Batch,
    responses: &[RpcResponse],
) -> Result<Vec<(Pending, String, u64)>, CoreError> {
    if responses.len() != batch.outstanding.len() {
        return Err(paused());
    }
    let mut seen = std::collections::HashSet::new();
    responses
        .iter()
        .map(|response| {
            let pending = batch.outstanding.get(&response.id).ok_or_else(paused)?;
            if !seen.insert(response.id) {
                return Err(paused());
            }
            Ok((*pending, response.body.clone(), response.id))
        })
        .collect()
}

fn judge(batch: &mut Batch, responses: &[RpcResponse]) -> Result<(), CoreError> {
    for (pending, body, id) in matched(batch, responses)? {
        match pending {
            Pending::ClassHash(position) => {
                batch.probes[position].found.deployed = judge_class_hash(&body, id)?;
            }
            Pending::Balance(position) => {
                let balance = rpc::parse_balance_of(&body, id).map_err(|_| paused())?;
                if balance != "0" {
                    batch.probes[position].found.funded = true;
                }
            }
        }
    }
    Ok(())
}

/// Judges the host's responses. Returns balance requests for undeployed candidates after the
/// class-hash round, or the finished batch once every answer is in.
pub(crate) fn submit(
    state: &mut Option<ScanState>,
    responses: &[RpcResponse],
) -> Result<RecoveryScanStep, CoreError> {
    let scan = state.as_mut().ok_or_else(|| CoreError::InvalidInput {
        reason: "no account search in progress".into(),
    })?;
    let mut batch = scan.batch.take().ok_or_else(|| CoreError::InvalidInput {
        reason: "no account search in progress".into(),
    })?;
    let balance_round = batch
        .outstanding
        .values()
        .any(|pending| matches!(pending, Pending::Balance(_)));
    // On failure the batch is dropped, so `next` re-issues it from the same index.
    judge(&mut batch, responses)?;
    batch.outstanding.clear();
    if !balance_round {
        let tokens = &networks::info(scan.network).tokens;
        let mut requests = Vec::new();
        for position in 0..batch.probes.len() {
            if batch.probes[position].found.deployed {
                continue;
            }
            for token in tokens {
                let id = scan.allocate_id();
                let account = felt::canonical(&batch.probes[position].found.address);
                let body = rpc::balance_of_request(id, &token.address, &account)?;
                batch.outstanding.insert(id, Pending::Balance(position));
                requests.push(RpcRequest::new(id, body));
            }
        }
        if !requests.is_empty() {
            scan.batch = Some(batch);
            return Ok(scan.step(requests));
        }
    }
    for probe in batch
        .probes
        .into_iter()
        .filter(|probe| keep(&probe.found, batch.manual))
    {
        match scan
            .candidates
            .iter_mut()
            .find(|known| known.address == probe.found.address)
        {
            Some(known) => *known = probe.found,
            None => scan.candidates.push(probe.found),
        }
    }
    if !batch.manual {
        scan.next_index = batch.end + 1;
    }
    Ok(scan.step(Vec::new()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probe_judging_matches_the_extension() {
        let ok = |body: &str| judge_class_hash(body, 3);
        assert!(ok(r#"{"jsonrpc":"2.0","id":3,"result":"0x1a2b"}"#).unwrap());
        assert!(!ok(r#"{"jsonrpc":"2.0","id":3,"error":{"code":20,"message":"x"}}"#).unwrap());
        assert!(!ok(
            r#"{"jsonrpc":"2.0","id":3,"error":{"code":-1,"message":"Contract NOT found"}}"#
        )
        .unwrap());
        assert!(
            ok(r#"{"jsonrpc":"2.0","id":3,"error":{"code":24,"message":"Block not found"}}"#)
                .is_err()
        );
        assert!(ok(r#"{"jsonrpc":"2.0","id":4,"result":"0x1"}"#).is_err());
        assert!(ok(r#"{"jsonrpc":"2.0","id":3,"result":"0xZZ"}"#).is_err());
        assert!(ok("not json").is_err());
    }
}
