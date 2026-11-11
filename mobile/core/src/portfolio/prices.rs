//! Fiat prices and 7-day charts (`wallet_core::portfolio::prices`, the extension's
//! `prices-feed.ts` and `prices.ts`): the UniFFI shapes and the `PriceBook` object, which holds
//! the core's book behind a lock. `plan` says whether the host must fetch; `apply` judges what
//! came back and returns the view to render.

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use wallet_core::portfolio::prices as port;
pub use wallet_core::portfolio::prices::{
    ChartPlan, PriceOutcome, PricePlan, PricePoint, PriceRequest, PriceView,
};

use super::model::DisplayCurrency;
use super::wire::{HttpOutcome, HttpRequest};
use crate::networks::NetworkId;
use crate::CoreError;

/// One address's price or 24h change, keyed by the caller's own spelling of the address.
#[uniffi::remote(Record)]
pub struct PricePoint {
    pub address: String,
    pub value: f64,
}

/// `TokenPrices`: the currency slice for the requested addresses. `as_of_ms` is when the snapshot
/// was captured (`None` when nothing is cached, or off mainnet); `stale` marks last-known-good
/// values served because the live feed could not answer.
#[uniffi::remote(Record)]
pub struct PriceView {
    pub currency: DisplayCurrency,
    pub prices: Vec<PricePoint>,
    pub changes: Vec<PricePoint>,
    pub as_of_ms: Option<f64>,
    pub stale: bool,
}

/// One price request, for one normalised address.
#[uniffi::remote(Record)]
pub struct PriceRequest {
    pub address: String,
    pub request: HttpRequest,
}

/// What the host saw for one `PriceRequest`.
#[uniffi::remote(Record)]
pub struct PriceOutcome {
    pub address: String,
    pub outcome: HttpOutcome,
}

/// Whether prices can be served without I/O.
#[uniffi::remote(Enum)]
pub enum PricePlan {
    Serve { view: PriceView },
    Fetch { requests: Vec<PriceRequest> },
}

/// Whether a chart can be served without I/O.
#[uniffi::remote(Enum)]
pub enum ChartPlan {
    Serve { points: Vec<f64> },
    Fetch { request: HttpRequest },
}

#[derive(uniffi::Object)]
pub struct PriceBook {
    state: Mutex<port::PriceBook>,
}

impl PriceBook {
    fn state(&self) -> MutexGuard<'_, port::PriceBook> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[uniffi::export]
impl PriceBook {
    /// Loads a persisted `prices.json`; anything that fails the extension's validators reads as
    /// the empty cache (and is overwritten on the next persist), exactly as the extension does.
    #[uniffi::constructor]
    pub fn new(persisted: Option<String>) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(port::PriceBook::new(persisted, super::PORTFOLIO_POLICY)),
        })
    }

    /// `getPrices`' decision: serve from the cache, or fetch these requests. Off mainnet there is
    /// no fiat by design: the cache only ever holds mainnet prices, and ETH and STRK share their
    /// addresses across networks, so it is never served there (Sherlock 185). Freshness and the
    /// reported capture time are per address, so one token's refresh never vouches for another's
    /// age (mc-wallet #357).
    pub fn plan(
        &self,
        network: NetworkId,
        addresses: Vec<String>,
        currency: DisplayCurrency,
        now_ms: f64,
        cached_only: bool,
    ) -> PricePlan {
        self.state()
            .plan(network, addresses, currency, now_ms, cached_only)
    }

    /// `fetchAndStorePrices`: judges each outcome and merges per `mergeAnsweredPrices`. Only the
    /// addresses that answered get a refresh time, so a failed leg keeps its old age; an address
    /// that answered without a usable price loses its cached price and change, so the refresh
    /// time never vouches for a price the feed no longer stands behind.
    pub fn apply(
        &self,
        network: NetworkId,
        addresses: Vec<String>,
        currency: DisplayCurrency,
        outcomes: Vec<PriceOutcome>,
        attempted_at_ms: f64,
    ) -> PriceView {
        self.state()
            .apply(network, addresses, currency, outcomes, attempted_at_ms)
    }

    /// `getTokenChart`'s decision for a token's 7-day series (address must be a non-zero felt).
    pub fn chart_plan(
        &self,
        network: NetworkId,
        address: String,
        currency: DisplayCurrency,
        now_ms: f64,
    ) -> Result<ChartPlan, CoreError> {
        Ok(self
            .state()
            .chart_plan(network, address, currency, now_ms)?)
    }

    /// Judges a chart response; a failure or an empty series keeps the cached one.
    pub fn chart_apply(
        &self,
        address: String,
        currency: DisplayCurrency,
        outcome: HttpOutcome,
        now_ms: f64,
    ) -> Vec<f64> {
        self.state().chart_apply(address, currency, outcome, now_ms)
    }

    /// The `prices.json` document the host writes verbatim; public prices only.
    pub fn persisted(&self) -> String {
        self.state().persisted()
    }

    /// Forgets every cached price and chart.
    pub fn clear(&self) {
        self.state().clear();
    }
}
