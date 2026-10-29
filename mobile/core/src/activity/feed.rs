//! The history side of the one activity log (`store.rs`): typed `ActivityEntry` rows in and out,
//! `mergeActivity` of on-chain rows into a scope that already holds this wallet's submitted
//! transactions, and the `markHistorySynced` bookkeeping. Every read-modify-write runs under the
//! store's lock, so a merge can never overwrite a status the transactions side just observed.

use std::path::Path;

use super::store::{load_log, locked, save_log, Entry, SyncRecord};
use crate::history::activity::{entry_from_json, entry_to_json, merge_activity, ActivityEntry};
use crate::history::activity_book::ActivityBook;
use crate::history::activity_rules::without_planted_rows;
use crate::js::json;
use crate::WalletCore;

/// Scopes whose history-read bookkeeping is kept (`activity.ts`'s sync cap).
const MAX_SYNC_SCOPES: usize = 50;
/// Rows kept per scope, newest first (`MAX_ACTIVITY_ENTRIES`).
const MAX_ENTRIES_PER_SCOPE: usize = 200;

/// A stored row as the typed record; `None` unless it passes `isActivityEntry`.
pub(crate) fn typed(entry: &Entry) -> Option<ActivityEntry> {
    let text = serde_json::to_string(entry).ok()?;
    entry_from_json(&json::parse(&text)?)
}

/// A typed row in the stored shape; `None` when the store's own validation would refuse it.
pub(crate) fn stored(entry: &ActivityEntry) -> Option<Entry> {
    serde_json::from_value(entry_to_json(entry)).ok()
}

/// One scope's rows, newest first.
pub(crate) fn scope(dir: &Path, account_id: &str) -> Vec<ActivityEntry> {
    super::store::list(dir, account_id)
        .iter()
        .filter_map(typed)
        .collect()
}

/// The scope's last history read: `(synced_at, unavailable)`.
pub(crate) fn sync_of(dir: &Path, account_id: &str) -> Option<(u64, bool)> {
    locked(|| {
        load_log(dir)
            .sync
            .into_iter()
            .find(|record| record.account_id == account_id)
            .map(|record| (record.synced_at, record.unavailable))
    })
}

fn mark(sync: &mut Vec<SyncRecord>, account_id: &str, now_ms: u64, unavailable: bool) {
    sync.retain(|record| record.account_id != account_id);
    sync.push(SyncRecord {
        account_id: account_id.into(),
        synced_at: now_ms,
        unavailable,
    });
    let excess = sync.len().saturating_sub(MAX_SYNC_SCOPES);
    sync.drain(..excess);
}

/// `mergeActivity(local, onChain)` into the scope, then `markHistorySynced`; returns the merged
/// rows newest first. Rows that fail validation are dropped, never stored.
pub(crate) fn merge(
    dir: &Path,
    account_id: &str,
    on_chain: &[ActivityEntry],
    now_ms: u64,
) -> Vec<ActivityEntry> {
    locked(|| {
        let mut log = load_log(dir);
        let local: Vec<ActivityEntry> = log
            .scopes
            .get(account_id)
            .map(|entries| entries.iter().filter_map(typed).collect())
            .unwrap_or_default();
        let local = without_planted_rows(local);
        let mut merged = merge_activity(&local, on_chain);
        merged.truncate(MAX_ENTRIES_PER_SCOPE);
        // Oldest first on disk, as `store::record` appends.
        let rows: Vec<Entry> = merged
            .iter()
            .rev()
            .filter(|entry| entry.account_id == account_id)
            .filter_map(stored)
            .collect();
        log.scopes.insert(account_id.to_string(), rows);
        mark(&mut log.sync, account_id, now_ms, false);
        save_log(dir, &log);
        merged
    })
}

/// No history lane answered: keep the rows and record the failed read (retried after 60 s).
pub(crate) fn mark_unavailable(dir: &Path, account_id: &str, now_ms: u64) {
    locked(|| {
        let mut log = load_log(dir);
        mark(&mut log.sync, account_id, now_ms, true);
        save_log(dir, &log);
    });
}

#[uniffi::export]
impl WalletCore {
    /// The history reads over this wallet's one activity log (public data; no session needed).
    /// The host keeps one per launch: Starkscan's cooldown lives in it, in memory only.
    pub fn activity_book(&self) -> std::sync::Arc<ActivityBook> {
        ActivityBook::at(self.data_dir.clone())
    }
}
