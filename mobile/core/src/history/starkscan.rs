//! The Starkscan read lane for activity, ported from `history/starkscan.ts` (request shape,
//! outcome classification, `explorerCooldownMilliseconds`), `starkscan-parsers.ts` (the strict
//! page and transfer parsers), `starkscan-wallet.ts` (`toActivity`,
//! `getStarkscanTransactionHistory`) and `core/http-json.ts` (`parseRetryAfterMilliseconds`).
//! Every field is bounded and grammar-checked; one bad row fails the page, and a failed page
//! only ever falls through to the RPC scan.

use super::activity::{is_activity_entry, on_chain_activity_entry, ActivityEntry, DecodedTransfer};
use super::explorer::account_id_address;
use super::time::parse_iso_timestamp;
use crate::js::felt::{canonical_felt, is_stark_field_element, same_felt};
use crate::js::json::{self, JsValue};
use crate::js::num::{is_safe_integer, js_trim, string_to_number, utf16_len};
use crate::networks::NetworkId;
use crate::portfolio::model::{network_code, TokenConfig};
use crate::portfolio::wire::{
    HttpHeader, HttpMethod, HttpOutcome, HttpRequest, STARKSCAN_BODY_LIMIT, STARKSCAN_DEADLINE_MS,
};

const STARKSCAN_API_BASE: &str = "https://starkscan.co/v1";
const DEFAULT_COOLDOWN_MS: f64 = 30_000.0;
const MAX_COOLDOWN_MS: f64 = 5.0 * 60_000.0;
const MAX_PAGE_LIMIT: usize = 200;
/// `MAX_HISTORY_ENTRIES`: rows one history read contributes.
pub(crate) const MAX_HISTORY_ENTRIES: usize = 25;

/// `GET {base}/{chainId}/transfers?limit=25&address=0x…` with `accept: application/json`; no API
/// key exists, so no key header is ever sent.
pub(crate) fn transfers_request(network: NetworkId, account_id: &str) -> HttpRequest {
    let address = canonical_felt(account_id_address(account_id)).unwrap_or_default();
    HttpRequest {
        method: HttpMethod::Get,
        url: format!(
            "{STARKSCAN_API_BASE}/{}/transfers?limit={MAX_HISTORY_ENTRIES}&address={address}",
            network_code(network)
        ),
        headers: vec![HttpHeader {
            name: "accept".into(),
            value: "application/json".into(),
        }],
        body: None,
        max_body_bytes: STARKSCAN_BODY_LIMIT,
        deadline_ms: STARKSCAN_DEADLINE_MS,
    }
}

/// `parseRetryAfterMilliseconds`. HTTP dates are read in the IMF-fixdate form only
/// (`Sun, 06 Nov 1994 08:49:37 GMT`); any other date spelling reads as absent (the 30 s default).
pub fn parse_retry_after_ms(value: Option<&str>, now_ms: f64) -> Option<f64> {
    let normalized = js_trim(value?);
    if normalized.is_empty() {
        return None;
    }
    let bytes = normalized.as_bytes();
    if bytes.iter().all(u8::is_ascii_digit) && (bytes.len() == 1 || bytes[0] != b'0') {
        let ms = normalized.parse::<f64>().ok()? * 1000.0;
        return is_safe_integer(ms).then_some(ms);
    }
    if string_to_number(normalized).is_finite() || !now_ms.is_finite() {
        return None;
    }
    parse_imf_fixdate(normalized).map(|at| (at - now_ms).max(0.0))
}

fn parse_imf_fixdate(text: &str) -> Option<f64> {
    const DAYS: [&str; 7] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let parts: Vec<&str> = text.split(' ').collect();
    let [weekday, day, month, year, clock, "GMT"] = parts.as_slice() else {
        return None;
    };
    let weekday = weekday.strip_suffix(',')?;
    if !DAYS.contains(&weekday) || day.len() != 2 || year.len() != 4 {
        return None;
    }
    let month = MONTHS.iter().position(|m| m == month)? + 1;
    parse_iso_timestamp(&format!("{year}-{month:02}-{day}T{clock}Z"))
}

/// Whether a failed exchange starts the explorer cooldown, and for how long
/// (`explorerOutcome` + `explorerCooldownMilliseconds`): 429, any 5xx, a status below 400 that
/// is not a valid 2xx page, a timeout, or a transport failure. Any other 4xx starts none.
pub fn cooldown_ms(outcome: &HttpOutcome, now_ms: f64) -> Option<f64> {
    let status = outcome.status;
    let answered_error = status != 0 && !(200..300).contains(&status);
    let cools = status == 429 || !(400..500).contains(&status);
    cools.then(|| {
        let retry_after = if answered_error {
            outcome.retry_after.as_deref()
        } else {
            None
        };
        parse_retry_after_ms(retry_after, now_ms)
            .unwrap_or(DEFAULT_COOLDOWN_MS)
            .min(MAX_COOLDOWN_MS)
    })
}

