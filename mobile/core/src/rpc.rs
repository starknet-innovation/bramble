//! Sans-IO Starknet JSON-RPC. The core builds request bodies and judges responses; the host
//! moves the bytes with its platform HTTP stack (URLSession / OkHttp), so TLS, proxies, and
//! certificate policy stay with the operating system and no network code runs in Rust.
//!
//! Every response is untrusted: it must answer the request id it was sent under, and every
//! value is range-checked before it is interpreted.

use serde_json::{json, Value};

use crate::networks::{self, NetworkId};
use crate::{felt, CoreError};

/// `starknet_keccak("balanceOf")`, checked against a Keccak implementation in the tests.
const BALANCE_OF_SELECTOR: &str =
    "0x2e4263afad30923c891518314c3c95dbe830a16874e8abc5777a9a20b54c76e";
/// Longest response body the core will parse.
pub(crate) const MAX_RESPONSE_BYTES: usize = 64 * 1024;

/// One JSON-RPC body for the host to POST, with the largest reply the core will judge for it.
/// The host's one transport stops reading and reports a transport failure past
/// `max_response_bytes`, so a hostile endpoint cannot make the app buffer an unbounded body
/// before the core's own size check runs.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct RpcRequest {
    pub id: u64,
    pub body: String,
    pub max_response_bytes: u64,
}

impl RpcRequest {
    /// A request whose reply is bounded by the core's default `MAX_RESPONSE_BYTES`.
    pub(crate) fn new(id: u64, body: String) -> Self {
        Self::bounded(id, body, MAX_RESPONSE_BYTES)
    }

    /// A request whose reply may be up to `max_bytes` (a class definition, for example).
    pub(crate) fn bounded(id: u64, body: String, max_bytes: usize) -> Self {
        Self {
            id,
            body,
            max_response_bytes: max_bytes as u64,
        }
    }
}

/// A response body the host received for one request.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct RpcResponse {
    pub id: u64,
    pub body: String,
}

pub(crate) fn rpc_error(reason: &str) -> CoreError {
    CoreError::Rpc {
        reason: reason.into(),
    }
}

pub(crate) fn envelope(id: u64, method: &str, params: Value) -> String {
    json!({ "id": id, "jsonrpc": "2.0", "method": method, "params": params }).to_string()
}

fn result(body: &str, id: u64) -> Result<Value, CoreError> {
    if body.len() > MAX_RESPONSE_BYTES {
        return Err(rpc_error("response too large"));
    }
    let value: Value = serde_json::from_str(body).map_err(|_| rpc_error("malformed response"))?;
    if value.get("jsonrpc") != Some(&json!("2.0")) || value.get("id") != Some(&json!(id)) {
        return Err(rpc_error("response does not answer this request"));
    }
    if value.get("error").is_some() {
        return Err(rpc_error("node returned an error"));
    }
    value
        .get("result")
        .cloned()
        .ok_or_else(|| rpc_error("response has no result"))
}

/// Body for `starknet_chainId`.
pub fn chain_id_request(id: u64) -> String {
    envelope(id, "starknet_chainId", json!([]))
}

/// Whether a `starknet_chainId` response names the expected network.
pub fn verify_chain_id(body: &str, id: u64, network: NetworkId) -> Result<bool, CoreError> {
    let reported = result(body, id)?;
    let reported = reported
        .as_str()
        .and_then(felt::parse)
        .ok_or_else(|| rpc_error("bad chain id"))?;
    Ok(felt::canonical(&reported) == networks::info(network).chain_id)
}

/// Body for an ERC-20 `balanceOf(account)` call at the latest block.
pub fn balance_of_request(id: u64, token: &str, account: &str) -> Result<String, CoreError> {
    let token = felt::parse_non_zero(token).ok_or_else(|| rpc_error("token is not an address"))?;
    let account =
        felt::parse_non_zero(account).ok_or_else(|| rpc_error("account is not an address"))?;
    Ok(envelope(
        id,
        "starknet_call",
        json!({
            "block_id": "latest",
            "request": {
                "calldata": [felt::canonical(&account)],
                "contract_address": felt::canonical(&token),
                "entry_point_selector": BALANCE_OF_SELECTOR,
            },
        }),
    ))
}

fn limb(value: &Value) -> Result<u128, CoreError> {
    let text = value
        .as_str()
        .ok_or_else(|| rpc_error("balance limb is not a string"))?;
    felt::parse(text).ok_or_else(|| rpc_error("balance limb is not a felt"))?;
    u128::from_str_radix(text.trim_start_matches("0x"), 16)
        .map_err(|_| rpc_error("balance limb exceeds u128"))
}

