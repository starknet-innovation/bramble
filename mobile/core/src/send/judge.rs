//! Judges node replies for the send path. Every reply is untrusted: it must be JSON-RPC 2.0,
//! answer the id it was sent under, fit the size bound, and carry exactly the shape expected.
//! Node error text is read only to classify it (as the extension's `rpc-not-found.ts` does) and
//! is never returned.

use serde_json::Value;
use starknet_types_core::felt::Felt;

use super::types::TxStatus;
use crate::felt;
use crate::networks::{self, NetworkId};

/// Longest reply the core parses: the one bound `rpc.rs` owns.
use crate::rpc::MAX_RESPONSE_BYTES;

/// A well-formed reply to the outstanding request.
pub enum Answer {
    Result(Value),
    /// A JSON-RPC error: its numeric code (if any) and its lower-cased message and data text.
    Error {
        code: Option<i64>,
        text: String,
    },
}

/// Parses a reply; `None` when it is oversized, malformed, or answers another request.
pub fn answer(body: &str, id: u64) -> Option<Answer> {
    if body.len() > MAX_RESPONSE_BYTES {
        return None;
    }
    let value: Value = serde_json::from_str(body).ok()?;
    if value.get("jsonrpc")?.as_str()? != "2.0" || value.get("id")?.as_u64()? != id {
        return None;
    }
    if let Some(error) = value.get("error") {
        let code = error.get("code").and_then(Value::as_i64);
        let message = error.get("message").and_then(Value::as_str).unwrap_or("");
        let data = error.get("data").map(Value::to_string).unwrap_or_default();
        return Some(Answer::Error {
            code,
            text: format!("{message} {data}").to_lowercase(),
        });
    }
    value.get("result").cloned().map(Answer::Result)
}

/// A `starknet_chainId` reply.
#[derive(Debug, PartialEq, Eq)]
pub enum ChainAnswer {
    Match,
    Mismatch,
    Unreadable,
}

pub fn chain(answer: Option<Answer>, network: NetworkId) -> ChainAnswer {
    match answer {
        Some(Answer::Result(Value::String(text))) => match felt::parse(&text) {
            Some(chain) if felt::canonical(&chain) == networks::info(network).chain_id => {
                ChainAnswer::Match
            }
            Some(_) => ChainAnswer::Mismatch,
            None => ChainAnswer::Unreadable,
        },
        _ => ChainAnswer::Unreadable,
    }
}

/// A `starknet_getClassHashAt` reply, as `isCompatibleAccountDeployed` reads it for an
/// OpenZeppelin account (existence only).
#[derive(Debug, PartialEq, Eq)]
pub enum ClassHashAnswer {
    Deployed,
    Undeployed,
    NodeError,
    Unreadable,
}

pub fn class_hash(answer: Option<Answer>) -> ClassHashAnswer {
    match answer {
        Some(Answer::Result(_)) => ClassHashAnswer::Deployed,
        Some(Answer::Error { code, text }) => {
            if code == Some(20) || text.contains("contract not found") {
                ClassHashAnswer::Undeployed
            } else {
                ClassHashAnswer::NodeError
            }
        }
        None => ClassHashAnswer::Unreadable,
    }
}

/// A block-pinned `starknet_getClassHashAt` reply as `isCompatibleAccountDeployed` reads it for a
/// Ready (Argent) account: the class matters, and a zero class hash reads as undeployed.
#[derive(Debug, PartialEq, Eq)]
pub enum ClassValue {
    Class(Felt),
    Undeployed,
    NodeError,
    Unreadable,
}

pub fn class_value(answer: Option<Answer>) -> ClassValue {
    match answer {
        Some(Answer::Result(Value::String(text))) => match felt::parse(&text) {
            Some(class) if class == Felt::ZERO => ClassValue::Undeployed,
            Some(class) => ClassValue::Class(class),
            None => ClassValue::Unreadable,
        },
        Some(Answer::Result(_)) | None => ClassValue::Unreadable,
        answer => match class_hash(answer) {
            ClassHashAnswer::Undeployed => ClassValue::Undeployed,
            _ => ClassValue::NodeError,
        },
    }
}

/// A `starknet_blockHashAndNumber` reply (`acceptedBlockIdentifier`): the non-zero hash of the
/// latest accepted block. `Err(true)` for a JSON-RPC error, `Err(false)` for anything unusable.
pub fn accepted_block(answer: Option<Answer>) -> Result<Felt, bool> {
    match answer {
        Some(Answer::Result(result)) => result
            .get("block_hash")
            .and_then(Value::as_str)
            .and_then(felt::parse_non_zero)
            .ok_or(false),
        Some(Answer::Error { .. }) => Err(true),
        None => Err(false),
    }
}

/// A `starknet_call` reply to a one-felt view (`get_owner`, `get_owner_type`, `get_guardian`).
#[derive(Debug, PartialEq, Eq)]
pub enum CallAnswer {
    /// The felt when the result is exactly one felt; `None` for any other result, which the
    /// extension's `length !== 1` checks refuse.
    Value(Option<Felt>),
    NodeError,
    Unreadable,
}

