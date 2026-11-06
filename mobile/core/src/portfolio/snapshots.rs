//! Last-known public balances (`background/portfolio/balance-snapshots.ts`) and the header's
//! freshness copy (`shared/network-status.ts`, `core/network-error.ts`). A failed live refresh
//! marks the saved balances stale; it never blanks them and never invents a value.

use std::sync::Mutex;

use serde_json::{json, Value};

use super::model::{network_code, network_from_code, TokenBalance, TokenConfig};
use super::prices::PriceView;
use super::tokens::is_token_config;
use crate::history::explorer::is_account_id_for_network;
use crate::history::time::format_saved_data_label;
use crate::js::json::{self, JsValue};
use crate::js::num::is_safe_integer;
use crate::networks::NetworkId;

const MAX_SCOPES: usize = 50;
const BALANCE_SNAPSHOT_TTL_MS: f64 = 60_000.0;

/// `NETWORK_ERROR_MESSAGE`.
const NETWORK_ERROR_MESSAGE: &str =
    "Couldn't reach the network. Check your connection or RPC endpoint.";
const NETWORK_FAILURE_MARKERS: &[&str] = &[
    "failed to fetch",
    "fetch failed",
    "network request failed",
    "networkerror",
    "load failed",
    "err_network",
    "err_internet_disconnected",
    "err_name_not_resolved",
    "econnrefused",
    "enotfound",
    "etimedout",
    "timed out",
    "network timeout",
    "socket hang up",
];

/// Saved or loaded balances for one account on one network.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct BalanceView {
    pub balances: Vec<TokenBalance>,
    pub fetched_at_ms: f64,
    pub stale: bool,
}

/// `cachedBalances`' decision.
#[derive(Debug, Clone, PartialEq, uniffi::Enum)]
pub enum BalancePlan {
    /// Serve these (fresh, or requested cached-only).
    Serve { view: BalanceView },
    /// Read balances from the network, then call `loaded` or `failed`.
    Load,
    /// Cached-only and nothing saved.
    Empty,
}

#[derive(Debug, Clone)]
struct Snapshot {
    account_id: String,
    network: NetworkId,
    balances: Vec<TokenBalance>,
    fetched_at: f64,
}

/// `isTokenBalance`.
pub fn is_token_balance(balance: &TokenBalance) -> bool {
    let digits = &balance.balance;
    let base_units = !digits.is_empty()
        && digits.len() <= 78
        && digits.bytes().all(|b| b.is_ascii_digit())
        && (digits == "0" || !digits.starts_with('0'));
    base_units && !balance.formatted.is_empty() && is_token_config(&balance.token)
}

fn is_snapshot(snapshot: &Snapshot) -> bool {
    is_account_id_for_network(&snapshot.account_id, snapshot.network)
        && is_safe_integer(snapshot.fetched_at)
        && snapshot.fetched_at >= 0.0
        && snapshot
            .balances
            .iter()
            .all(|b| is_token_balance(b) && b.token.network == snapshot.network)
        && snapshot.balances.iter().enumerate().all(|(i, b)| {
            !snapshot.balances[..i]
                .iter()
                .any(|o| o.token.id == b.token.id)
        })
}

pub fn balance_from_json(value: &JsValue) -> Option<TokenBalance> {
    let keys = [
        "address",
        "balance",
        "decimals",
        "formatted",
        "id",
        "name",
        "networkId",
        "symbol",
    ];
    if !value
        .as_object()?
        .iter()
        .all(|(k, _)| keys.contains(&k.as_str()))
    {
        return None;
    }
    let decimals = value.get("decimals")?.as_f64()?;
    if decimals.fract() != 0.0 || !(0.0..=36.0).contains(&decimals) {
        return None;
    }
    let s = |key: &str| value.get(key).and_then(JsValue::as_str).map(str::to_string);
    Some(TokenBalance {
        token: TokenConfig {
            id: s("id")?,
            network: network_from_code(value.get("networkId")?.as_str()?)?,
            address: s("address")?,
            symbol: s("symbol")?,
            name: s("name")?,
            decimals: decimals as u8,
        },
        balance: s("balance")?,
        formatted: s("formatted")?,
    })
}

pub(crate) fn balance_to_json(balance: &TokenBalance) -> Value {
    let t = &balance.token;
    json!({ "address": t.address, "balance": balance.balance, "decimals": t.decimals,
            "formatted": balance.formatted, "id": t.id, "name": t.name,
            "networkId": network_code(t.network), "symbol": t.symbol })
}

fn parse_snapshot(value: &JsValue) -> Option<Snapshot> {
    let keys = ["accountId", "balances", "fetchedAt", "networkId"];
    if !value
        .as_object()?
        .iter()
        .all(|(k, _)| keys.contains(&k.as_str()))
    {
        return None;
    }
    let snapshot = Snapshot {
        account_id: value.get("accountId")?.as_str()?.to_string(),
        network: network_from_code(value.get("networkId")?.as_str()?)?,
        balances: value
            .get("balances")?
            .as_array()?
            .iter()
            .map(balance_from_json)
            .collect::<Option<_>>()?,
        fetched_at: value.get("fetchedAt")?.as_f64()?,
    };
    is_snapshot(&snapshot).then_some(snapshot)
}