/// Parses a `balanceOf` response (`[low, high]` u256) into a base-10 integer string.
pub fn parse_balance_of(body: &str, id: u64) -> Result<String, CoreError> {
    let value = result(body, id)?;
    let limbs = value
        .as_array()
        .filter(|limbs| limbs.len() == 2)
        .ok_or_else(|| rpc_error("balance is not a u256"))?;
    Ok(u256_to_decimal(limb(&limbs[0])?, limb(&limbs[1])?))
}

pub(crate) fn u256_to_decimal(low: u128, high: u128) -> String {
    if high == 0 {
        return low.to_string();
    }
    // Four big-endian u64 limbs, repeatedly divided by 10^19.
    let mut limbs = [
        (high >> 64) as u64,
        high as u64,
        (low >> 64) as u64,
        low as u64,
    ];
    let mut chunks = Vec::new();
    while limbs.iter().any(|l| *l != 0) {
        let mut remainder: u128 = 0;
        for l in limbs.iter_mut() {
            let current = (remainder << 64) | u128::from(*l);
            *l = (current / 10_000_000_000_000_000_000) as u64;
            remainder = current % 10_000_000_000_000_000_000;
        }
        chunks.push(remainder as u64);
    }
    let mut out = chunks.pop().map(|c| c.to_string()).unwrap_or_default();
    for chunk in chunks.iter().rev() {
        out.push_str(&format!("{chunk:019}"));
    }
    out
}

/// Formats a base-10 base-unit amount for display, rounding down to `max_fraction` digits.
pub fn format_amount(raw: &str, decimals: u8, max_fraction: u8) -> Result<String, CoreError> {
    if raw.is_empty() || raw.len() > 78 || !raw.bytes().all(|b| b.is_ascii_digit()) {
        return Err(CoreError::InvalidInput {
            reason: "amount is not a base-10 integer".into(),
        });
    }
    let digits = raw.trim_start_matches('0');
    let decimals = usize::from(decimals);
    let padded = format!("{digits:0>width$}", width = decimals + 1);
    let (whole, fraction) = padded.split_at(padded.len() - decimals);
    let fraction = fraction[..fraction.len().min(usize::from(max_fraction))].trim_end_matches('0');
    Ok(if fraction.is_empty() {
        whole.to_string()
    } else {
        format!("{whole}.{fraction}")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn balance_round_trip() {
        let body = r#"{"jsonrpc":"2.0","id":7,"result":["0xde0b6b3a7640000","0x0"]}"#;
        assert_eq!(parse_balance_of(body, 7).unwrap(), "1000000000000000000");
        assert!(parse_balance_of(body, 8).is_err(), "wrong id");
        let high = r#"{"jsonrpc":"2.0","id":1,"result":["0x0","0x1"]}"#;
        assert_eq!(
            parse_balance_of(high, 1).unwrap(),
            "340282366920938463463374607431768211456"
        );
        let max = format!(
            r#"{{"jsonrpc":"2.0","id":1,"result":["0x{f}","0x{f}"]}}"#,
            f = "f".repeat(32)
        );
        assert_eq!(
            parse_balance_of(&max, 1).unwrap(),
            "115792089237316195423570985008687907853269984665640564039457584007913129639935"
        );
        let overflow = format!(
            r#"{{"jsonrpc":"2.0","id":1,"result":["0x1{}","0x0"]}}"#,
            "0".repeat(32)
        );
        assert!(parse_balance_of(&overflow, 1).is_err());
        assert!(parse_balance_of(r#"{"jsonrpc":"2.0","id":1,"error":{}}"#, 1).is_err());
    }

    #[test]
    fn formats_amounts() {
        assert_eq!(format_amount("1000000000000000000", 18, 4).unwrap(), "1");
        assert_eq!(
            format_amount("1234567890000000000", 18, 4).unwrap(),
            "1.2345"
        );
        assert_eq!(format_amount("5", 18, 4).unwrap(), "0");
        assert_eq!(format_amount("0", 18, 4).unwrap(), "0");
        assert!(format_amount("-1", 18, 4).is_err());
    }

    #[test]
    fn chain_id_is_checked() {
        let sepolia = r#"{"jsonrpc":"2.0","id":2,"result":"0x534e5f5345504f4c4941"}"#;
        assert!(verify_chain_id(sepolia, 2, NetworkId::Sepolia).unwrap());
        assert!(!verify_chain_id(sepolia, 2, NetworkId::Mainnet).unwrap());
    }

    #[test]
    fn selector_is_starknet_keccak() {
        use sha3::{Digest, Keccak256};
        let mut digest: [u8; 32] = Keccak256::digest(b"balanceOf").into();
        digest[0] &= 0x03; // keep 250 bits
        let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(
            format!("0x{}", hex.trim_start_matches('0')),
            BALANCE_OF_SELECTOR
        );
    }
}
