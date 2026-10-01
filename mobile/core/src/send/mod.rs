//! Sending: an ERC-20 transfer from an OpenZeppelin account, with automatic deployment before
//! the first send, exactly as the extension does. Protocol logic only — the core builds every
//! JSON-RPC body and judges every reply (`rpc_bodies`, `judge`); the host moves bytes.
//! Hashing and signing use Krusty 0.11.0 inside the core (`sign`, `WalletCore::plan_sign`).
//!
//! Design and review resolutions: `mobile/docs/transactions.md`. Parity with the extension is
//! pinned by `tests/fixtures/extension-transactions-*.json`.

pub(crate) mod calls;
pub(crate) mod fees;
pub(crate) mod judge;
pub(crate) mod plan;
mod plan_deploy;
mod plan_probe;
mod plan_review;
mod plan_submit;
pub(crate) mod rpc_bodies;
mod sign;
pub(crate) mod types;
pub(crate) mod u256;
mod wallet_ext;

use crate::activity::observation;
use crate::felt;
use types::{DeploymentState, SendError};

/// `normalizeFeltInput` + `isStarkFieldElement`: the canonical felt for a typed or pasted
/// address, or `None`. `0x0` is returned as the extension's field check returns it; the call
/// builder (`prepare_transfer`) refuses it.
#[uniffi::export]
pub fn validate_recipient(input: String) -> Option<String> {
    calls::validate_recipient(&input).map(|value| felt::canonical(&value))
}

/// `parseTokenAmount`: base-10 base units, or the reason the extension would refuse the text.
#[uniffi::export]
pub fn parse_token_amount(amount: String, decimals: u8) -> Result<String, SendError> {
    calls::parse_token_amount(&amount, decimals)
        .map(|value| value.to_decimal())
        .map_err(|reason| SendError::InvalidAmount { reason })
}

/// Whether a recorded transaction is still due a status read at `now_ms` (the extension's
/// `isObserved`, either cadence): pending or pre-confirmed and submitted less than an hour ago
/// (the fast tier), or L2-accepted, not yet final on L1, and submitted less than seven days ago
/// (the slow tier). Hosts reconcile only these, and at most once per
/// `activity_observation_period_for(record)`.
#[uniffi::export]
pub fn activity_needs_observation(record: crate::ActivityEntry, now_ms: u64) -> bool {
    observation::is_observed(
        record.status,
        record.finalized_on_l1 == Some(true),
        record.submitted_at,
        now_ms,
    )
}

/// The extension's `FAST_OBSERVATION_PERIOD_MINUTES`, in milliseconds: the shortest period any
/// record is read at, so the host's observation tick.
#[uniffi::export]
pub fn activity_observation_period_ms() -> u64 {
    observation::FAST_OBSERVATION_PERIOD_MS
}

/// The least time between two status reads of `record`: the fast period for an unresolved one,
/// `SLOW_OBSERVATION_PERIOD_MINUTES` for an accepted one still awaiting L1. A record on neither
/// tier gets the slow period (it is not observed at all; see `activity_needs_observation`).
#[uniffi::export]
pub fn activity_observation_period_for(record: crate::ActivityEntry) -> u64 {
    match observation::tier(record.status, record.finalized_on_l1 == Some(true)) {
        Some(tier) => observation::period_ms(tier),
        None => observation::SLOW_OBSERVATION_PERIOD_MS,
    }
}

/// Longest node reply the core parses. Hosts stop reading a reply at this many bytes (and treat
/// a longer one as a transport failure), so an untrusted endpoint cannot make the app buffer an
/// unbounded body before the core refuses it.
#[uniffi::export]
pub fn max_rpc_response_bytes() -> u32 {
    crate::rpc::MAX_RESPONSE_BYTES as u32
}

/// The extension's `CONFIRMATION_DELAYS_MS`.
#[uniffi::export]
pub fn confirmation_checkpoints_ms() -> Vec<u32> {
    plan::CONFIRMATION_DELAYS_MS.to_vec()
}

/// `starknet_getClassHashAt` body for the home deploy notice; `None` for a malformed address.
#[uniffi::export]
pub fn deployment_status_request(id: u64, address: String) -> Option<String> {
    let address = felt::parse_non_zero(&address)?;
    Some(rpc_bodies::class_hash_at(id, &address))
}

/// Judges that reply: a class hash is `Deployed`, error 20 or "contract not found" is
/// `Undeployed`, anything else (including a malformed reply) is `Unknown`, which shows nothing.
#[uniffi::export]
pub fn judge_deployment_status(body: String, id: u64) -> DeploymentState {
    match judge::class_hash(judge::answer(&body, id)) {
        judge::ClassHashAnswer::Deployed => DeploymentState::Deployed,
        judge::ClassHashAnswer::Undeployed => DeploymentState::Undeployed,
        _ => DeploymentState::Unknown,
    }
}

#[cfg(test)]
mod fixture_tests;
