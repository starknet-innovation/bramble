//! Activity rows, ported from `transactions/activity/activity.ts` (`ActivityEntry`,
//! `isActivityEntry`) and `history/tx-history.ts` (`onChainActivityEntry`, `mergeActivity`).
//! Summaries are load-bearing in the extension (dedup matches on them), so they are built here,
//! exactly, and never by the host.

use serde_json::{json, Map, Value};

use super::explorer::is_account_id_for_network;
use crate::activity::store::{kind_text, parse_kind, parse_status, status_text};
use crate::js::felt::{
    canonical_felt, is_non_zero_felt, is_stark_field_element, same_felt, same_felt_value,
    uint256_felts,
};
use crate::js::json::JsValue;
use crate::js::num::{is_safe_integer, utf16_len, utf16_slice};
use crate::networks::NetworkId;
use crate::portfolio::model::{network_code, network_from_code, TokenConfig};
pub use crate::send::types::{ActivityKind, TxStatus};

const MAX_SUMMARY_LENGTH: usize = 200;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

/// Reconciliation bookkeeping for a failure the user has moved past.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum FailureNotice {
    Delivered,
    Pending,
}

/// The extension's `ActivityEntry`. Built only by the core (on-chain rows) or validated by it
/// (`ActivityBook::record_local`).
/// Whether value came into or went out of the account (`ActivityEntry.direction`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum TransferDirection {
    In,
    Out,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct ActivityEntry {
    pub account_id: String,
    pub amount: Option<String>,
    pub counterparty: Option<String>,
    /// Recorded where known: from the decoded transfer on discovered rows, `Out` on a send this
    /// wallet made. The feed reads it before the summary, whose token symbol a third party
    /// chooses (Sherlock 196). Absent on legacy rows and rows that are not one value movement.
    #[uniffi(default = None)]
    pub direction: Option<TransferDirection>,
    pub failure_notice: Option<FailureNotice>,
    pub finalized_on_l1: Option<bool>,
    pub hash: String,
    pub kind: ActivityKind,
    pub network: NetworkId,
    pub not_found_count: Option<u64>,
    pub status: TxStatus,
    pub submitted_at: u64,
    pub summary: String,
    pub token: Option<String>,
    /// The canonical address of the token `token` names (issue 643); never without `token`.
    #[uniffi(default = None)]
    pub token_address: Option<String>,
}

/// `isRecordedTokenAddress`: absent, or one canonical non-zero field element beside a symbol.
pub(crate) fn is_recorded_token_address(address: Option<&str>, token: Option<&str>) -> bool {
    address.is_none_or(|address| {
        token.is_some()
            && is_non_zero_felt(address)
            && canonical_felt(address).as_deref() == Some(address)
    })
}

/// `activityToken`: the token's canonical address when it is a non-zero field element.
pub(crate) fn activity_token_address(address: &str) -> Option<String> {
    canonical_felt(address).filter(|address| is_non_zero_felt(address))
}

/// `isZeroAmountLabel`: `/^0(?:\.0*)?$/`, a formatted amount of zero.
fn is_zero_amount_label(amount: &str) -> bool {
    match amount.strip_prefix('0') {
        Some(rest) => {
            rest.is_empty()
                || rest
                    .strip_prefix('.')
                    .is_some_and(|z| z.chars().all(|c| c == '0'))
        }
        None => false,
    }
}

/// The symbol the explorer lane gives a token the wallet does not track.
pub(crate) const UNTRACKED_TOKEN_SYMBOL: &str = "TOKEN";

/// `withoutPlantedRows` (audit #163): the planted-row rule applied to rows stored before it
/// existed, which reach the merge as local rows and would otherwise be kept. A zero-amount
/// transfer and an outgoing untracked-token transfer are dropped; an incoming untracked-token
/// transfer loses its counterparty. The extension spares `origin: "wallet"` rows; mobile records
/// no origin, but its own sends are of a bundled token and never zero, so the rule cannot reach
/// them.
pub(crate) fn without_planted_rows(entries: Vec<ActivityEntry>) -> Vec<ActivityEntry> {
    entries
        .into_iter()
        .filter_map(|mut entry| {
            if entry.kind != ActivityKind::Transfer {
                return Some(entry);
            }
            if entry.amount.as_deref().is_some_and(is_zero_amount_label) {
                return None;
            }
            if entry.token.as_deref() != Some(UNTRACKED_TOKEN_SYMBOL) {
                return Some(entry);
            }
            if entry.summary.starts_with("Sent ") {
                return None;
            }
            entry.counterparty = None;
            Some(entry)
        })
        .collect()
}

