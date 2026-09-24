//! Sans-IO authority read for shared accounts, mirroring `getArgentMultisigConfig` and
//! `withPinnedBlock` (`packages/features/multisig/src/chain.ts`, `chain-pinned-read.ts`). The core
//! builds each JSON-RPC body and judges each response; the host only moves bytes. Each read first
//! proves the endpoint's chain id. `class_declared.rs` reuses the judge for the class check.
//!
//! The authority read pins ONE accepted block and asks every question at it, so a threshold and a
//! signer set can never describe two different states. A node that answers "Block not found"
//! (JSON-RPC 24) for a fresh pin is re-pinned, at most three attempts, as the extension does.

use std::sync::Mutex;

use serde_json::{json, Value};
use starknet_types_core::felt::Felt;

use crate::contact_card::lenient_hex_felt;
use crate::networks::{self, NetworkId};
use crate::{argent_multisig, felt, multisig_constants, CoreError};

const GET_THRESHOLD: &str = "0x1753cadb342b30cb76742fe738135a182b5c30e6e9eed2d3ee796b2accd34fd";
const GET_SIGNER_GUIDS: &str = "0x3a9ed885a5e9d921d3c00451660d2f71142bd45d166d07b1414837e911096dd";
const PINNED_READ_ATTEMPTS: u32 = 3;
const MAX_RESPONSE_BYTES: usize = 64 * 1024;
const CONTRACT_NOT_FOUND: i64 = 20;
const BLOCK_NOT_FOUND: i64 = 24;

/// Outcome of one authority read, as the extension's `ArgentMultisigAuthorityStatus` minus
/// `unsupported-signers`, which needs `SignerLinked` event discovery (deferred).
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum MultisigAuthorityStatus {
    Available,
    Undeployed,
    UnsupportedClass,
    InvalidConfig,
    NetworkUnavailable,
}

/// One JSON-RPC request for the host to POST.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct RpcRequest {
    pub id: u64,
    pub body: String,
    /// The largest response body the core will judge. The host stops reading and reports a
    /// transport failure past it, so a hostile endpoint cannot make the app buffer an unbounded
    /// body before the core's own size check runs.
    pub max_response_bytes: u64,
}

/// A judged response: a result, a node error code, or a malformed answer.
pub(crate) enum Answer {
    Result(Value),
    NodeError(i64),
    Malformed,
}

pub(crate) fn judge(body: &str, id: u64, max_bytes: usize) -> Answer {
    if body.len() > max_bytes {
        return Answer::Malformed;
    }
    let Ok(value) = serde_json::from_str::<Value>(body) else {
        return Answer::Malformed;
    };
    if value.get("jsonrpc") != Some(&json!("2.0")) || value.get("id") != Some(&json!(id)) {
        return Answer::Malformed;
    }
    if let Some(error) = value.get("error") {
        return error
            .get("code")
            .and_then(Value::as_i64)
            .map_or(Answer::Malformed, Answer::NodeError);
    }
    value
        .get("result")
        .cloned()
        .map_or(Answer::Malformed, Answer::Result)
}

pub(crate) fn envelope(id: u64, method: &str, params: Value) -> String {
    json!({ "id": id, "jsonrpc": "2.0", "method": method, "params": params }).to_string()
}

/// `isStarkFieldElement` then `canonicalFelt`: lowercase `0x` hex below the prime.
pub(crate) fn strict_felt(value: &Value) -> Option<Felt> {
    let text = value.as_str()?;
    felt::parse(text)
}

/// `boundedNumberAt`: a felt no larger than `0xffffffff`.
fn bounded_number(value: Option<&Value>) -> Option<u32> {
    let felt = strict_felt(value?)?;
    if felt > Felt::from(u32::MAX) {
        return None;
    }
    let bytes = felt.to_bytes_be();
    Some(u32::from_be_bytes([
        bytes[28], bytes[29], bytes[30], bytes[31],
    ]))
}

#[derive(Debug, Clone)]
enum Phase {
    ChainId,
    Block {
        attempt: u32,
    },
    ClassHash {
        attempt: u32,
        block: String,
    },
    Threshold {
        attempt: u32,
        block: String,
    },
    Signers {
        attempt: u32,
        block: String,
        threshold: u32,
    },
    Done(MultisigAuthorityStatus),
}

