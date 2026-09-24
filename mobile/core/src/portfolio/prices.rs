//! Fiat prices and 7-day charts: the extension's `prices-feed.ts` (CoinGecko request URLs and the
//! response judges) and `prices.ts` (the last-known-good cache, its TTL, back-off and stale
//! rules), as a sans-IO state machine. `plan` says whether the host must fetch; `apply` judges
//! what came back and returns the view to render. Price bodies are untrusted: size-bounded,
//! finite numbers only, all three currencies or nothing, and only the requested key is read.

use std::sync::Mutex;

use super::model::DisplayCurrency;
use super::ordered::OrderedMap;
pub use super::price_cache::normalize_price_address;
use super::price_cache::{
    encode_uri_component, get_request, load_state, parse_answer, parse_chart, project, read_record,
    snapshot_as_of, state_document, wanted_addresses, ChartEntry, Entry, PriceCache, State,
};
use super::wire::{HttpOutcome, HttpRequest};
use crate::networks::NetworkId;
use crate::CoreError;

const COINGECKO_BASE: &str = "https://api.coingecko.com/api/v3";
const CHART_DAYS: u32 = 7;
pub use super::price_cache::PRICE_CHART_POINT_LIMIT;
const PRICE_TTL_MS: f64 = 5.0 * 60.0 * 1000.0;
const PRICE_RETRY_BACKOFF_MS: f64 = 60_000.0;
const CHART_TTL_MS: f64 = 30.0 * 60.0 * 1000.0;
const MAX_CHART_ENTRIES: usize = 50;

/// One address's price or 24h change, keyed by the caller's own spelling of the address.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct PricePoint {
    pub address: String,
    pub value: f64,
}

/// `TokenPrices`: the currency slice for the requested addresses. `as_of_ms` is when the snapshot
/// was captured (`None` when nothing is cached, or off mainnet); `stale` marks last-known-good
/// values served because the live feed could not answer.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct PriceView {
    pub currency: DisplayCurrency,
    pub prices: Vec<PricePoint>,
    pub changes: Vec<PricePoint>,
    pub as_of_ms: Option<f64>,
    pub stale: bool,
}

impl PriceView {
    /// `prices[address]`.
    pub fn price(&self, address: &str) -> Option<f64> {
        self.prices
            .iter()
            .find(|p| p.address == address)
            .map(|p| p.value)
    }

    /// `changes[address]`.
    pub fn change(&self, address: &str) -> Option<f64> {
        self.changes
            .iter()
            .find(|p| p.address == address)
            .map(|p| p.value)
    }
}

/// One price request, for one normalised address.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct PriceRequest {
    pub address: String,
    pub request: HttpRequest,
}

/// What the host saw for one `PriceRequest`.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct PriceOutcome {
    pub address: String,
    pub outcome: HttpOutcome,
}

/// Whether prices can be served without I/O.
#[derive(Debug, Clone, PartialEq, uniffi::Enum)]
pub enum PricePlan {
    Serve { view: PriceView },
    Fetch { requests: Vec<PriceRequest> },
}

/// Whether a chart can be served without I/O.
#[derive(Debug, Clone, PartialEq, uniffi::Enum)]
pub enum ChartPlan {
    Serve { points: Vec<f64> },
    Fetch { request: HttpRequest },
}

#[derive(uniffi::Object)]
pub struct PriceBook {
    state: Mutex<State>,
}

impl PriceBook {
    fn state(&self) -> std::sync::MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

#[uniffi::export]
impl PriceBook {
    /// Loads a persisted `prices.json`; anything that fails the extension's validators reads as
    /// the empty cache (and is overwritten on the next persist), exactly as the extension does.
    #[uniffi::constructor]
    pub fn new(persisted: Option<String>) -> std::sync::Arc<Self> {
        std::sync::Arc::new(Self {
            state: Mutex::new(load_state(persisted)),
        })
    }

