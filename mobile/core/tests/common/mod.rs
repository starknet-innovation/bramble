//! Readers for `fixtures/portfolio-parity.jsonl`, which the extension's own TypeScript writes
//! (`scripts/mobile-parity-portfolio`). The fixture is read with the core's JavaScript-faithful
//! JSON reader so every expected number is exactly the double JavaScript produced.
#![allow(dead_code)]

use bramble_core::portfolio_testing::{parse_json, JsValue};
use bramble_core::{DisplayCurrency, HttpOutcome, NetworkId, PricePoint, PriceView, TokenConfig};

/// The fixture's JSON Lines (`{"block","value"}` per line) assembled into one object.
pub fn fixture() -> JsValue {
    let blocks = include_str!("../fixtures/portfolio-parity.jsonl")
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| {
            let record = parse_json(line).expect("fixture line parses");
            (text(&record, "block"), at(&record, "value").clone())
        })
        .collect();
    JsValue::Object(blocks)
}

pub fn at<'a>(value: &'a JsValue, key: &str) -> &'a JsValue {
    value
        .get(key)
        .unwrap_or_else(|| panic!("fixture has {key}"))
}

pub fn list<'a>(value: &'a JsValue, key: &str) -> &'a [JsValue] {
    at(value, key)
        .as_array()
        .unwrap_or_else(|| panic!("{key} is a list"))
}

pub fn text(value: &JsValue, key: &str) -> String {
    at(value, key)
        .as_str()
        .unwrap_or_else(|| panic!("{key} is text"))
        .to_string()
}

pub fn opt_text(value: &JsValue, key: &str) -> Option<String> {
    value.get(key).and_then(JsValue::as_str).map(str::to_string)
}

pub fn num(value: &JsValue, key: &str) -> f64 {
    at(value, key)
        .as_f64()
        .unwrap_or_else(|| panic!("{key} is a number"))
}

pub fn opt_num(value: &JsValue, key: &str) -> Option<f64> {
    value.get(key).and_then(JsValue::as_f64)
}

/// Sorts object keys recursively so documents compare by content, not key order.
pub fn canon(value: &JsValue) -> JsValue {
    match value {
        JsValue::Object(entries) => {
            let mut sorted: Vec<(String, JsValue)> =
                entries.iter().map(|(k, v)| (k.clone(), canon(v))).collect();
            sorted.sort_by(|a, b| a.0.cmp(&b.0));
            JsValue::Object(sorted)
        }
        JsValue::Array(items) => JsValue::Array(items.iter().map(canon).collect()),
        other => other.clone(),
    }
}

pub fn currency(code: &str) -> DisplayCurrency {
    match code {
        "usd" => DisplayCurrency::Usd,
        "eur" => DisplayCurrency::Eur,
        "gbp" => DisplayCurrency::Gbp,
        other => panic!("currency {other}"),
    }
}

pub fn network(code: &str) -> NetworkId {
    match code {
        "SN_MAIN" => NetworkId::Mainnet,
        "SN_SEPOLIA" => NetworkId::Sepolia,
        other => panic!("network {other}"),
    }
}

/// What a host that honours `max_body_bytes` reports for a scripted answer.
pub fn outcome(answer: &JsValue, pad: usize, max_body_bytes: u64) -> HttpOutcome {
    match answer {
        JsValue::Null => HttpOutcome {
            status: 0,
            retry_after: None,
            body: None,
            timed_out: false,
        },
        answer => {
            let body = format!("{}{}", text(answer, "body"), " ".repeat(pad));
            let status = num(answer, "status") as u16;
            let body = (body.len() as u64 <= max_body_bytes).then(|| body.into_bytes());
            HttpOutcome {
                status,
                retry_after: None,
                body,
                timed_out: false,
            }
        }
    }
}

pub fn points(map: &JsValue) -> Vec<PricePoint> {
    map.as_object()
        .unwrap_or_default()
        .iter()
        .map(|(address, value)| PricePoint {
            address: address.clone(),
            value: value.as_f64().expect("price"),
        })
        .collect()
}

pub fn price_view(code: &str, prices: &JsValue, changes: &JsValue) -> PriceView {
    PriceView {
        currency: currency(code),
        prices: points(prices),
        changes: points(changes),
        as_of_ms: None,
        stale: false,
    }
}

/// A token config read without validation (the fixture holds invalid ones on purpose).
pub fn token(value: &JsValue) -> TokenConfig {
    TokenConfig {
        id: text(value, "id"),
        network: network(&text(value, "networkId")),
        address: text(value, "address"),
        symbol: text(value, "symbol"),
        name: text(value, "name"),
        decimals: num(value, "decimals") as u8,
    }
}

/// Compares a price view with `{asOf, stale, prices, changes}` as `getPrices` returned them.
pub fn assert_view(view: &PriceView, expected: &JsValue, context: &str) {
    assert_eq!(view.as_of_ms, opt_num(expected, "asOf"), "{context}: asOf");
    assert_eq!(
        view.stale,
        at(expected, "stale") == &JsValue::Bool(true),
        "{context}: stale"
    );
    assert_eq!(
        view.prices,
        points(at(expected, "prices")),
        "{context}: prices"
    );
    assert_eq!(
        view.changes,
        points(at(expected, "changes")),
        "{context}: changes"
    );
}
