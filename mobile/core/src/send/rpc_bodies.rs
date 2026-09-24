//! JSON-RPC request bodies for the send path, field for field what starknet.js 10.8.0 sends for
//! the extension (pinned by the wire capture in `extension-transactions-*.json`): spec 0.10,
//! block `latest`, tip 0, empty paymaster and deployment data, L1 data-availability modes, and
//! `SKIP_VALIDATE` estimates with an empty signature at the query version.

use serde_json::{json, Value};
use starknet_types_core::felt::Felt;

use super::fees::{Bound, Bounds};
use crate::felt;

/// Query version: 2^128 + 3.
const QUERY_VERSION: &str = "0x100000000000000000000000000000003";
const VERSION: &str = "0x3";

fn hex(value: u128) -> String {
    format!("{value:#x}")
}

fn felts(values: &[Felt]) -> Vec<String> {
    values.iter().map(felt::canonical).collect()
}

fn envelope(id: u64, method: &str, params: Value) -> String {
    json!({ "id": id, "jsonrpc": "2.0", "method": method, "params": params }).to_string()
}

fn bound(b: &Bound) -> Value {
    json!({ "max_amount": hex(b.max_amount), "max_price_per_unit": hex(b.max_price_per_unit) })
}

fn resource_bounds(bounds: Option<&Bounds>) -> Value {
    let zero = Bound {
        max_amount: 0,
        max_price_per_unit: 0,
    };
    let (l1, l2, data) = bounds.map_or((zero, zero, zero), |b| (b.l1_gas, b.l2_gas, b.l1_data_gas));
    json!({ "l1_data_gas": bound(&data), "l1_gas": bound(&l1), "l2_gas": bound(&l2) })
}

/// An INVOKE v3 transaction object; `signature` and `bounds` absent for an estimate query.
pub struct InvokeTx<'a> {
    pub sender: &'a Felt,
    pub calldata: &'a [Felt],
    pub nonce: &'a Felt,
    pub bounds: Option<&'a Bounds>,
    pub signature: Option<&'a [Felt; 2]>,
}

/// A DEPLOY_ACCOUNT v3 transaction object for an OpenZeppelin account (salt 0, the public key
/// as the only constructor argument).
pub struct DeployTx<'a> {
    pub class_hash: &'a Felt,
    pub public_key: &'a Felt,
    pub nonce: &'a Felt,
    pub bounds: Option<&'a Bounds>,
    pub signature: Option<&'a [Felt; 2]>,
}

fn signature(value: Option<&[Felt; 2]>) -> Vec<String> {
    value.map(|s| felts(s)).unwrap_or_default()
}

fn invoke_object(tx: &InvokeTx<'_>) -> Value {
    json!({
        "account_deployment_data": [],
        "calldata": felts(tx.calldata),
        "fee_data_availability_mode": "L1",
        "nonce": felt::canonical(tx.nonce),
        "nonce_data_availability_mode": "L1",
        "paymaster_data": [],
        "resource_bounds": resource_bounds(tx.bounds),
        "sender_address": felt::canonical(tx.sender),
        "signature": signature(tx.signature),
        "tip": "0x0",
        "type": "INVOKE",
        "version": if tx.signature.is_some() { VERSION } else { QUERY_VERSION },
    })
}

fn deploy_object(tx: &DeployTx<'_>) -> Value {
    json!({
        "class_hash": felt::canonical(tx.class_hash),
        "constructor_calldata": [felt::canonical(tx.public_key)],
        "contract_address_salt": "0x0",
        "fee_data_availability_mode": "L1",
        "nonce": felt::canonical(tx.nonce),
        "nonce_data_availability_mode": "L1",
        "paymaster_data": [],
        "resource_bounds": resource_bounds(tx.bounds),
        "signature": signature(tx.signature),
        "tip": "0x0",
        "type": "DEPLOY_ACCOUNT",
        "version": if tx.signature.is_some() { VERSION } else { QUERY_VERSION },
    })
}

/// `starknet_getClassHashAt` at `latest`.
pub fn class_hash_at(id: u64, address: &Felt) -> String {
    envelope(
        id,
        "starknet_getClassHashAt",
        json!({ "block_id": "latest", "contract_address": felt::canonical(address) }),
    )
}

/// `starknet_getNonce` at `latest`.
pub fn nonce(id: u64, address: &Felt) -> String {
    envelope(
        id,
        "starknet_getNonce",
        json!({ "block_id": "latest", "contract_address": felt::canonical(address) }),
    )
}

/// One `starknet_estimateFee` over the given transactions, validation skipped.
pub fn estimate(id: u64, invoke: Option<&InvokeTx<'_>>, deploy: Option<&DeployTx<'_>>) -> String {
    let mut request = Vec::new();
    if let Some(deploy) = deploy {
        request.push(deploy_object(deploy));
    }
    if let Some(invoke) = invoke {
        request.push(invoke_object(invoke));
    }
    envelope(
        id,
        "starknet_estimateFee",
        json!({ "block_id": "latest", "request": request, "simulation_flags": ["SKIP_VALIDATE"] }),
    )
}

/// `starknet_addInvokeTransaction`.
pub fn add_invoke(id: u64, tx: &InvokeTx<'_>) -> String {
    envelope(
        id,
        "starknet_addInvokeTransaction",
        json!({ "invoke_transaction": invoke_object(tx) }),
    )
}

/// `starknet_addDeployAccountTransaction`.
pub fn add_deploy(id: u64, tx: &DeployTx<'_>) -> String {
    envelope(
        id,
        "starknet_addDeployAccountTransaction",
        json!({ "deploy_account_transaction": deploy_object(tx) }),
    )
}

/// `starknet_getTransactionStatus`.
pub fn transaction_status(id: u64, hash: &Felt) -> String {
    envelope(
        id,
        "starknet_getTransactionStatus",
        json!({ "transaction_hash": felt::canonical(hash) }),
    )
}

/// `starknet_getTransactionReceipt`.
pub fn transaction_receipt(id: u64, hash: &Felt) -> String {
    envelope(
        id,
        "starknet_getTransactionReceipt",
        json!({ "transaction_hash": felt::canonical(hash) }),
    )
}