    /// `getPrices`' decision: serve from the cache, or fetch these requests. Off mainnet the
    /// cached projection is always served (never stale, never fetched), as the extension does.
    pub fn plan(
        &self,
        network: NetworkId,
        addresses: Vec<String>,
        currency: DisplayCurrency,
        now_ms: f64,
        cached_only: bool,
    ) -> PricePlan {
        let state = self.state();
        let cache = &state.cache;
        let wanted = wanted_addresses(&addresses);
        if network != NetworkId::Mainnet || wanted.is_empty() {
            return PricePlan::Serve {
                view: project(&addresses, None, cache, currency, false),
            };
        }
        let fresh = now_ms - cache.fetched_at < PRICE_TTL_MS;
        let as_of = snapshot_as_of(cache.fetched_at);
        if cached_only {
            return PricePlan::Serve {
                view: project(&addresses, as_of, cache, currency, !fresh),
            };
        }
        let covers = wanted.iter().all(|a| {
            cache.prices.get(a).is_some() || cache.checked.as_ref().is_some_and(|c| c.contains(a))
        });
        if fresh && covers {
            return PricePlan::Serve {
                view: project(&addresses, as_of, cache, currency, false),
            };
        }
        let backing_off = wanted.iter().all(|a| {
            cache
                .attempted
                .as_ref()
                .and_then(|m| m.get(a))
                .is_some_and(|at| *at <= now_ms && now_ms - *at < PRICE_RETRY_BACKOFF_MS)
        });
        if backing_off {
            return PricePlan::Serve {
                view: project(&addresses, as_of, cache, currency, true),
            };
        }
        PricePlan::Fetch {
            requests: wanted
                .into_iter()
                .map(|address| PriceRequest {
                    request: get_request(format!(
                        "{COINGECKO_BASE}/simple/token_price/starknet?contract_addresses={}&vs_currencies=usd,eur,gbp&include_24hr_change=true",
                        encode_uri_component(&address)
                    )),
                    address,
                })
                .collect(),
        }
    }

    /// `fetchAndStorePrices`: judges each outcome and merges per the fetchedAt/asOf/stale rules.
    pub fn apply(
        &self,
        network: NetworkId,
        addresses: Vec<String>,
        currency: DisplayCurrency,
        outcomes: Vec<PriceOutcome>,
        attempted_at_ms: f64,
    ) -> PriceView {
        let mut state = self.state();
        let wanted = wanted_addresses(&addresses);
        if network != NetworkId::Mainnet || wanted.is_empty() {
            return project(&addresses, None, &state.cache, currency, false);
        }
        let previous = state.cache.clone();
        let mut attempted = previous.attempted.clone().unwrap_or_default();
        for address in &wanted {
            attempted.insert(address.clone(), attempted_at_ms);
        }
        let mut answered: Vec<(String, Option<Entry>, Option<f64>)> = Vec::new();
        for address in &wanted {
            let body = outcomes
                .iter()
                .find(|o| &o.address == address)
                .and_then(|o| read_record(&o.outcome));
            if let Some(body) = body {
                let (price, change) = parse_answer(&body, address);
                answered.push((address.clone(), price, change));
            }
        }
        if answered.is_empty() {
            state.cache.attempted = Some(attempted);
            return project(
                &addresses,
                snapshot_as_of(previous.fetched_at),
                &state.cache,
                currency,
                true,
            );
        }
        let mut checked = previous.checked.clone().unwrap_or_default();
        let mut changes = previous.changes.clone().unwrap_or_default();
        let mut prices = previous.prices.clone();
        for (address, price, change) in &answered {
            if !checked.contains(address) {
                checked.push(address.clone());
            }
            if let Some(change) = change {
                changes.insert(address.clone(), *change);
            }
            if let Some(price) = price {
                prices.insert(address.clone(), *price);
            }
        }
        state.cache = PriceCache {
            attempted: Some(attempted),
            changes: Some(changes),
            checked: Some(checked),
            fetched_at: attempted_at_ms,
            prices,
        };
        let unanswered: Vec<&String> = wanted
            .iter()
            .filter(|a| !answered.iter().any(|(b, _, _)| b == *a))
            .collect();
        if unanswered.is_empty() {
            return project(
                &addresses,
                Some(attempted_at_ms),
                &state.cache,
                currency,
                false,
            );
        }
        let serves_cached = unanswered
            .iter()
            .any(|a| state.cache.prices.get(a).is_some());
        let as_of = if serves_cached {
            snapshot_as_of(previous.fetched_at)
        } else {
            Some(attempted_at_ms)
        };
        project(&addresses, as_of, &state.cache, currency, true)
    }