/// A validated Starkscan transfer (the fields `toActivity` reads).
#[derive(Debug, Clone)]
struct Transfer {
    timestamp_iso: String,
    tx_hash: String,
    token_address: String,
    from_address: String,
    to_address: String,
    amount: Option<String>,
    raw_value: String,
    erc20: bool,
    token_decimals: Option<f64>,
}

fn string_value(value: Option<&JsValue>, max: usize) -> Option<String> {
    let text = value?.as_str()?;
    (utf16_len(text) <= max).then(|| text.to_string())
}

fn nullable_string(value: Option<&JsValue>, max: usize) -> Option<Option<String>> {
    match value? {
        JsValue::Null => Some(None),
        other => string_value(Some(other), max).map(Some),
    }
}

fn integer_value(value: Option<&JsValue>) -> Option<f64> {
    let n = value?.as_f64()?;
    (is_safe_integer(n) && n >= 0.0).then_some(if n == 0.0 { 0.0 } else { n })
}

fn nullable_integer(value: Option<&JsValue>) -> Option<Option<f64>> {
    match value? {
        JsValue::Null => Some(None),
        other => integer_value(Some(other)).map(Some),
    }
}

fn decimal_value(value: Option<&JsValue>) -> Option<String> {
    let text = string_value(value, 256)?;
    let b = text.as_bytes();
    let ok = !b.is_empty()
        && b.len() <= 78
        && b.iter().all(u8::is_ascii_digit)
        && (b.len() == 1 || b[0] != b'0');
    ok.then_some(text)
}

fn nullable_decimal(value: Option<&JsValue>) -> Option<Option<String>> {
    match value? {
        JsValue::Null => Some(None),
        other => decimal_value(Some(other)).map(Some),
    }
}

fn felt_value(value: Option<&JsValue>) -> Option<String> {
    let text = string_value(value, 68)?;
    canonical_felt(&text).filter(|c| is_stark_field_element(c))?;
    Some(text)
}

// `parseStarkscanTransfer`: every consumed field present and within its bound.
fn parse_transfer(row: &JsValue) -> Option<Transfer> {
    row.as_object()?;
    let standard = string_value(row.get("standard"), 16)?;
    let source_tier = string_value(row.get("sourceTier"), 16)?;
    if !["erc20", "erc721", "erc1155"].contains(&standard.as_str())
        || !["finalized", "head"].contains(&source_tier.as_str())
    {
        return None;
    }
    for key in ["blockNumber", "txIndex", "logIndex", "transferIndex"] {
        integer_value(row.get(key))?;
    }
    nullable_decimal(row.get("tokenId"))?;
    nullable_string(row.get("tokenSymbol"), 64)?;
    nullable_string(row.get("tokenName"), 128)?;
    nullable_string(row.get("actionContext"), 128)?;
    Some(Transfer {
        timestamp_iso: string_value(row.get("timestampIso"), 512)?,
        tx_hash: felt_value(row.get("txHash"))?,
        token_address: felt_value(row.get("tokenAddress"))?,
        from_address: felt_value(row.get("fromAddress"))?,
        to_address: felt_value(row.get("toAddress"))?,
        amount: nullable_decimal(row.get("amount"))?,
        raw_value: decimal_value(row.get("rawValue"))?,
        erc20: standard == "erc20",
        token_decimals: nullable_integer(row.get("tokenDecimals"))?,
    })
}

// `parseStarkscanPage(value, parseStarkscanTransfer)`.
fn parse_page(value: &JsValue) -> Option<Vec<Transfer>> {
    value.as_object()?;
    let items = value.get("items")?.as_array()?;
    if items.len() > MAX_PAGE_LIMIT {
        return None;
    }
    let transfers = items
        .iter()
        .map(parse_transfer)
        .collect::<Option<Vec<_>>>()?;
    nullable_string(value.get("nextCursor"), 2_048)?;
    Some(transfers)
}

