//! The activity log and its history-read cadence: `activity.ts createActivityLog` (≤200 rows per
//! scope, ≤50 sync records), `activity-ops.ts handleActivity` (the "due" rules and the
//! merge/mark-synced order) and `starkscan-wallet.ts createExplorerFirstHistory` (Starkscan first
//! when permitted, the RPC scan otherwise). Persisted as `activity.json`: public history only.

use std::sync::Mutex;

use serde_json::{json, Value};

use super::activity::{
    entry_from_json, entry_to_json, is_activity_entry, merge_activity, ActivityEntry,
};
use super::explorer::is_account_id_for_network;
use super::starkscan::{cooldown_ms, transfers_request, transfers_to_activity};
use crate::js::felt::same_felt;
use crate::js::json::{self, JsValue};
use crate::js::num::is_safe_integer;
use crate::networks::NetworkId;
use crate::portfolio::model::{network_code, network_from_code, TokenConfig};
use crate::portfolio::wire::{HttpOutcome, HttpRequest};
use crate::CoreError;

const MAX_ENTRIES_PER_SCOPE: usize = 200;
const MAX_SYNC_SCOPES: usize = 50;
const HISTORY_FRESH_MS: f64 = 5.0 * 60_000.0;
const HISTORY_RETRY_MS: f64 = 60_000.0;

/// One account's feed on one network.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct ActivityView {
    pub entries: Vec<ActivityEntry>,
    pub history_unavailable: bool,
}

#[derive(Debug, Clone)]
struct Sync {
    account_id: String,
    network: NetworkId,
    synced_at: u64,
    unavailable: bool,
}

#[derive(Debug, Default)]
struct Book {
    entries: Vec<ActivityEntry>,
    syncs: Vec<Sync>,
    retry_at: f64,
}

impl Book {
    fn scope(&self, account_id: &str, network: NetworkId) -> Vec<ActivityEntry> {
        let mut scoped: Vec<ActivityEntry> = self
            .entries
            .iter()
            .filter(|e| e.account_id == account_id && e.network == network)
            .cloned()
            .collect();
        scoped.sort_by_key(|e| std::cmp::Reverse(e.submitted_at));
        scoped
    }

    fn sync(&self, account_id: &str, network: NetworkId) -> Option<&Sync> {
        self.syncs
            .iter()
            .find(|s| s.account_id == account_id && s.network == network)
    }

    // `markHistorySynced`.
    fn mark_synced(
        &mut self,
        account_id: &str,
        network: NetworkId,
        now_ms: f64,
        unavailable: bool,
    ) {
        if !is_account_id_for_network(account_id, network)
            || !is_safe_integer(now_ms)
            || now_ms < 0.0
        {
            return;
        }
        self.syncs
            .retain(|s| s.account_id != account_id || s.network != network);
        self.syncs.push(Sync {
            account_id: account_id.into(),
            network,
            synced_at: now_ms as u64,
            unavailable,
        });
        let excess = self.syncs.len().saturating_sub(MAX_SYNC_SCOPES);
        self.syncs.drain(..excess);
    }

    // `replaceScope`.
    fn replace_scope(&mut self, merged: &[ActivityEntry], account_id: &str, network: NetworkId) {
        let mut scoped: Vec<ActivityEntry> = merged
            .iter()
            .filter(|e| is_activity_entry(e) && e.account_id == account_id && e.network == network)
            .cloned()
            .collect();
        scoped.sort_by_key(|e| std::cmp::Reverse(e.submitted_at));
        scoped.truncate(MAX_ENTRIES_PER_SCOPE);
        self.entries
            .retain(|e| e.account_id != account_id || e.network != network);
        self.entries.extend(scoped);
    }
}