/// Bounded, validated last-known balances (`snapshots.json`, at most 50 scopes).
#[derive(uniffi::Object)]
pub struct BalanceSnapshots {
    snapshots: Mutex<Vec<Snapshot>>,
}

impl BalanceSnapshots {
    fn all(&self) -> std::sync::MutexGuard<'_, Vec<Snapshot>> {
        self.snapshots
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn find(&self, account_id: &str, network: NetworkId) -> Option<Snapshot> {
        self.all()
            .iter()
            .find(|s| s.account_id == account_id && s.network == network)
            .cloned()
    }
}

#[uniffi::export]
impl BalanceSnapshots {
    /// Loads `snapshots.json`; invalid entries are dropped, an unreadable file reads as empty.
    #[uniffi::constructor]
    pub fn new(persisted: Option<String>) -> std::sync::Arc<Self> {
        let doc = persisted
            .as_deref()
            .and_then(json::parse)
            .filter(|d| d.get("schema").and_then(JsValue::as_str) == Some(super::SCHEMA));
        let mut snapshots: Vec<Snapshot> = doc
            .as_ref()
            .and_then(|d| d.get("snapshots"))
            .and_then(JsValue::as_array)
            .map(|items| items.iter().filter_map(parse_snapshot).collect())
            .unwrap_or_default();
        let excess = snapshots.len().saturating_sub(MAX_SCOPES);
        snapshots.drain(..excess);
        std::sync::Arc::new(Self {
            snapshots: Mutex::new(snapshots),
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
        let snapshot = self.find(&account_id, network);
        let fresh = snapshot.as_ref().is_some_and(|s| {
            s.fetched_at > 0.0
                && s.fetched_at <= now_ms
                && now_ms - s.fetched_at < BALANCE_SNAPSHOT_TTL_MS
        });
        if cached_only || (fresh && !force) {
            return match snapshot {
                Some(s) => BalancePlan::Serve {
                    view: BalanceView {
                        balances: s.balances,
                        fetched_at_ms: s.fetched_at,
                        stale: !fresh,
                    },
                },
                None => BalancePlan::Empty,
            };
        }
        BalancePlan::Load
    }

    /// Records a successful load (when it validates) and returns it as current.
    pub fn loaded(
        &self,
        account_id: String,
        network: NetworkId,
        balances: Vec<TokenBalance>,
        now_ms: f64,
    ) -> BalanceView {
        let snapshot = Snapshot {
            account_id,
            network,
            balances: balances.clone(),
            fetched_at: now_ms,
        };
        if is_snapshot(&snapshot) {
            let mut all = self.all();
            all.retain(|s| s.account_id != snapshot.account_id || s.network != snapshot.network);
            all.push(snapshot);
            let excess = all.len().saturating_sub(MAX_SCOPES);
            all.drain(..excess);
        }
        BalanceView {
            balances,
            fetched_at_ms: now_ms,
            stale: false,
        }
    }

    /// A failed load: the saved balances marked stale, or `None` (the caller shows the error).
    pub fn failed(&self, account_id: String, network: NetworkId) -> Option<BalanceView> {
        self.find(&account_id, network).map(|s| BalanceView {
            balances: s.balances,
            fetched_at_ms: s.fetched_at,
            stale: true,
        })
    }

    /// The `snapshots.json` document (public balances only).
    pub fn persisted(&self) -> String {
        let items: Vec<Value> = self
            .all()
            .iter()
            .map(|s| {
                json!({ "accountId": s.account_id, "balances": s.balances.iter().map(balance_to_json).collect::<Vec<_>>(),
                        "fetchedAt": s.fetched_at, "networkId": network_code(s.network) })
            })
            .collect();
        json!({ "schema": super::SCHEMA, "snapshots": items }).to_string()
    }

    pub fn clear(&self) {
        self.all().clear();
    }
}

/// The balance state the header and Home render from (`BalanceState`).
#[derive(Debug, Clone, PartialEq, uniffi::Enum)]
pub enum BalanceHealth {
    Loading,
    Loaded { stale: bool, as_of_ms: Option<f64> },
    Failed,
}

/// `networkDataIssue(...).join(" ")`: the header pill's description, `None` when data is current.
#[uniffi::export]
pub fn network_data_issue(balances: BalanceHealth, prices: Option<PriceView>) -> Option<String> {
    let mut issues = Vec::new();
    match balances {
        BalanceHealth::Failed => issues.push("Balances are temporarily unavailable.".to_string()),
        BalanceHealth::Loaded {
            stale: true,
            as_of_ms,
        } => {
            issues.push(format!(
                "Using saved {}.",
                format_saved_data_label("balances", as_of_ms)
            ));
        }
        _ => {}
    }
    if let Some(view) = prices.filter(|v| v.stale) {
        issues.push(if view.prices.is_empty() {
            "Live prices are temporarily unavailable.".to_string()
        } else {
            format!(
                "Using saved {}.",
                format_saved_data_label("prices", view.as_of_ms)
            )
        });
    }
    (!issues.is_empty()).then(|| issues.join(" "))
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
    let normalized = raw.to_lowercase();
    NETWORK_FAILURE_MARKERS
        .iter()
        .any(|marker| normalized.contains(marker))
        .then(|| NETWORK_ERROR_MESSAGE.to_string())
}
