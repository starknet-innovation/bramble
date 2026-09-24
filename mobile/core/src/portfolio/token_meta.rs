//! On-chain token reads as sans-IO builders and judges: ERC-20 metadata for "Add token"
//! (`rpc.ts getTokenMetadata`, `decodeErc20String`, `token-ops.ts buildTokenRecord`) and
//! balances for the Home list and "Find held tokens" (`getTokenBalances`, `handleDetectTokens`).
//!
//! Every judge classifies its replies the way `withRpcFallback` does (§3.9 of the design): a
//! transport-class failure means "try the next endpoint", a node error means this read failed.
//! Short-string decoding is ported from starknet.js `decodeShortString` byte for byte, because
//! the stored name and symbol must be the ones the extension would store.

use serde_json::json;

use super::model::{TokenBalance, TokenConfig};
use super::tokens::{is_token_name, is_token_symbol, with_token_id};
use super::wire::{classify, rpc_call, Reply, RpcCall, RpcReply};
use crate::js::big::parse_bigint;
use crate::js::felt::{canonical_address, canonical_felt, is_stark_field_element, uint256_felts};
use crate::js::json::JsValue;
use crate::js::num::{js_trim, utf16_slice};
use crate::networks::NetworkId;
use crate::CoreError;

/// `starknet_keccak("name")`, `("symbol")`, `("decimals")`; Keccak-checked in the tests.
const NAME_SELECTOR: &str = "0x361458367e696363fbcc70777d07ebbd2394e89fd0adcaf147faccd1d294d60";
const SYMBOL_SELECTOR: &str = "0x216b05c387bab9ac31918a3e61672f4618601f3c598a2f3f2710f37053e1ea4";
const DECIMALS_SELECTOR: &str = "0x4c4fb1ab068f6039d5780c68dd0fa2f8742cceb3426d19667778ca7f3518a9";

const METADATA_FAILED: &str = "could not read token metadata";
const UNSUPPORTED_SYMBOL: &str = "unsupported token symbol";
/// The extension's transport copy for add and scan, shown once every endpoint has failed.
const NETWORK_UNREACHABLE: &str = "Couldn't reach the network, try again";
const SCAN_FAILED: &str = "Token scan failed, try again";

/// Result of judging the three metadata replies.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum TokenMetaOutcome {
    /// A storable token (pass it to `TokenPreferences::add`).
    Token { token: TokenConfig },
    /// This endpoint failed at transport level: try the next one.
    Transport,
    /// The read failed: show `message` ("could not read token metadata" or
    /// "unsupported token symbol").
    Failed { message: String },
}

/// Result of judging a batch of balance replies.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum BalanceOutcome {
    Balances { rows: Vec<TokenBalance> },
    Transport,
    Failed,
}

/// Result of judging a discovery scan.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum DiscoveryOutcome {
    /// Registry tokens holding a non-zero balance.
    Found {
        tokens: Vec<TokenBalance>,
    },
    Transport,
    Failed {
        message: String,
    },
}

/// The copy shown when every endpoint failed at transport level during add or discovery.
#[uniffi::export]
pub fn token_network_error() -> String {
    NETWORK_UNREACHABLE.into()
}

/// The add-token form's address: `normalizeFeltInput` then `canonicalAddress`; `None` for input
/// that is not a non-zero field element (the extension's "invalid add token request").
#[uniffi::export]
pub fn token_add_address(input: String) -> Option<String> {
    let trimmed = js_trim(&input);
    let normalized = if trimmed.starts_with("0x") {
        canonical_felt(trimmed).unwrap_or_else(|| trimmed.to_string())
    } else {
        trimmed.to_string()
    };
    canonical_address(&normalized)
}

fn call(id: u64, address: &str, selector: &str) -> RpcCall {
    rpc_call(
        id,
        "starknet_call",
        json!({
            "block_id": "latest",
            "request": { "calldata": [], "contract_address": address, "entry_point_selector": selector },
        }),
    )
}

/// The `name`, `symbol` and `decimals` calls, ids `first_id` to `first_id + 2`.
#[uniffi::export]
pub fn token_metadata_requests(first_id: u64, address: String) -> Result<Vec<RpcCall>, CoreError> {
    if crate::felt::parse_non_zero(&address).is_none() {
        return Err(CoreError::InvalidInput {
            reason: "Invalid token address".into(),
        });
    }
    Ok(vec![
        call(first_id, &address, NAME_SELECTOR),
        call(first_id + 1, &address, SYMBOL_SELECTOR),
        call(first_id + 2, &address, DECIMALS_SELECTOR),
    ])
}

// What indexing a JavaScript `result` sees: an array's items, a string's code units, or
// nothing (`length` and every index undefined).
fn items(result: &JsValue) -> Option<Vec<JsValue>> {
    match result {
        JsValue::Array(values) => Some(values.clone()),
        JsValue::String(text) => Some(
            text.encode_utf16()
                .map(|unit| JsValue::String(String::from_utf16_lossy(&[unit])))
                .collect(),
        ),
        _ => None,
    }
}