struct ReadState {
    phase: Phase,
    next_id: u64,
    pending: Option<u64>,
    authority: Option<(u32, Vec<Felt>)>,
}

/// Reads one address's class, threshold and signer GUIDs at one pinned block.
#[derive(uniffi::Object)]
pub struct MultisigAuthorityRead {
    network: NetworkId,
    address: Felt,
    state: Mutex<ReadState>,
}

impl MultisigAuthorityRead {
    /// Starts a read for a canonical, non-zero address.
    pub fn start(network: NetworkId, address: &str) -> Result<Self, CoreError> {
        let address = felt::parse_non_zero(address).ok_or_else(|| CoreError::InvalidInput {
            reason: "invalid multisig address".into(),
        })?;
        Ok(Self {
            network,
            address,
            state: Mutex::new(ReadState {
                phase: Phase::ChainId,
                next_id: 1,
                pending: None,
                authority: None,
            }),
        })
    }

    fn state(&self) -> std::sync::MutexGuard<'_, ReadState> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// The network this read targets.
    pub fn network(&self) -> NetworkId {
        self.network
    }

    /// The canonical address this read targets.
    pub fn address(&self) -> String {
        felt::canonical(&self.address)
    }

    /// Threshold and ascending signer GUIDs, once the status is `Available`.
    pub fn authority(&self) -> Option<(u32, Vec<Felt>)> {
        self.state().authority.clone()
    }

    fn call(&self, block: &str, selector: &str) -> (&'static str, Value) {
        (
            "starknet_call",
            json!({
                "block_id": { "block_hash": block },
                "request": {
                    "calldata": [],
                    "contract_address": felt::canonical(&self.address),
                    "entry_point_selector": selector,
                },
            }),
        )
    }

    fn request_for(&self, phase: &Phase) -> Option<(&'static str, Value)> {
        Some(match phase {
            Phase::ChainId => ("starknet_chainId", json!([])),
            Phase::Block { .. } => ("starknet_blockHashAndNumber", json!([])),
            Phase::ClassHash { block, .. } => (
                "starknet_getClassHashAt",
                json!({
                    "block_id": { "block_hash": block },
                    "contract_address": felt::canonical(&self.address),
                }),
            ),
            Phase::Threshold { block, .. } => self.call(block, GET_THRESHOLD),
            Phase::Signers { block, .. } => self.call(block, GET_SIGNER_GUIDS),
            Phase::Done(_) => return None,
        })
    }

    fn repin(attempt: u32) -> Phase {
        if attempt + 1 >= PINNED_READ_ATTEMPTS {
            Phase::Done(MultisigAuthorityStatus::NetworkUnavailable)
        } else {
            Phase::Block {
                attempt: attempt + 1,
            }
        }
    }

    fn advance(&self, phase: &Phase, answer: Answer, state: &mut ReadState) -> Phase {
        use MultisigAuthorityStatus as S;
        let result = match answer {
            Answer::Malformed => return Phase::Done(S::NetworkUnavailable),
            Answer::NodeError(CONTRACT_NOT_FOUND)
                if !matches!(phase, Phase::ChainId | Phase::Block { .. }) =>
            {
                return Phase::Done(S::Undeployed)
            }
            Answer::NodeError(BLOCK_NOT_FOUND) => {
                return match phase {
                    Phase::ClassHash { attempt, .. }
                    | Phase::Threshold { attempt, .. }
                    | Phase::Signers { attempt, .. } => Self::repin(*attempt),
                    _ => Phase::Done(S::NetworkUnavailable),
                }
            }
            Answer::NodeError(_) => return Phase::Done(S::NetworkUnavailable),
            Answer::Result(result) => result,
        };
        match phase.clone() {
            Phase::ChainId => {
                let expected = &networks::info(self.network).chain_id;
                match strict_felt(&result) {
                    Some(chain) if &felt::canonical(&chain) == expected => {
                        Phase::Block { attempt: 0 }
                    }
                    _ => Phase::Done(S::NetworkUnavailable),
                }
            }
            Phase::Block { attempt } => {
                let hash = result
                    .get("block_hash")
                    .and_then(Value::as_str)
                    .and_then(lenient_hex_felt);
                let number = result
                    .get("block_number")
                    .and_then(crate::nostr::safe_non_negative_integer);
                match (hash, number) {
                    (Some(hash), Some(_)) => Phase::ClassHash {
                        attempt,
                        block: felt::canonical(&hash),
                    },
                    _ => Phase::Done(S::InvalidConfig),
                }
            }
            Phase::ClassHash { attempt, block } => {
                let pinned = felt::parse(argent_multisig::class_hash());
                if strict_felt(&result).is_some() && strict_felt(&result) == pinned {
                    Phase::Threshold { attempt, block }
                } else {
                    Phase::Done(S::UnsupportedClass)
                }
            }
            Phase::Threshold { attempt, block } => match result.as_array() {
                Some(values) if values.len() == 1 => match bounded_number(values.first()) {
                    Some(threshold) => Phase::Signers {
                        attempt,
                        block,
                        threshold,
                    },
                    None => Phase::Done(S::InvalidConfig),
                },
                _ => Phase::Done(S::InvalidConfig),
            },
            Phase::Signers { threshold, .. } => match signer_guids(&result, threshold) {
                Some(guids) => {
                    state.authority = Some((threshold, guids));
                    Phase::Done(S::Available)
                }
                None => Phase::Done(S::InvalidConfig),
            },
            Phase::Done(status) => Phase::Done(status),
        }
    }
}