    /// `getTokenChart`'s decision for a token's 7-day series (address must be a non-zero felt).
    pub fn chart_plan(
        &self,
        network: NetworkId,
        address: String,
        currency: DisplayCurrency,
        now_ms: f64,
    ) -> Result<ChartPlan, CoreError> {
        if crate::felt::parse_non_zero(&address).is_none() {
            return Err(CoreError::InvalidInput {
                reason: "token address is not a field element".into(),
            });
        }
        let state = self.state();
        let key = format!("{}:{}", normalize_price_address(&address), currency.code());
        let cached = state.charts.get(&key);
        if network != NetworkId::Mainnet {
            return Ok(ChartPlan::Serve {
                points: cached.map(|c| c.points.clone()).unwrap_or_default(),
            });
        }
        if let Some(cached) = cached {
            let fresh = cached.fetched_at > 0.0 && now_ms - cached.fetched_at < CHART_TTL_MS;
            let backing_off = cached
                .attempted_at
                .is_some_and(|at| at <= now_ms && now_ms - at < PRICE_RETRY_BACKOFF_MS);
            if fresh || backing_off {
                return Ok(ChartPlan::Serve {
                    points: cached.points.clone(),
                });
            }
        }
        Ok(ChartPlan::Fetch {
            request: get_request(format!(
                "{COINGECKO_BASE}/coins/starknet/contract/{}/market_chart?vs_currency={}&days={CHART_DAYS}",
                normalize_price_address(&address),
                currency.code()
            )),
        })
    }

    /// Judges a chart response; a failure or an empty series keeps the cached one.
    pub fn chart_apply(
        &self,
        address: String,
        currency: DisplayCurrency,
        outcome: HttpOutcome,
        now_ms: f64,
    ) -> Vec<f64> {
        let mut state = self.state();
        let key = format!("{}:{}", normalize_price_address(&address), currency.code());
        let cached = state.charts.get(&key).cloned();
        let entry = match parse_chart(&outcome).filter(|points| !points.is_empty()) {
            Some(points) => ChartEntry {
                attempted_at: Some(now_ms),
                fetched_at: now_ms,
                points,
            },
            None => ChartEntry {
                attempted_at: Some(now_ms),
                fetched_at: cached.as_ref().map_or(0.0, |c| c.fetched_at),
                points: cached.map(|c| c.points).unwrap_or_default(),
            },
        };
        let points = entry.points.clone();
        state.charts.insert(key, entry);
        if state.charts.len() > MAX_CHART_ENTRIES {
            let mut entries = std::mem::take(&mut state.charts).into_entries();
            entries.sort_by(|a, b| {
                b.1.fetched_at
                    .partial_cmp(&a.1.fetched_at)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            entries.truncate(MAX_CHART_ENTRIES);
            state.charts = OrderedMap::from_entries(entries);
        }
        points
    }

    /// The `prices.json` document the host writes verbatim; public prices only.
    pub fn persisted(&self) -> String {
        state_document(&self.state())
    }

    /// Forgets every cached price and chart.
    pub fn clear(&self) {
        *self.state() = State::default();
    }
}