pub(crate) fn direction_text(direction: TransferDirection) -> &'static str {
    match direction {
        TransferDirection::In => "in",
        TransferDirection::Out => "out",
    }
}

pub(crate) fn parse_direction(text: &str) -> Option<TransferDirection> {
    match text {
        "in" => Some(TransferDirection::In),
        "out" => Some(TransferDirection::Out),
        _ => None,
    }
}

fn optional_detail(value: Option<&String>) -> bool {
    value.is_none_or(|v| (1..=200).contains(&utf16_len(v)))
}

/// `isActivityEntry`.
pub(crate) fn is_activity_entry(entry: &ActivityEntry) -> bool {
    is_account_id_for_network(&entry.account_id, entry.network)
        && is_stark_field_element(&entry.hash)
        && entry.submitted_at <= MAX_SAFE_INTEGER
        && (1..=MAX_SUMMARY_LENGTH).contains(&utf16_len(&entry.summary))
        && optional_detail(entry.amount.as_ref())
        && optional_detail(entry.counterparty.as_ref())
        && optional_detail(entry.token.as_ref())
        && is_recorded_token_address(entry.token_address.as_deref(), entry.token.as_deref())
        && entry.not_found_count.is_none_or(|n| n <= MAX_SAFE_INTEGER)
}

pub fn entry_to_json(entry: &ActivityEntry) -> Value {
    let mut map = Map::new();
    map.insert("accountId".into(), json!(entry.account_id));
    if let Some(v) = &entry.amount {
        map.insert("amount".into(), json!(v));
    }
    if let Some(v) = &entry.counterparty {
        map.insert("counterparty".into(), json!(v));
    }
    if let Some(v) = entry.direction {
        map.insert("direction".into(), json!(direction_text(v)));
    }
    if let Some(v) = entry.failure_notice {
        map.insert(
            "failureNotice".into(),
            json!(if v == FailureNotice::Pending {
                "pending"
            } else {
                "delivered"
            }),
        );
    }
    if let Some(v) = entry.finalized_on_l1 {
        map.insert("finalizedOnL1".into(), json!(v));
    }
    map.insert("hash".into(), json!(entry.hash));
    map.insert("kind".into(), json!(kind_text(entry.kind)));
    map.insert("networkId".into(), json!(network_code(entry.network)));
    if let Some(v) = entry.not_found_count {
        map.insert("notFoundCount".into(), json!(v));
    }
    map.insert("status".into(), json!(status_text(entry.status)));
    map.insert("submittedAt".into(), json!(entry.submitted_at));
    map.insert("summary".into(), json!(entry.summary));
    if let Some(v) = &entry.token {
        map.insert("token".into(), json!(v));
    }
    if let Some(v) = &entry.token_address {
        map.insert("tokenAddress".into(), json!(v));
    }
    Value::Object(map)
}

fn safe_count(value: &JsValue) -> Option<u64> {
    let n = value.as_f64()?;
    (n.fract() == 0.0 && (0.0..=MAX_SAFE_INTEGER as f64).contains(&n)).then_some(n as u64)
}

/// Reads a stored or fixture entry; `None` unless it passes `isActivityEntry`.
pub fn entry_from_json(value: &JsValue) -> Option<ActivityEntry> {
    const KEYS: [&str; 15] = [
        "accountId",
        "amount",
        "counterparty",
        "direction",
        "failureNotice",
        "finalizedOnL1",
        "hash",
        "kind",
        "networkId",
        "notFoundCount",
        "status",
        "submittedAt",
        "summary",
        "token",
        "tokenAddress",
    ];
    if !value
        .as_object()?
        .iter()
        .all(|(k, _)| KEYS.contains(&k.as_str()))
    {
        return None;
    }
    let text = |key: &str| value.get(key).and_then(JsValue::as_str).map(str::to_string);
    let optional_text = |key: &str| match value.get(key) {
        None => Some(None),
        Some(JsValue::String(s)) => Some(Some(s.clone())),
        Some(_) => None,
    };
    let entry = ActivityEntry {
        account_id: text("accountId")?,
        amount: optional_text("amount")?,
        counterparty: optional_text("counterparty")?,
        direction: match optional_text("direction")? {
            None => None,
            Some(text) => Some(parse_direction(&text)?),
        },
        failure_notice: match value.get("failureNotice") {
            None => None,
            Some(JsValue::String(s)) if s == "pending" => Some(FailureNotice::Pending),
            Some(JsValue::String(s)) if s == "delivered" => Some(FailureNotice::Delivered),
            Some(_) => return None,
        },
        finalized_on_l1: match value.get("finalizedOnL1") {
            None => None,
            Some(JsValue::Bool(b)) => Some(*b),
            Some(_) => return None,
        },
        hash: text("hash")?,
        kind: parse_kind(&text("kind")?)?,
        network: network_from_code(&text("networkId")?)?,
        not_found_count: match value.get("notFoundCount") {
            None => None,
            Some(v) => Some(safe_count(v)?),
        },
        status: parse_status(&text("status")?)?,
        submitted_at: safe_count(value.get("submittedAt")?)?,
        summary: text("summary")?,
        token: optional_text("token")?,
        token_address: optional_text("tokenAddress")?,
    };
    is_activity_entry(&entry).then_some(entry)
}