/// `get_signer_guids`: `[n, guid…]` with `1 <= threshold <= n <= 32`, unique non-zero GUIDs.
fn signer_guids(result: &Value, threshold: u32) -> Option<Vec<Felt>> {
    let values = result.as_array()?;
    let count = bounded_number(values.first())? as usize;
    let max = multisig_constants::get().limits.signers;
    if count == 0
        || count > max
        || threshold == 0
        || threshold as usize > count
        || values.len() != count + 1
    {
        return None;
    }
    let mut guids = values[1..]
        .iter()
        .map(|value| strict_felt(value).filter(|guid| *guid != Felt::ZERO))
        .collect::<Option<Vec<Felt>>>()?;
    guids.sort();
    guids.dedup();
    (guids.len() == count).then_some(guids)
}

#[uniffi::export]
impl MultisigAuthorityRead {
    /// Starts a read of `address` on `network`; the address must be a non-zero felt.
    #[uniffi::constructor]
    pub fn new(network: NetworkId, address: String) -> Result<std::sync::Arc<Self>, CoreError> {
        Self::start(network, &address).map(std::sync::Arc::new)
    }

    /// The next request to send, or `None` once the status is decided.
    pub fn next_request(&self) -> Option<RpcRequest> {
        let mut state = self.state();
        let phase = state.phase.clone();
        let (method, params) = self.request_for(&phase)?;
        let id = match state.pending {
            Some(id) => id,
            None => {
                let id = state.next_id;
                state.next_id += 1;
                state.pending = Some(id);
                id
            }
        };
        Some(RpcRequest {
            id,
            body: envelope(id, method, params),
            max_response_bytes: MAX_RESPONSE_BYTES as u64,
        })
    }

    /// Judges the response to the pending request. A body for any other id is refused and changes
    /// nothing; a malformed or failed answer settles `NetworkUnavailable`.
    pub fn accept_response(&self, id: u64, body: String) -> Result<(), CoreError> {
        let mut state = self.state();
        if state.pending != Some(id) {
            return Err(CoreError::Rpc {
                reason: "response does not answer this request".into(),
            });
        }
        state.pending = None;
        let phase = state.phase.clone();
        let next = self.advance(&phase, judge(&body, id, MAX_RESPONSE_BYTES), &mut state);
        state.phase = next;
        Ok(())
    }

    /// The host could not complete the pending request (timeout, TLS, HTTP status).
    pub fn transport_failed(&self, id: u64) {
        let mut state = self.state();
        if state.pending == Some(id) {
            state.pending = None;
            state.phase = Phase::Done(MultisigAuthorityStatus::NetworkUnavailable);
        }
    }

    /// The decided status, once there is one.
    pub fn status(&self) -> Option<MultisigAuthorityStatus> {
        match self.state().phase {
            Phase::Done(status) => Some(status),
            _ => None,
        }
    }
}