pub fn single_felt(answer: Option<Answer>) -> CallAnswer {
    match answer {
        Some(Answer::Result(Value::Array(values))) => CallAnswer::Value(match values.as_slice() {
            [Value::String(text)] => felt::parse(text),
            _ => None,
        }),
        Some(Answer::Result(_)) => CallAnswer::Value(None),
        Some(Answer::Error { .. }) => CallAnswer::NodeError,
        None => CallAnswer::Unreadable,
    }
}

/// A `starknet_call` reply as all of its felts (Braavos's `get_signers`,
/// `get_deferred_remove_signers`). `Err(true)` for a JSON-RPC error, `Err(false)` for a missing
/// reply or any entry that is not a felt.
pub fn call_felts(answer: Option<Answer>) -> Result<Vec<Felt>, bool> {
    match answer {
        Some(Answer::Result(Value::Array(values))) => values
            .iter()
            .map(|value| value.as_str().and_then(felt::parse))
            .collect::<Option<Vec<_>>>()
            .ok_or(false),
        Some(Answer::Result(_)) | None => Err(false),
        Some(Answer::Error { .. }) => Err(true),
    }
}

/// A `starknet_getBlockWithTxHashes` reply's `timestamp`, with the same error split.
pub fn block_timestamp(answer: Option<Answer>) -> Result<u64, bool> {
    match answer {
        Some(Answer::Result(result)) => {
            result.get("timestamp").and_then(Value::as_u64).ok_or(false)
        }
        Some(Answer::Error { .. }) => Err(true),
        None => Err(false),
    }
}

/// A `starknet_getNonce` reply through `getNonceSafe`: a JSON-RPC error reads as 0 (how an
/// undeployed account answers). A missing or malformed reply is `None`: the core does not sign
/// on a nonce it could not read, which is stricter than starknet.js.
pub fn nonce(answer: Option<Answer>) -> Option<Felt> {
    match answer? {
        Answer::Result(Value::String(text)) => felt::parse(&text),
        Answer::Result(_) => None,
        Answer::Error { .. } => Some(Felt::ZERO),
    }
}

/// A `starknet_estimateFee` reply.
pub enum EstimateAnswer {
    Entries(Vec<Value>),
    NodeError,
    Unreadable,
}

pub fn estimate(answer: Option<Answer>) -> EstimateAnswer {
    match answer {
        Some(Answer::Result(Value::Array(entries))) => EstimateAnswer::Entries(entries),
        Some(Answer::Error { .. }) => EstimateAnswer::NodeError,
        _ => EstimateAnswer::Unreadable,
    }
}

/// A broadcast reply, judged against the hash the core signed (`matchingAcceptedRpcWriteHash`).
#[derive(Debug, PartialEq, Eq)]
pub enum WriteAnswer {
    Accepted,
    /// A well-formed hash that is not the signed one.
    Mismatch,
    /// No usable answer: the node may or may not have accepted the write.
    Indeterminate,
    /// A determinate JSON-RPC refusal.
    NodeError,
}

pub fn write(answer: Option<Answer>, signed: &Felt) -> WriteAnswer {
    match answer {
        Some(Answer::Result(result)) => {
            match result
                .get("transaction_hash")
                .and_then(Value::as_str)
                .and_then(felt::parse_non_zero)
            {
                Some(hash) if hash == *signed => WriteAnswer::Accepted,
                Some(_) => WriteAnswer::Mismatch,
                None => WriteAnswer::Indeterminate,
            }
        }
        Some(Answer::Error { .. }) => WriteAnswer::NodeError,
        None => WriteAnswer::Indeterminate,
    }
}

/// One status observation, as `getTransactionStatuses` reports it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Observation {
    Found {
        status: TxStatus,
        /// ACCEPTED_ON_L2 or ACCEPTED_ON_L1 finality, whatever the execution status: what
        /// starknet.js `waitForTransaction` waits for.
        accepted_finality: bool,
        finalized_on_l1: bool,
    },
    NotFound,
    /// No usable answer; changes nothing.
    Unknown,
}

pub fn status(answer: Option<Answer>) -> Observation {
    match answer {
        Some(Answer::Result(result)) => {
            let finality = result
                .get("finality_status")
                .and_then(Value::as_str)
                .unwrap_or("");
            let reverted =
                result.get("execution_status").and_then(Value::as_str) == Some("REVERTED");
            let status = if reverted {
                TxStatus::Reverted
            } else {
                match finality {
                    "ACCEPTED_ON_L1" | "ACCEPTED_ON_L2" => TxStatus::Accepted,
                    "PRE_CONFIRMED" => TxStatus::Preconfirmed,
                    "REJECTED" => TxStatus::Rejected,
                    _ => TxStatus::Pending,
                }
            };
            Observation::Found {
                status,
                accepted_finality: matches!(finality, "ACCEPTED_ON_L1" | "ACCEPTED_ON_L2"),
                finalized_on_l1: finality == "ACCEPTED_ON_L1",
            }
        }
        Some(Answer::Error { code, text }) => {
            if code == Some(29) || text.contains("transaction hash not found") {
                Observation::NotFound
            } else {
                Observation::Found {
                    status: TxStatus::Pending,
                    accepted_finality: false,
                    finalized_on_l1: false,
                }
            }
        }
        None => Observation::Unknown,
    }
}

/// Whether a `starknet_getTransactionReceipt` reply carries a receipt.
pub fn receipt(answer: Option<Answer>) -> bool {
    matches!(answer, Some(Answer::Result(Value::Object(_))))
}
