//! Last-known public balances and the header's freshness copy
//! (`wallet_core::portfolio::snapshots`): the UniFFI shapes, the `BalanceSnapshots` object, which
//! holds the core's store behind a lock, and Bramble's balance-failure line.

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use wallet_core::portfolio::snapshots as port;
pub use wallet_core::portfolio::snapshots::{
    BalanceHealth, BalancePlan, BalanceView, NETWORK_ERROR_MESSAGE,
};

use super::model::TokenBalance;
use super::prices::PriceView;
use crate::networks::NetworkId;

/// Saved or loaded balances for one account on one network.
#[uniffi::remote(Record)]
pub struct BalanceView {
    pub balances: Vec<TokenBalance>,
    pub fetched_at_ms: f64,
    pub stale: bool,
}

/// `cachedBalances`' decision.
#[uniffi::remote(Enum)]
pub enum BalancePlan {
    /// Serve these (fresh, or requested cached-only).
    Serve { view: BalanceView },
    /// Read balances from the network, then call `loaded` or `failed`.
    Load,
    /// Cached-only and nothing saved.
    Empty,
}

/// Bounded, validated last-known balances (`snapshots.json`, at most 50 scopes).
#[derive(uniffi::Object)]
pub struct BalanceSnapshots {
    snapshots: Mutex<port::BalanceSnapshots>,
}

impl BalanceSnapshots {
    fn all(&self) -> MutexGuard<'_, port::BalanceSnapshots> {
        self.snapshots
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }
}

#[uniffi::export]
impl BalanceSnapshots {
    /// Loads `snapshots.json`; invalid entries are dropped, an unreadable file reads as empty.
    #[uniffi::constructor]
    pub fn new(persisted: Option<String>) -> Arc<Self> {
        Arc::new(Self {
            snapshots: Mutex::new(port::BalanceSnapshots::new(
                persisted,
                super::PORTFOLIO_POLICY,
            )),
        })
    }

    /// `cachedBalances`: serve a fresh (< 60 s) snapshot unless forced, serve any snapshot when
    /// cached-only, otherwise load.
    pub fn plan(
        &self,
        account_id: String,
        network: NetworkId,
        now_ms: f64,
        cached_only: bool,
        force: bool,
    ) -> BalancePlan {
        self.all()
            .plan(account_id, network, now_ms, cached_only, force)
    }

    /// Records a successful load (when it validates) and returns it as current.
    pub fn loaded(
        &self,
        account_id: String,
        network: NetworkId,
        balances: Vec<TokenBalance>,
        now_ms: f64,
    ) -> BalanceView {
        self.all().loaded(account_id, network, balances, now_ms)
    }

    /// A failed load: the saved balances marked stale, or `None` (the caller shows the error).
    pub fn failed(&self, account_id: String, network: NetworkId) -> Option<BalanceView> {
        self.all().failed(account_id, network)
    }

    /// The `snapshots.json` document (public balances only).
    pub fn persisted(&self) -> String {
        self.all().persisted()
    }

    pub fn clear(&self) {
        self.all().clear();
    }
}

/// The balance state the header and Home render from (`BalanceState`).
#[uniffi::remote(Enum)]
pub enum BalanceHealth {
    Loading,
    Loaded { stale: bool, as_of_ms: Option<f64> },
    Failed,
}

/// `networkDataIssue(...).join(" ")`: the header pill's description, `None` when data is current.
#[uniffi::export]
pub fn network_data_issue(balances: BalanceHealth, prices: Option<PriceView>) -> Option<String> {
    port::network_data_issue(balances, prices)
}

/// The Home balance-error panel's line when a read failed with nothing saved: the friendly
/// network line for a transport failure (what `friendlyNetworkError` makes of the extension's
/// "fetch failed"), else a fixed line (the extension would print the library's raw message,
/// which mobile never surfaces).
#[uniffi::export]
pub fn balance_failure_copy(transport: bool) -> String {
    if transport {
        NETWORK_ERROR_MESSAGE.into()
    } else {
        "Balances could not be read.".into()
    }
}

/// `friendlyNetworkError`: the one friendly line for a transport failure, else `None`.
#[uniffi::export]
pub fn friendly_network_error(raw: String) -> Option<String> {
    port::friendly_network_error(raw)
}