/// One ERC-20 transfer relative to the account (`DecodedTransfer`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedTransfer {
    pub amount_raw: String,
    pub block_number: u64,
    pub counterparty: String,
    pub incoming: bool,
    pub hash: String,
}

fn short_address(address: &str) -> String {
    if utf16_len(address) > 12 {
        let len = utf16_len(address);
        format!(
            "{}…{}",
            utf16_slice(address, 0, 6),
            utf16_slice(address, len - 4, len)
        )
    } else {
        address.to_string()
    }
}

/// `onChainActivityEntry`: an accepted transfer row dated by its block.
pub(crate) fn on_chain_activity_entry(
    account_id: &str,
    decoded: &DecodedTransfer,
    network: NetworkId,
    timestamp_ms: u64,
    token: &TokenConfig,
) -> ActivityEntry {
    let amount = crate::rpc::format_amount(&decoded.amount_raw, token.decimals, token.decimals)
        .unwrap_or_else(|_| decoded.amount_raw.clone());
    let short = short_address(&decoded.counterparty);
    let summary = if decoded.incoming {
        format!("Received {amount} {} from {short}", token.symbol)
    } else {
        format!("Sent {amount} {} to {short}", token.symbol)
    };
    ActivityEntry {
        account_id: account_id.to_string(),
        amount: Some(amount),
        counterparty: Some(decoded.counterparty.clone()),
        direction: Some(if decoded.incoming {
            TransferDirection::In
        } else {
            TransferDirection::Out
        }),
        failure_notice: None,
        finalized_on_l1: None,
        hash: decoded.hash.clone(),
        kind: ActivityKind::Transfer,
        network,
        not_found_count: None,
        status: TxStatus::Accepted,
        submitted_at: timestamp_ms,
        summary: utf16_slice(&summary, 0, MAX_SUMMARY_LENGTH),
        token: Some(token.symbol.clone()),
        token_address: activity_token_address(&token.address),
    }
}

fn tx_key(entry: &ActivityEntry) -> String {
    format!(
        "{}:{}",
        network_code(entry.network),
        canonical_felt(&entry.hash).unwrap_or_else(|| entry.hash.clone())
    )
}

/// The per-leg key chain rows de-duplicate on (`legKey` without the network prefix).
pub(crate) fn leg_suffix(entry: &ActivityEntry) -> String {
    format!(
        "\u{0}{}\u{0}{}\u{0}{}\u{0}{}",
        entry.token.as_deref().unwrap_or(""),
        entry.token_address.as_deref().unwrap_or(""),
        entry.counterparty.as_deref().unwrap_or(""),
        entry.amount.as_deref().unwrap_or("")
    )
}

fn leg_key(entry: &ActivityEntry) -> String {
    format!("{}{}", tx_key(entry), leg_suffix(entry))
}

/// `mergeActivity`: every row is keyed per leg, local rows included, so a stored multi-leg
/// transaction keeps all its legs (Sherlock 204). A transaction the wallet recorded owns every
/// chain leg with its hash, and a chain leg never changes a local row's status: a reverted
/// transaction still emits its fee `Transfer`, so only the status re-poll settles a row (#653).
/// Newest first.
pub fn merge_activity(local: &[ActivityEntry], on_chain: &[ActivityEntry]) -> Vec<ActivityEntry> {
    let mut by_key: Vec<(String, ActivityEntry)> = Vec::new();
    let mut local_txs: Vec<String> = Vec::new();
    for entry in local {
        let key = leg_key(entry);
        if by_key.iter().any(|(k, _)| *k == key) {
            continue;
        }
        by_key.push((key, entry.clone()));
        local_txs.push(tx_key(entry));
    }
    for entry in on_chain {
        if local_txs.contains(&tx_key(entry)) {
            continue;
        }
        let key = leg_key(entry);
        if !by_key.iter().any(|(k, _)| *k == key) {
            by_key.push((key, entry.clone()));
        }
    }
    let mut merged: Vec<ActivityEntry> = by_key.into_iter().map(|(_, e)| e).collect();
    merged.sort_by_key(|e| std::cmp::Reverse(e.submitted_at));
    merged
}