// `decodeShortFelt` + starknet.js `decodeShortString`: byte pairs to characters, an odd trailing
// digit kept literally, nothing for a non-felt or zero.
fn decode_short_felt(value: Option<&JsValue>) -> String {
    let Some(text) = value.and_then(JsValue::as_str) else {
        return String::new();
    };
    if !is_stark_field_element(text) || crate::felt::parse_non_zero(text).is_none() {
        return String::new();
    }
    let digits = &text[2..];
    let mut out = String::new();
    let bytes = digits.as_bytes();
    for pair in bytes.chunks(2) {
        if pair.len() == 2 {
            let hex = std::str::from_utf8(pair).unwrap_or("00");
            out.push(char::from(u8::from_str_radix(hex, 16).unwrap_or(0)));
        } else {
            out.push(char::from(pair[0]));
        }
    }
    out
}

// `Number(BigInt(value))` as far as `decodeErc20String` needs it: `None` where `BigInt` throws.
fn word_count(value: Option<&JsValue>) -> Option<Option<u128>> {
    match value {
        None => Some(Some(0)),
        Some(JsValue::String(text)) => parse_bigint(text).map(|b| {
            if b.negative && !b.magnitude.is_zero() {
                None
            } else {
                b.magnitude.to_u128()
            }
        }),
        Some(JsValue::Number(n)) if n.fract() == 0.0 && n.is_finite() => {
            Some((*n >= 0.0).then_some(*n as u128))
        }
        Some(JsValue::Bool(b)) => Some(Some(u128::from(*b))),
        _ => None,
    }
}

/// `decodeErc20String`: a short string, or the Cairo ByteArray `[words, …words, pending, len]`.
pub fn decode_erc20_string(result: &JsValue) -> String {
    let list = items(result);
    let first = list.as_ref().and_then(|l| l.first());
    let fallback = || js_trim(&decode_short_felt(first)).to_string();
    let Some(list) = list.as_ref() else {
        return fallback();
    };
    if list.len() <= 1 {
        return fallback();
    }
    let Some(count) = word_count(first) else {
        return fallback();
    };
    match count {
        Some(count) if count < (1u128 << 53) && list.len() as u128 == count + 3 => {
            let count = count as usize;
            let mut text: String = (1..=count)
                .map(|i| decode_short_felt(list.get(i)))
                .collect();
            text.push_str(&decode_short_felt(list.get(count + 1)));
            js_trim(&text).to_string()
        }
        _ => fallback(),
    }
}

/// Judges the three metadata replies into a storable token (`getTokenMetadata` then
/// `buildTokenRecord`).
#[uniffi::export]
pub fn token_metadata_judge(
    network: NetworkId,
    address: String,
    first_id: u64,
    replies: Vec<RpcReply>,
) -> TokenMetaOutcome {
    let mut results = Vec::new();
    for offset in 0..3 {
        let id = first_id + offset;
        let reply = replies.iter().find(|r| r.id == id);
        match reply.map(|r| classify(r, id)) {
            None | Some(Reply::Transport) => return TokenMetaOutcome::Transport,
            Some(Reply::Semantic) => results.push(None),
            Some(Reply::Result(value)) => results.push(Some(value)),
        }
    }
    let failed = || TokenMetaOutcome::Failed {
        message: METADATA_FAILED.into(),
    };
    let [Some(name), Some(symbol), Some(decimals)] = [&results[0], &results[1], &results[2]] else {
        return failed();
    };
    if [name, symbol, decimals]
        .iter()
        .any(|r| matches!(r, JsValue::Null))
    {
        return TokenMetaOutcome::Transport;
    }
    let raw_decimals = items(decimals).and_then(|l| l.first().cloned());
    let Some(raw) = raw_decimals
        .as_ref()
        .and_then(JsValue::as_str)
        .filter(|t| is_stark_field_element(t))
    else {
        return failed();
    };
    let Some(decimals) = parse_bigint(raw)
        .and_then(|b| b.magnitude.to_u128())
        .filter(|d| *d <= 36)
    else {
        return failed();
    };
    let symbol = js_trim(&decode_erc20_string(symbol)).to_uppercase();
    if !is_token_symbol(&symbol) {
        return TokenMetaOutcome::Failed {
            message: UNSUPPORTED_SYMBOL.into(),
        };
    }
    let trimmed = utf16_slice(js_trim(&decode_erc20_string(name)), 0, 64);
    let name = if is_token_name(&trimmed) {
        trimmed
    } else {
        symbol.clone()
    };
    TokenMetaOutcome::Token {
        token: with_token_id(network, &address, &symbol, &name, decimals as u8),
    }
}

