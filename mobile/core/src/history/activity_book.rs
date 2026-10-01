//! The history-read cadence over the wallet's one activity log (`activity/feed.rs`):
//! `activity-ops.ts handleActivity` (the "due" rules and the merge/mark-synced order) and
//! `starkscan-wallet.ts createExplorerFirstHistory` (Starkscan first when permitted, the RPC scan
//! otherwise). Rows and sync records live in the core's `activity.v1.json` beside the
//! transactions this wallet submitted; the host never persists activity. Scopes are account
//! record ids (`activity_account_id`).

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use super::activity::{is_activity_entry, ActivityEntry};
use super::explorer::is_account_id_for_network;
use super::starkscan::{cooldown_ms, transfers_request, transfers_to_activity};
use crate::activity::feed;
use crate::js::num::is_safe_integer;
use crate::networks::NetworkId;
use crate::portfolio::model::TokenConfig;
use crate::portfolio::wire::{HttpOutcome, HttpRequest};

const HISTORY_FRESH_MS: f64 = 5.0 * 60_000.0;
const HISTORY_RETRY_MS: f64 = 60_000.0;

/// One account's feed on one network.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct ActivityView {
    pub entries: Vec<ActivityEntry>,
    pub history_unavailable: bool,
}

/// The history reads over the wallet's activity log, obtained from the core's `activity_book`.
/// Only Starkscan's cooldown (`retryAt`, in memory in the extension too) lives here.
#[derive(uniffi::Object)]
pub struct ActivityBook {
    dir: PathBuf,
    retry_at: Mutex<f64>,
}

/// A whole-millisecond clock reading, as the store keeps it; `None` for anything else.
fn stamp(now_ms: f64) -> Option<u64> {
    (is_safe_integer(now_ms) && now_ms >= 0.0).then_some(now_ms as u64)
}

impl ActivityBook {
    /// The book over the log in `dir` (the core's data directory).
    pub(crate) fn at(dir: PathBuf) -> Arc<Self> {
        Arc::new(Self {
            dir,
            retry_at: Mutex::new(0.0),
        })
    }

    fn retry_at(&self) -> std::sync::MutexGuard<'_, f64> {
        self.retry_at
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn scoped(account_id: &str, network: NetworkId) -> bool {
        is_account_id_for_network(account_id, network)
    }

    fn merged_view(
        &self,
        account_id: &str,
        network: NetworkId,
        on_chain: &[ActivityEntry],
        now_ms: f64,
    ) -> ActivityView {
        let entries = match stamp(now_ms).filter(|_| Self::scoped(account_id, network)) {
            Some(now) => feed::merge(&self.dir, account_id, on_chain, now),
            None => feed::scope(&self.dir, account_id),
        };
        ActivityView {
            entries,
            history_unavailable: false,
        }
    }
}

#[uniffi::export]
impl ActivityBook {
    /// The saved feed for one scope (submitted and on-chain rows), newest first, with the last
    /// read's availability.
    pub fn cached(&self, account_id: String, network: NetworkId) -> ActivityView {
        if !Self::scoped(&account_id, network) {
            return ActivityView {
                entries: Vec::new(),
                history_unavailable: false,
            };
        }
        ActivityView {
            entries: feed::scope(&self.dir, &account_id),
            history_unavailable: feed::sync_of(&self.dir, &account_id).is_some_and(|(_, u)| u),
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
        let Some((synced_at, unavailable)) = feed::sync_of(&self.dir, &account_id) else {
            return true;
        };
        let synced = synced_at as f64;
        let window = if unavailable {
            HISTORY_RETRY_MS
        } else {
            HISTORY_FRESH_MS
        };
        force
            || synced > now_ms
            || now_ms - synced >= window
            || self
                .cached(account_id, network)
                .entries
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
        let cooling = *self.retry_at() > now_ms;
        (explorer_allowed && tracked_here && !cooling && Self::scoped(&account_id, network))
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
                *self.retry_at() = 0.0;
                Some(self.merged_view(&account_id, network, &rows, now_ms))
            }
            None => {
                if let Some(cooldown) = cooldown_ms(&outcome, now_ms) {
                    let mut retry_at = self.retry_at();
                    *retry_at = retry_at.max(now_ms + cooldown);
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

    /// No lane answered: keep the log and mark the scope unavailable (retried after 60 s).
    pub fn mark_unavailable(
        &self,
        account_id: String,
        network: NetworkId,
        now_ms: f64,
    ) -> ActivityView {
        if let Some(now) = stamp(now_ms).filter(|_| Self::scoped(&account_id, network)) {
            feed::mark_unavailable(&self.dir, &account_id, now);
        }
        ActivityView {
            history_unavailable: true,
            ..self.cached(account_id, network)
        }
    }
}