// `matchingToken`: the tracked token, or a synthetic "Untracked token" with safe decimals.
fn matching_token(
    tokens: &[TokenConfig],
    transfer: &Transfer,
    network: NetworkId,
) -> Option<TokenConfig> {
    if let Some(token) = tokens
        .iter()
        .find(|t| same_felt(&t.address, &transfer.token_address))
    {
        return Some(token.clone());
    }
    let decimals = transfer.token_decimals.filter(|d| *d <= 36.0)?;
    let address =
        canonical_felt(&transfer.token_address).unwrap_or_else(|| transfer.token_address.clone());
    Some(TokenConfig {
        id: format!("starkscan:{}:{address}", network_code(network)),
        network,
        address,
        symbol: "TOKEN".into(),
        name: "Untracked token".into(),
        decimals: decimals as u8,
    })
}

fn to_activity(
    transfer: &Transfer,
    account_id: &str,
    network: NetworkId,
    tokens: &[TokenConfig],
) -> Option<ActivityEntry> {
    if !transfer.erc20 {
        return None;
    }
    let token = matching_token(tokens, transfer, network)?;
    let account = account_id_address(account_id);
    let (counterparty, incoming) = if same_felt(&transfer.from_address, account) {
        (&transfer.to_address, false)
    } else if same_felt(&transfer.to_address, account) {
        (&transfer.from_address, true)
    } else {
        return None;
    };
    let timestamp = parse_iso_timestamp(&transfer.timestamp_iso)
        .filter(|t| is_safe_integer(*t) && *t >= 0.0)?;
    let decoded = DecodedTransfer {
        amount_raw: transfer
            .amount
            .clone()
            .unwrap_or_else(|| transfer.raw_value.clone()),
        block_number: 0,
        counterparty: canonical_felt(counterparty).unwrap_or_else(|| counterparty.clone()),
        incoming,
        hash: canonical_felt(&transfer.tx_hash).unwrap_or_else(|| transfer.tx_hash.clone()),
    };
    let entry = on_chain_activity_entry(account_id, &decoded, network, timestamp as u64, &token);
    is_activity_entry(&entry).then_some(entry)
}

/// Judges a transfers page into activity rows (`getStarkscanTransactionHistory`); `None` when
/// the exchange or the body failed (the caller then applies `cooldown_ms` and runs the RPC scan).
pub fn transfers_to_activity(
    outcome: &HttpOutcome,
    account_id: &str,
    network: NetworkId,
    tokens: &[TokenConfig],
) -> Option<Vec<ActivityEntry>> {
    let body = outcome.body.as_ref()?;
    if !(200..300).contains(&outcome.status) || body.len() as u64 > STARKSCAN_BODY_LIMIT {
        return None;
    }
    let page = parse_page(&json::parse(&json::decode_utf8(body))?)?;
    let mut rows: Vec<ActivityEntry> = Vec::new();
    for entry in page
        .iter()
        .filter_map(|t| to_activity(t, account_id, network, tokens))
    {
        let key = |e: &ActivityEntry| {
            (
                e.hash.clone(),
                e.token.clone(),
                e.counterparty.clone(),
                e.amount.clone(),
            )
        };
        if !rows.iter().any(|r| key(r) == key(&entry)) {
            rows.push(entry);
        }
    }
    rows.sort_by_key(|e| std::cmp::Reverse(e.submitted_at));
    rows.truncate(MAX_HISTORY_ENTRIES);
    Some(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn outcome(status: u16, body: Option<&str>) -> HttpOutcome {
        HttpOutcome {
            status,
            retry_after: None,
            body: body.map(|b| b.as_bytes().to_vec()),
            timed_out: false,
        }
    }

    #[test]
    fn cooldown_follows_the_extension() {
        assert_eq!(cooldown_ms(&outcome(429, Some("{}")), 0.0), Some(30_000.0));
        assert_eq!(cooldown_ms(&outcome(503, Some("")), 0.0), Some(30_000.0));
        assert_eq!(cooldown_ms(&outcome(404, Some("{}")), 0.0), None);
        assert_eq!(cooldown_ms(&outcome(0, None), 0.0), Some(30_000.0));
        let mut limited = outcome(429, Some("{}"));
        limited.retry_after = Some("900".into());
        assert_eq!(cooldown_ms(&limited, 0.0), Some(300_000.0));
    }

    #[test]
    fn retry_after_forms() {
        assert_eq!(parse_retry_after_ms(Some(" 12 "), 0.0), Some(12_000.0));
        assert_eq!(parse_retry_after_ms(Some("1.5"), 0.0), None);
        assert_eq!(parse_retry_after_ms(Some("012"), 0.0), None);
        let date = parse_retry_after_ms(Some("Thu, 01 Jan 1970 00:01:00 GMT"), 30_000.0);
        assert_eq!(date, Some(30_000.0));
    }
}