/// One `balanceOf(account)` call per token, ids `first_id` onward (send at most four at once).
#[uniffi::export]
pub fn balance_requests(
    first_id: u64,
    account: String,
    tokens: Vec<TokenConfig>,
) -> Result<Vec<RpcCall>, CoreError> {
    tokens
        .iter()
        .enumerate()
        .map(|(i, token)| {
            let id = first_id + i as u64;
            crate::rpc::balance_of_request(id, &token.address, &account)
                .map(|body| RpcCall { id, body })
        })
        .collect()
}

/// `getTokenBalances`: every token read or nothing; a malformed u256 fails the read.
#[uniffi::export]
pub fn balance_judge(
    first_id: u64,
    tokens: Vec<TokenConfig>,
    replies: Vec<RpcReply>,
) -> BalanceOutcome {
    let mut rows = Vec::new();
    let mut failed = false;
    for (i, token) in tokens.into_iter().enumerate() {
        let id = first_id + i as u64;
        let value = match replies.iter().find(|r| r.id == id).map(|r| classify(r, id)) {
            None | Some(Reply::Transport) => return BalanceOutcome::Transport,
            Some(Reply::Semantic) => {
                failed = true;
                continue;
            }
            Some(Reply::Result(value)) => value,
        };
        if matches!(value, JsValue::Null) {
            return BalanceOutcome::Transport;
        }
        let limbs = items(&value).filter(|l| l.len() == 2);
        let Some((low, high)) = limbs.and_then(|l| uint256_felts(l.first(), l.get(1))) else {
            failed = true;
            continue;
        };
        let balance = crate::rpc::u256_to_decimal(low, high);
        let formatted = crate::rpc::format_amount(&balance, token.decimals, token.decimals)
            .unwrap_or_else(|_| balance.clone());
        rows.push(TokenBalance {
            token,
            balance,
            formatted,
        });
    }
    if failed {
        BalanceOutcome::Failed
    } else {
        BalanceOutcome::Balances { rows }
    }
}

/// `handleDetectTokens`' judgement: held registry tokens, or the extension's failure copy.
#[uniffi::export]
pub fn discovery_judge(
    first_id: u64,
    candidates: Vec<TokenConfig>,
    replies: Vec<RpcReply>,
) -> DiscoveryOutcome {
    match balance_judge(first_id, candidates, replies) {
        BalanceOutcome::Balances { rows } => DiscoveryOutcome::Found {
            tokens: rows.into_iter().filter(|b| b.balance != "0").collect(),
        },
        BalanceOutcome::Transport => DiscoveryOutcome::Transport,
        BalanceOutcome::Failed => DiscoveryOutcome::Failed {
            message: SCAN_FAILED.into(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keccak_selector(name: &str) -> String {
        use sha3::{Digest, Keccak256};
        let mut digest: [u8; 32] = Keccak256::digest(name.as_bytes()).into();
        digest[0] &= 0x03;
        let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
        format!("0x{}", hex.trim_start_matches('0'))
    }

    #[test]
    fn selectors_are_starknet_keccak() {
        assert_eq!(keccak_selector("name"), NAME_SELECTOR);
        assert_eq!(keccak_selector("symbol"), SYMBOL_SELECTOR);
        assert_eq!(keccak_selector("decimals"), DECIMALS_SELECTOR);
    }

    fn strings(values: &[&str]) -> JsValue {
        JsValue::Array(
            values
                .iter()
                .map(|v| JsValue::String((*v).into()))
                .collect(),
        )
    }

    #[test]
    fn decodes_short_strings_and_byte_arrays() {
        assert_eq!(decode_erc20_string(&strings(&["0x5354524b"])), "STRK");
        assert_eq!(decode_erc20_string(&strings(&["0x414"])), "A4");
        let byte_array = strings(&["0x1", "0x48656c6c6f", "0x20576f726c64", "0x6"]);
        assert_eq!(decode_erc20_string(&byte_array), "Hello World");
        assert_eq!(decode_erc20_string(&strings(&["0x2", "0x41"])), "2");
    }

    #[test]
    fn unsupported_symbol_and_transport() {
        let reply = |id: u64, result: &str| RpcReply {
            id,
            status: 200,
            body: Some(format!(
                r#"{{"jsonrpc":"2.0","id":{id},"result":{result}}}"#
            )),
        };
        let address = canonical_address("0x1234").unwrap();
        let bad_symbol = vec![
            reply(1, r#"["0x41"]"#),
            reply(2, r#"["0x612d62"]"#),
            reply(3, r#"["0x12"]"#),
        ];
        assert_eq!(
            token_metadata_judge(NetworkId::Mainnet, address.clone(), 1, bad_symbol),
            TokenMetaOutcome::Failed {
                message: UNSUPPORTED_SYMBOL.into()
            }
        );
        let missing = vec![reply(1, r#"["0x41"]"#)];
        assert_eq!(
            token_metadata_judge(NetworkId::Mainnet, address, 1, missing),
            TokenMetaOutcome::Transport
        );
    }
}