fn parse_sync(value: &JsValue) -> Option<Sync> {
    let keys = ["accountId", "networkId", "syncedAt", "unavailable"];
    if !value
        .as_object()?
        .iter()
        .all(|(k, _)| keys.contains(&k.as_str()))
    {
        return None;
    }
    let network = network_from_code(value.get("networkId")?.as_str()?)?;
    let account_id = value.get("accountId")?.as_str()?.to_string();
    let synced_at = value
        .get("syncedAt")?
        .as_f64()
        .filter(|n| is_safe_integer(*n) && *n >= 0.0)?;
    let JsValue::Bool(unavailable) = value.get("unavailable")? else {
        return None;
    };
    is_account_id_for_network(&account_id, network).then_some(Sync {
        account_id,
        network,
        synced_at: synced_at as u64,
        unavailable: *unavailable,
    })
}

/// The activity log for every account and network, with its history-read bookkeeping.
#[derive(uniffi::Object)]
pub struct ActivityBook {
    book: Mutex<Book>,
}

impl ActivityBook {
    fn book(&self) -> std::sync::MutexGuard<'_, Book> {
        self.book
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn merged_view(
        &self,
        account_id: &str,
        network: NetworkId,
        on_chain: &[ActivityEntry],
        now_ms: f64,
    ) -> ActivityView {
        let mut book = self.book();
        let merged = merge_activity(&book.scope(account_id, network), on_chain);
        book.replace_scope(&merged, account_id, network);
        book.mark_synced(account_id, network, now_ms, false);
        ActivityView {
            entries: merged,
            history_unavailable: false,
        }
    }
}

#[uniffi::export]
impl ActivityBook {
    /// Loads `activity.json`; invalid rows and sync records are dropped, anything unreadable is
    /// an empty log.
    #[uniffi::constructor]
    pub fn new(persisted: Option<String>) -> std::sync::Arc<Self> {
        let doc = persisted.as_deref().and_then(json::parse).filter(|d| {
            d.get("schema").and_then(JsValue::as_str) == Some(crate::portfolio::SCHEMA)
        });
        let list = |key: &str| {
            doc.as_ref()
                .and_then(|d| d.get(key))
                .and_then(JsValue::as_array)
                .map(<[JsValue]>::to_vec)
                .unwrap_or_default()
        };
        let mut syncs: Vec<Sync> = list("sync").iter().filter_map(parse_sync).collect();
        let excess = syncs.len().saturating_sub(MAX_SYNC_SCOPES);
        syncs.drain(..excess);
        std::sync::Arc::new(Self {
            book: Mutex::new(Book {
                entries: list("entries").iter().filter_map(entry_from_json).collect(),
                syncs,
                // `createStarkscanClient` keeps `retryAt` in memory only, so a restart clears it.
                retry_at: 0.0,
            }),
        })
    }

    /// The saved feed for one scope, newest first, with the last read's availability.
    pub fn cached(&self, account_id: String, network: NetworkId) -> ActivityView {
        let book = self.book();
        ActivityView {
            entries: book.scope(&account_id, network),
            history_unavailable: book
                .sync(&account_id, network)
                .is_some_and(|s| s.unavailable),
        }
    }

    /// `shouldScanHistory` with `refreshHistory`: forced, never synced, synced in the future,
    /// stale (5 min; 60 s after a failure), or a local row newer than the last sync.
    pub fn history_due(
        &self,
        account_id: String,
        network: NetworkId,
        force: bool,
        now_ms: f64,
    ) -> bool {
        let book = self.book();
        let Some(sync) = book.sync(&account_id, network) else {
            return true;
        };
        let synced = sync.synced_at as f64;
        let window = if sync.unavailable {
            HISTORY_RETRY_MS
        } else {
            HISTORY_FRESH_MS
        };
        force
            || synced > now_ms
            || now_ms - synced >= window
            || book
                .scope(&account_id, network)
                .iter()
                .any(|e| e.submitted_at as f64 > synced && e.submitted_at as f64 <= now_ms)
    }

    /// The Starkscan transfers request, or `None` to go straight to the RPC scan: not permitted
    /// (`explorer_allowed` is `explorerFallbackAllowed`), cooling down, or no tracked tokens.
    pub fn starkscan_request(
        &self,
        account_id: String,
        network: NetworkId,
        tracked: Vec<TokenConfig>,
        explorer_allowed: bool,
        now_ms: f64,
    ) -> Option<HttpRequest> {
        let tracked_here = tracked.iter().any(|t| t.network == network);
        let cooling = self.book().retry_at > now_ms;
        (explorer_allowed
            && tracked_here
            && !cooling
            && is_account_id_for_network(&account_id, network))
        .then(|| transfers_request(network, &account_id))
    }