/// `TRANSFER_EVENT_KEY = hash.getSelectorFromName("Transfer")`; Keccak-checked in the tests.
pub(crate) const TRANSFER_EVENT_KEY: &str =
    "0x99cd8bde557814842a3121e8ddfd433a539b8c9f14bf31ebf108d12e6196e9";

/// `decodeTransferEvent(event, account)`.
pub fn decode_transfer_event(event: &JsValue, account: &str) -> Option<DecodedTransfer> {
    let keys = event.get("keys")?.as_array()?;
    let data = event.get("data")?.as_array()?;
    if !same_felt_value(keys.first(), TRANSFER_EVENT_KEY) {
        return None;
    }
    let indexed = keys.len() >= 3;
    let (raw_from, raw_to) = if indexed {
        (keys.get(1), keys.get(2))
    } else {
        (data.first(), data.get(1))
    };
    let (low, high) = if indexed {
        (data.first(), data.get(1))
    } else {
        (data.get(2), data.get(3))
    };
    let (amount_low, amount_high) = uint256_felts(low, high)?;
    // Audit #163: zero in either direction is planted (`transfer_from` of 0 needs no allowance).
    if amount_low == 0 && amount_high == 0 {
        return None;
    }
    let from = canonical_felt(raw_from?.as_str()?)?;
    let to = canonical_felt(raw_to?.as_str()?)?;
    if !is_stark_field_element(&from) || !is_stark_field_element(&to) {
        return None;
    }
    let hash = canonical_felt(event.get("transaction_hash")?.as_str()?)?;
    let block = event
        .get("block_number")?
        .as_f64()
        .filter(|n| is_safe_integer(*n) && *n >= 0.0)?;
    let incoming = if same_felt(&from, account) {
        false
    } else if same_felt(&to, account) {
        true
    } else {
        return None;
    };
    Some(DecodedTransfer {
        amount_raw: crate::rpc::u256_to_decimal(amount_low, amount_high),
        block_number: block as u64,
        counterparty: if incoming { from } else { to },
        incoming,
        hash,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn planted_rows_are_dropped_or_stripped_as_the_extension_does() {
        let row = |amount: &str, token: &str, summary: &str| ActivityEntry {
            account_id: "SN_MAIN:0x1".into(),
            amount: Some(amount.into()),
            counterparty: Some("0x5".into()),
            direction: None,
            failure_notice: None,
            finalized_on_l1: None,
            hash: "0xabc".into(),
            kind: ActivityKind::Transfer,
            network: NetworkId::Mainnet,
            not_found_count: None,
            status: TxStatus::Accepted,
            submitted_at: 1,
            summary: summary.into(),
            token: Some(token.into()),
            token_address: None,
        };
        for zero in ["0", "0.", "0.000"] {
            assert!(without_planted_rows(vec![row(zero, "STRK", "Received")]).is_empty());
        }
        for kept in ["0.01", "00", "10", "0.0001"] {
            assert_eq!(
                without_planted_rows(vec![row(kept, "STRK", "Received")]).len(),
                1
            );
        }
        assert!(without_planted_rows(vec![row("1", "TOKEN", "Sent 1 TOKEN to 0x5")]).is_empty());
        let incoming = without_planted_rows(vec![row("1", "TOKEN", "Received 1 TOKEN")]);
        assert_eq!(incoming[0].counterparty, None);
        let tracked = without_planted_rows(vec![row("1", "STRK", "Sent 1 STRK to 0x5")]);
        assert_eq!(tracked[0].counterparty.as_deref(), Some("0x5"));
    }

    #[test]
    fn token_addresses_must_be_canonical_field_elements() {
        let above_p = format!("0x{}", "f".repeat(64));
        assert!(!is_recorded_token_address(Some(&above_p), Some("X")));
        assert!(!is_recorded_token_address(Some("0x0"), Some("X")));
        assert!(!is_recorded_token_address(Some("0x07"), Some("X")));
        assert!(!is_recorded_token_address(Some("0x7"), None));
        assert!(is_recorded_token_address(Some("0x7"), Some("X")));
        assert_eq!(activity_token_address("-5"), None);
        assert_eq!(activity_token_address("0x07").as_deref(), Some("0x7"));
    }

    #[test]
    fn transfer_key_is_starknet_keccak() {
        use sha3::{Digest, Keccak256};
        let mut digest: [u8; 32] = Keccak256::digest(b"Transfer").into();
        digest[0] &= 0x03;
        let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(
            format!("0x{}", hex.trim_start_matches('0')),
            TRANSFER_EVENT_KEY
        );
    }
}
