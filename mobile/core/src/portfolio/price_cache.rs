//! The price and chart cache behind `PriceBook`: the stored shapes and validators of the
//! extension's `bramble:prices` / `bramble:charts` (`prices.ts isPriceCache`, `parseChartEntry`),
//! the CoinGecko body judges (`prices-feed.ts parsePriceBody`, `parseChanges`, `parseChartBody`),
//! the `projectPrices` slice, and the `prices.json` document.

use serde_json::{json, Map, Value};

use super::model::DisplayCurrency;
use super::ordered::OrderedMap;
use super::prices::{PricePoint, PriceView};
use super::wire::{HttpMethod, HttpOutcome, HttpRequest, HTTP_DEADLINE_MS, PRICE_BODY_LIMIT};
use crate::js::felt::canonical_address;
use crate::js::json::{self, JsValue};
use crate::js::num::js_trim;

/// `PRICE_CHART_POINT_LIMIT`.
pub const PRICE_CHART_POINT_LIMIT: usize = 2_048;
const MAX_ADDRESSES: usize = 50;

#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct Entry {
    pub(super) usd: f64,
    pub(super) eur: f64,
    pub(super) gbp: f64,
}

impl Entry {
    fn get(self, currency: DisplayCurrency) -> f64 {
        match currency {
            DisplayCurrency::Usd => self.usd,
            DisplayCurrency::Eur => self.eur,
            DisplayCurrency::Gbp => self.gbp,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub(super) struct PriceCache {
    pub(super) attempted: Option<OrderedMap<f64>>,
    pub(super) changes: Option<OrderedMap<f64>>,
    pub(super) checked: Option<Vec<String>>,
    /// The last write; kept for the stored shape only, never for freshness.
    pub(super) fetched_at: f64,
    pub(super) prices: OrderedMap<Entry>,
    /// Per normalized address, when the feed last answered for it (`prices-cache.ts`). An
    /// address absent here has no vouched age and is never fresh, including every address in a
    /// cache written before per-address tracking (mc-wallet #357).
    pub(super) refreshed: Option<OrderedMap<f64>>,
}

#[derive(Debug, Clone)]
pub(super) struct ChartEntry {
    pub(super) attempted_at: Option<f64>,
    pub(super) fetched_at: f64,
    pub(super) points: Vec<f64>,
}

#[derive(Debug, Default)]
pub(super) struct State {
    pub(super) cache: PriceCache,
    pub(super) charts: OrderedMap<ChartEntry>,
}

/// `normalizePriceAddress`: the padded canonical address, or the input trimmed and lowercased.
pub fn normalize_price_address(address: &str) -> String {
    canonical_address(address).unwrap_or_else(|| js_trim(address).to_lowercase())
}

pub(super) fn finite(value: Option<&JsValue>) -> Option<f64> {
    value.and_then(JsValue::as_f64).filter(|v| v.is_finite())
}

pub(super) fn entry_of(value: &JsValue) -> Option<Entry> {
    value.as_object()?;
    Some(Entry {
        usd: finite(value.get("usd"))?,
        eur: finite(value.get("eur"))?,
        gbp: finite(value.get("gbp"))?,
    })
}

pub(super) fn has_only_keys(value: &JsValue, keys: &[&str]) -> bool {
    value
        .as_object()
        .is_some_and(|entries| entries.iter().all(|(k, _)| keys.contains(&k.as_str())))
}

pub(super) fn number_map(value: &JsValue) -> Option<OrderedMap<f64>> {
    let mut map = OrderedMap::default();
    for (key, v) in value.as_object()? {
        map.insert(key.clone(), finite(Some(v))?);
    }
    Some(map)
}

// `isPriceCache`; anything else reads as the empty cache.
pub(super) fn parse_price_cache(value: Option<&JsValue>) -> Option<PriceCache> {
    let value = value?;
    if !has_only_keys(
        value,
        &[
            "attempted",
            "changes",
            "checked",
            "fetchedAt",
            "prices",
            "refreshed",
        ],
    ) {
        return None;
    }
    let optional = |key: &str| value.get(key);
    let attempted = match optional("attempted") {
        None => None,
        Some(v) => Some(number_map(v)?),
    };
    let changes = match optional("changes") {
        None => None,
        Some(v) => Some(number_map(v)?),
    };
    let checked = match optional("checked") {
        None => None,
        Some(v) => Some(
            v.as_array()?
                .iter()
                .map(|item| item.as_str().map(str::to_string))
                .collect::<Option<Vec<_>>>()?,
        ),
    };
    let refreshed = match optional("refreshed") {
        None => None,
        Some(v) => Some(number_map(v)?),
    };
    let mut prices = OrderedMap::default();
    for (key, entry) in value.get("prices")?.as_object()? {
        prices.insert(key.clone(), entry_of(entry)?);
    }
    Some(PriceCache {
        attempted,
        changes,
        checked,
        fetched_at: finite(value.get("fetchedAt"))?,
        prices,
        refreshed,
    })
}

// `withinWindow`: a time not in the future and less than `window_ms` old.
pub(super) fn within_window(at: Option<&f64>, now_ms: f64, window_ms: f64) -> bool {
    at.is_some_and(|at| *at <= now_ms && now_ms - *at < window_ms)
}

/// `pricesFresh`: the feed answered for every wanted address within `ttl_ms`.
pub(super) fn prices_fresh(
    cache: &PriceCache,
    wanted: &[String],
    now_ms: f64,
    ttl_ms: f64,
) -> bool {
    wanted.iter().all(|address| {
        within_window(
            cache.refreshed.as_ref().and_then(|r| r.get(address)),
            now_ms,
            ttl_ms,
        )
    })
}

/// `oldestRefresh`: the capture time to report, the oldest refresh among the wanted addresses
/// that contribute a price (or, when none is priced, among the refreshed ones). `None` when a
/// contributing price has no vouched age.
pub(super) fn oldest_refresh(cache: &PriceCache, wanted: &[String]) -> Option<f64> {
    let refreshed = |address: &String| cache.refreshed.as_ref().and_then(|r| r.get(address));
    let priced: Vec<&String> = wanted
        .iter()
        .filter(|address| cache.prices.get(address).is_some())
        .collect();
    let basis: Vec<&String> = if priced.is_empty() {
        wanted.iter().filter(|a| refreshed(a).is_some()).collect()
    } else {
        priced
    };
    let oldest = basis
        .iter()
        .map(|address| refreshed(address).copied().unwrap_or(0.0))
        .reduce(f64::min)?;
    (oldest > 0.0).then_some(oldest)
}

/// `cacheCovers`: every wanted address is priced or known to be unlisted.
pub(super) fn cache_covers(cache: &PriceCache, wanted: &[String]) -> bool {
    wanted.iter().all(|address| {
        cache.prices.get(address).is_some()
            || cache.checked.as_ref().is_some_and(|c| c.contains(address))
    })
}

// `parseChartEntry`, per entry: an invalid entry is dropped, never the whole cache.
pub(super) fn parse_chart_entry(value: &JsValue) -> Option<ChartEntry> {
    value.as_object()?;
    let attempted_at = match value.get("attemptedAt") {
        None => None,
        Some(v) => Some(finite(Some(v))?),
    };
    let points = value.get("points")?.as_array()?;
    Some(ChartEntry {
        attempted_at,
        fetched_at: finite(value.get("fetchedAt"))?,
        points: points
            .iter()
            .filter_map(|p| finite(Some(p)))
            .take(PRICE_CHART_POINT_LIMIT)
            .collect(),
    })
}

pub(super) fn project(
    addresses: &[String],
    as_of: Option<f64>,
    cache: &PriceCache,
    currency: DisplayCurrency,
    stale: bool,
) -> PriceView {
    let mut prices: OrderedMap<f64> = OrderedMap::default();
    let mut changes: OrderedMap<f64> = OrderedMap::default();
    for address in addresses {
        let key = normalize_price_address(address);
        if let Some(entry) = cache.prices.get(&key) {
            prices.insert(address.clone(), entry.get(currency));
        }
        if let Some(change) = cache.changes.as_ref().and_then(|c| c.get(&key)) {
            changes.insert(address.clone(), *change);
        }
    }
    let points = |map: OrderedMap<f64>| {
        map.into_entries()
            .into_iter()
            .map(|(address, value)| PricePoint { address, value })
            .collect()
    };
    PriceView {
        currency,
        prices: points(prices),
        changes: points(changes),
        as_of_ms: as_of,
        stale,
    }
}

pub(super) fn wanted_addresses(addresses: &[String]) -> Vec<String> {
    let mut wanted: Vec<String> = Vec::new();
    for address in addresses {
        let key = normalize_price_address(address);
        if !wanted.contains(&key) {
            wanted.push(key);
        }
    }
    wanted.truncate(MAX_ADDRESSES);
    wanted
}

/// `encodeURIComponent`.
pub(super) fn encode_uri_component(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            out.push(char::from(byte));
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

pub(super) fn get_request(url: String) -> HttpRequest {
    HttpRequest {
        method: HttpMethod::Get,
        url,
        headers: Vec::new(),
        body: None,
        max_body_bytes: PRICE_BODY_LIMIT,
        deadline_ms: HTTP_DEADLINE_MS,
    }
}

// `readJsonRecord`: a failed exchange is `None`; a JSON body that is not an object reads as `{}`.
pub(super) fn read_record(outcome: &HttpOutcome) -> Option<JsValue> {
    let body = outcome.body.as_ref()?;
    if !(200..300).contains(&outcome.status) || body.len() as u64 > PRICE_BODY_LIMIT {
        return None;
    }
    let value = json::parse(&json::decode_utf8(body))?;
    Some(if value.as_object().is_some() {
        value
    } else {
        JsValue::Object(Vec::new())
    })
}

// `fetchAddressPrices`' parse of one answered body: the requested key only.
pub(super) fn parse_answer(body: &JsValue, address: &str) -> (Option<Entry>, Option<f64>) {
    let key = normalize_price_address(address);
    let (mut price, mut change) = (None, None);
    for (raw, value) in body.as_object().unwrap_or_default() {
        if normalize_price_address(raw) != key {
            continue;
        }
        if value.as_object().is_some() {
            if let Some(c) = finite(value.get("usd_24h_change")) {
                change = Some(c);
            }
            if let Some(e) = entry_of(value) {
                price = Some(e);
            }
        }
    }
    (price, change)
}

/// `parseChartBody` over a judged outcome; `None` when the exchange failed.
pub(super) fn parse_chart(outcome: &HttpOutcome) -> Option<Vec<f64>> {
    let body = read_record(outcome)?;
    Some(match body.get("prices").and_then(JsValue::as_array) {
        None => Vec::new(),
        Some(series) => series
            .iter()
            .take(PRICE_CHART_POINT_LIMIT)
            .filter_map(|pair| finite(pair.as_array().and_then(|p| p.get(1))))
            .collect(),
    })
}

pub(super) fn to_value(value: f64) -> Value {
    serde_json::Number::from_f64(value).map_or(Value::Null, Value::Number)
}

pub(super) fn map_value(map: &OrderedMap<f64>) -> Value {
    Value::Object(
        map.entries()
            .iter()
            .map(|(k, v)| (k.clone(), to_value(*v)))
            .collect::<Map<_, _>>(),
    )
}

/// Fiat prices and charts with their last-known-good cache (`prices.json`).
/// Reads a persisted `prices.json`: an invalid price cache reads as empty, an invalid chart
/// entry is dropped on its own.
pub(super) fn load_state(persisted: Option<String>) -> State {
    let doc = persisted
        .as_deref()
        .and_then(json::parse)
        .filter(|d| d.get("schema").and_then(JsValue::as_str) == Some(super::SCHEMA));
    let cache = parse_price_cache(doc.as_ref().and_then(|d| d.get("prices"))).unwrap_or_default();
    let mut charts = OrderedMap::default();
    if let Some(entries) = doc
        .as_ref()
        .and_then(|d| d.get("charts"))
        .and_then(JsValue::as_object)
    {
        for (key, value) in entries {
            if let Some(entry) = parse_chart_entry(value) {
                charts.insert(key.clone(), entry);
            }
        }
    }
    State { cache, charts }
}

/// The `prices.json` document for a state.
pub(super) fn state_document(state: &State) -> String {
    let cache = &state.cache;
    let mut prices = Map::new();
    for (key, e) in cache.prices.entries() {
        prices.insert(
            key.clone(),
            json!({ "eur": to_value(e.eur), "gbp": to_value(e.gbp), "usd": to_value(e.usd) }),
        );
    }
    let mut price_doc = Map::new();
    if let Some(attempted) = &cache.attempted {
        price_doc.insert("attempted".into(), map_value(attempted));
    }
    if let Some(changes) = &cache.changes {
        price_doc.insert("changes".into(), map_value(changes));
    }
    if let Some(checked) = &cache.checked {
        price_doc.insert("checked".into(), json!(checked));
    }
    price_doc.insert("fetchedAt".into(), to_value(cache.fetched_at));
    price_doc.insert("prices".into(), Value::Object(prices));
    if let Some(refreshed) = &cache.refreshed {
        price_doc.insert("refreshed".into(), map_value(refreshed));
    }
    let mut charts = Map::new();
    for (key, c) in state.charts.entries() {
        let mut entry = Map::new();
        if let Some(at) = c.attempted_at {
            entry.insert("attemptedAt".into(), to_value(at));
        }
        entry.insert("fetchedAt".into(), to_value(c.fetched_at));
        entry.insert(
            "points".into(),
            Value::Array(c.points.iter().map(|p| to_value(*p)).collect()),
        );
        charts.insert(key.clone(), Value::Object(entry));
    }
    json!({ "schema": super::SCHEMA, "prices": Value::Object(price_doc), "charts": Value::Object(charts) }).to_string()
}