    /// An answering page is authoritative (merged and marked synced, even when empty). A failure
    /// returns `None` after recording the cooldown its outcome earns; the host then runs the scan.
    pub fn starkscan_apply(
        &self,
        account_id: String,
        network: NetworkId,
        tracked: Vec<TokenConfig>,
        outcome: HttpOutcome,
        now_ms: f64,
    ) -> Option<ActivityView> {
        let tokens: Vec<TokenConfig> = tracked
            .into_iter()
            .filter(|t| t.network == network)
            .collect();
        match transfers_to_activity(&outcome, &account_id, network, &tokens) {
            Some(rows) => {
                self.book().retry_at = 0.0;
                Some(self.merged_view(&account_id, network, &rows, now_ms))
            }
            None => {
                if let Some(cooldown) = cooldown_ms(&outcome, now_ms) {
                    let mut book = self.book();
                    book.retry_at = book.retry_at.max(now_ms + cooldown);
                }
                None
            }
        }
    }

    /// Merges the rows of a finished RPC scan (`HistoryScan::finish`) and marks the scope synced.
    pub fn scan_apply(
        &self,
        account_id: String,
        network: NetworkId,
        rows: Vec<ActivityEntry>,
        now_ms: f64,
    ) -> ActivityView {
        let rows: Vec<ActivityEntry> = rows.into_iter().filter(is_activity_entry).collect();
        self.merged_view(&account_id, network, &rows, now_ms)
    }

    /// No lane answered: keep the local log and mark the scope unavailable (retried after 60 s).
    pub fn mark_unavailable(
        &self,
        account_id: String,
        network: NetworkId,
        now_ms: f64,
    ) -> ActivityView {
        let mut book = self.book();
        book.mark_synced(&account_id, network, now_ms, true);
        ActivityView {
            entries: book.scope(&account_id, network),
            history_unavailable: true,
        }
    }

    /// The seam for locally submitted transactions (the transactions workstream): a validated row
    /// replaces any row with the same hash in its scope, keeping at most 200.
    pub fn record_local(&self, entry: ActivityEntry) -> Result<ActivityView, CoreError> {
        if !is_activity_entry(&entry) {
            return Err(CoreError::InvalidInput {
                reason: "invalid activity entry".into(),
            });
        }
        let mut book = self.book();
        let in_scope =
            |e: &ActivityEntry| e.account_id == entry.account_id && e.network == entry.network;
        let kept: Vec<ActivityEntry> = book
            .entries
            .iter()
            .filter(|e| in_scope(e) && !same_felt(&e.hash, &entry.hash))
            .cloned()
            .collect();
        let retained = &kept[kept.len().saturating_sub(MAX_ENTRIES_PER_SCOPE - 1)..];
        book.entries
            .retain(|e| !in_scope(e) || (!same_felt(&e.hash, &entry.hash) && retained.contains(e)));
        book.entries.push(entry.clone());
        let unavailable = book
            .sync(&entry.account_id, entry.network)
            .is_some_and(|s| s.unavailable);
        Ok(ActivityView {
            entries: book.scope(&entry.account_id, entry.network),
            history_unavailable: unavailable,
        })
    }

    /// The `activity.json` document.
    pub fn persisted(&self) -> String {
        let book = self.book();
        let syncs: Vec<Value> = book
            .syncs
            .iter()
            .map(|s| json!({ "accountId": s.account_id, "networkId": network_code(s.network), "syncedAt": s.synced_at, "unavailable": s.unavailable }))
            .collect();
        json!({
            "schema": crate::portfolio::SCHEMA,
            "entries": book.entries.iter().map(entry_to_json).collect::<Vec<_>>(),
            "sync": syncs,
        })
        .to_string()
    }

    pub fn clear(&self) {
        *self.book() = Book::default();
    }
}
