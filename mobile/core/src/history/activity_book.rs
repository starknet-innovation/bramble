//! The history-read cadence over the wallet's one activity log
//! (`wallet_core::history::activity_book`, `activity-ops.ts handleActivity` and
//! `starkscan-wallet.ts createExplorerFirstHistory`): the UniFFI shape and the `ActivityBook`
//! object, which holds the core's book (Starkscan's in-memory cooldown) behind a lock and runs
//! every read and write of the log under the activity lock (`crate::activity::with_log`). The
//! host never persists activity. Scopes are account record ids (`activity_account_id`).

use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use wallet_core::history::activity_book as port;
pub use wallet_core::history::activity_book::ActivityView;

use super::activity::ActivityEntry;
use crate::activity::with_log;
use crate::networks::NetworkId;
use crate::portfolio::model::TokenConfig;
use crate::portfolio::wire::{HttpOutcome, HttpRequest};

/// One account's feed on one network.
#[uniffi::remote(Record)]
pub struct ActivityView {
    pub entries: Vec<ActivityEntry>,
    pub history_unavailable: bool,
}

/// The history reads over the wallet's activity log, obtained from the core's `activity_book`.
/// Only Starkscan's cooldown (`retryAt`, in memory in the extension too) lives here.
#[derive(uniffi::Object)]
pub struct ActivityBook {
    dir: PathBuf,
    book: Mutex<port::ActivityBook>,
}

impl ActivityBook {
    /// The book over the log in `dir` (the core's data directory).
    pub(crate) fn at(dir: PathBuf) -> Arc<Self> {
        Arc::new(Self {
            dir,
            book: Mutex::new(port::ActivityBook::new(super::HISTORY_POLICY)),
        })
    }

    // Always taken inside `with_log` when both are held, so the two locks have one order.
    fn book(&self) -> MutexGuard<'_, port::ActivityBook> {
        self.book.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[uniffi::export]
impl ActivityBook {
    /// The saved feed for one scope (submitted and on-chain rows), newest first, with the last
    /// read's availability.
    pub fn cached(&self, account_id: String, network: NetworkId) -> ActivityView {
        with_log(&self.dir, |log| {
            self.book().cached(log, account_id, network)
        })
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
        with_log(&self.dir, |log| {
            self.book()
                .history_due(log, account_id, network, force, now_ms)
        })
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
        self.book()
            .starkscan_request(account_id, network, tracked, explorer_allowed, now_ms)
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
        with_log(&self.dir, |log| {
            self.book()
                .starkscan_apply(log, account_id, network, tracked, outcome, now_ms)
        })
    }

    /// Merges the rows of a finished RPC scan (`HistoryScan::finish`) and marks the scope synced.
    pub fn scan_apply(
        &self,
        account_id: String,
        network: NetworkId,
        rows: Vec<ActivityEntry>,
        now_ms: f64,
    ) -> ActivityView {
        with_log(&self.dir, |log| {
            self.book()
                .scan_apply(log, account_id, network, rows, now_ms)
        })
    }

    /// No lane answered: keep the log and mark the scope unavailable (retried after 60 s).
    pub fn mark_unavailable(
        &self,
        account_id: String,
        network: NetworkId,
        now_ms: f64,
    ) -> ActivityView {
        with_log(&self.dir, |log| {
            self.book()
                .mark_unavailable(log, account_id, network, now_ms)
        })
    }
}
