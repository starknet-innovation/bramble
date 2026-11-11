//! On-chain token reads as sans-IO builders and judges (`wallet_core::portfolio::token_meta`):
//! ERC-20 metadata for "Add token" and balances for the Home list and "Find held tokens". The
//! UniFFI shapes and exports, and Bramble's transport line for add and scan.

use wallet_core::portfolio::token_meta as port;
pub use wallet_core::portfolio::token_meta::{BalanceOutcome, DiscoveryOutcome, TokenMetaOutcome};

use super::model::{TokenBalance, TokenConfig};
use super::wire::{RpcReply, RpcRequest};
use crate::networks::NetworkId;
use crate::CoreError;

/// The extension's transport copy for add and scan, shown once every endpoint has failed.
const NETWORK_UNREACHABLE: &str = "Couldn't reach the network, try again";

/// Result of judging the three metadata replies.
#[uniffi::remote(Enum)]
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
#[uniffi::remote(Enum)]
pub enum BalanceOutcome {
    Balances { rows: Vec<TokenBalance> },
    Transport,
    Failed,
}

/// Result of judging a discovery scan.
#[uniffi::remote(Enum)]
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
    port::token_add_address(input)
}

/// The `name`, `symbol` and `decimals` calls, ids `first_id` to `first_id + 2`.
#[uniffi::export]
pub fn token_metadata_requests(
    first_id: u64,
    address: String,
) -> Result<Vec<RpcRequest>, CoreError> {
    Ok(port::token_metadata_requests(first_id, address)?)
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
    port::token_metadata_judge(network, address, first_id, replies)
}

/// One `balanceOf(account)` call per token, ids `first_id` onward (send at most four at once).
#[uniffi::export]
pub fn balance_requests(
    first_id: u64,
    account: String,
    tokens: Vec<TokenConfig>,
) -> Result<Vec<RpcRequest>, CoreError> {
    Ok(port::balance_requests(first_id, account, tokens)?)
}

/// `getTokenBalances`: every token read or nothing; a malformed u256 fails the read.
#[uniffi::export]
pub fn balance_judge(
    first_id: u64,
    tokens: Vec<TokenConfig>,
    replies: Vec<RpcReply>,
) -> BalanceOutcome {
    port::balance_judge(first_id, tokens, replies)
}

/// `handleDetectTokens`' judgement: held registry tokens, or the extension's failure copy.
#[uniffi::export]
pub fn discovery_judge(
    first_id: u64,
    candidates: Vec<TokenConfig>,
    replies: Vec<RpcReply>,
) -> DiscoveryOutcome {
    port::discovery_judge(first_id, candidates, replies)
}
