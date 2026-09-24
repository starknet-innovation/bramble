//! `activity.v1.json`, next to the vault: `{version: 1, scopes: {"<networkId>:<address>":
//! [entry…]}}`, where an entry is the extension's `ActivityEntry` field for field. The core owns
//! the file; the host never reads or writes it.
//!
//! Rules mirror `packages/features/transactions/src/activity/activity.ts` and
//! `tx-observation.ts`: entries are validated on read (invalid ones are dropped), at most 200
//! per scope (oldest dropped), de-duplicated by numeric hash, status moves forward only
//! (`monotonicActivityStatus`), and three consecutive not-found answers make an entry
//! `rejected`. A file that cannot be read as version 1 is never overwritten blind: it is renamed
//! `activity.v1.corrupt-<n>.json` and the store starts empty. Writes are write-then-rename.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use starknet_types_core::felt::Felt;

use crate::felt;
use crate::files::write_atomic;
use crate::send::judge::Observation;
use crate::send::types::{ActivityKind, TxStatus};

pub(crate) const ACTIVITY_FILE: &str = "activity.v1.json";
const MAX_ENTRIES_PER_SCOPE: usize = 200;
const MAX_FILE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_TEXT: usize = 200;
/// `NOT_FOUND_FAILURE_THRESHOLD` in `tx-observation.ts`.
pub(crate) const NOT_FOUND_FAILURE_THRESHOLD: u32 = 3;

/// `UNRESOLVED_WINDOW_MS`: how long a pending or pre-confirmed entry stays under observation.
pub(crate) const UNRESOLVED_WINDOW_MS: u64 = 60 * 60 * 1_000;
/// `FAST_OBSERVATION_PERIOD_MINUTES`, in milliseconds: the least time between two status reads
/// of one unresolved entry.
pub(crate) const FAST_OBSERVATION_PERIOD_MS: u64 = 60 * 1_000;

/// `isObservedAt(entry, "fast", now)`: an unresolved entry still inside its window. Past it the
/// wallet stops polling and keeps the status it has, rather than claiming an outcome.
pub(crate) fn is_observed(status: TxStatus, submitted_at_ms: u64, now_ms: u64) -> bool {
    matches!(status, TxStatus::Pending | TxStatus::Preconfirmed)
        && now_ms.saturating_sub(submitted_at_ms) < UNRESOLVED_WINDOW_MS
}

/// Serialises every read-modify-write of the file within the process.
static FILE_LOCK: Mutex<()> = Mutex::new(());

/// One stored entry, the extension's `ActivityEntry` shape.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Entry {
    pub account_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub amount: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub counterparty: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "finalizedOnL1"
    )]
    pub finalized_on_l1: Option<bool>,
    pub hash: String,
    pub kind: String,
    pub network_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub not_found_count: Option<u32>,
    pub status: String,
    pub submitted_at: u64,
    pub summary: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct File {
    version: u32,
    scopes: BTreeMap<String, Vec<serde_json::Value>>,
}

pub(crate) fn kind_text(kind: ActivityKind) -> &'static str {
    match kind {
        ActivityKind::Transfer => "transfer",
        ActivityKind::Deploy => "deploy",
    }
}

pub(crate) fn status_text(status: TxStatus) -> &'static str {
    match status {
        TxStatus::Pending => "pending",
        TxStatus::Preconfirmed => "preconfirmed",
        TxStatus::Accepted => "accepted",
        TxStatus::Rejected => "rejected",
        TxStatus::Reverted => "reverted",
    }
}

pub(crate) fn parse_status(text: &str) -> Option<TxStatus> {
    Some(match text {
        "pending" => TxStatus::Pending,
        "preconfirmed" => TxStatus::Preconfirmed,
        "accepted" => TxStatus::Accepted,
        "rejected" => TxStatus::Rejected,
        "reverted" => TxStatus::Reverted,
        _ => return None,
    })
}

pub(crate) fn parse_kind(text: &str) -> Option<ActivityKind> {
    match text {
        "transfer" => Some(ActivityKind::Transfer),
        "deploy" => Some(ActivityKind::Deploy),
        _ => None,
    }
}

/// `monotonicActivityStatus`: terminal failures stick, and progress never moves backwards.
pub(crate) fn monotonic(current: TxStatus, observed: TxStatus) -> TxStatus {
    let terminal = |s: TxStatus| matches!(s, TxStatus::Rejected | TxStatus::Reverted);
    if terminal(current) {
        return current;
    }
    if terminal(observed) {
        return observed;
    }
    let progress = |s: TxStatus| match s {
        TxStatus::Accepted => 2,
        TxStatus::Preconfirmed => 1,
        _ => 0,
    };
    if progress(observed) >= progress(current) {
        observed
    } else {
        current
    }
}

fn detail_ok(value: &Option<String>) -> bool {
    value
        .as_ref()
        .is_none_or(|text| !text.is_empty() && text.chars().count() <= MAX_TEXT)
}

// `isActivityEntry`.
fn valid(entry: &Entry, scope: &str) -> bool {
    let network_ok = matches!(entry.network_id.as_str(), "SN_MAIN" | "SN_SEPOLIA");
    let account_ok = entry
        .account_id
        .split_once(':')
        .is_some_and(|(network, address)| {
            network == entry.network_id && felt::parse_non_zero(address).is_some()
        });
    network_ok
        && account_ok
        && entry.account_id == scope
        && felt::parse(&entry.hash).is_some()
        && parse_kind(&entry.kind).is_some()
        && parse_status(&entry.status).is_some()
        && !entry.summary.is_empty()
        && entry.summary.chars().count() <= MAX_TEXT
        && detail_ok(&entry.amount)
        && detail_ok(&entry.counterparty)
        && detail_ok(&entry.token)
        && entry.submitted_at < (1u64 << 53)
}

fn path(dir: &Path) -> PathBuf {
    dir.join(ACTIVITY_FILE)
}

fn quarantine(dir: &Path) {
    for n in 0..1000 {
        let target = dir.join(format!("activity.v1.corrupt-{n}.json"));
        if !target.exists() {
            let _ = fs::rename(path(dir), target);
            return;
        }
    }
}

fn load(dir: &Path) -> BTreeMap<String, Vec<Entry>> {
    let file = path(dir);
    let Ok(metadata) = fs::metadata(&file) else {
        return BTreeMap::new();
    };
    let parsed = (metadata.len() <= MAX_FILE_BYTES)
        .then(|| fs::read(&file).ok())
        .flatten()
        .and_then(|bytes| serde_json::from_slice::<File>(&bytes).ok())
        .filter(|parsed| parsed.version == 1);
    let Some(parsed) = parsed else {
        quarantine(dir);
        return BTreeMap::new();
    };
    parsed
        .scopes
        .into_iter()
        .map(|(scope, values)| {
            let entries = values
                .into_iter()
                .filter_map(|value| serde_json::from_value::<Entry>(value).ok())
                .filter(|entry| valid(entry, &scope))
                .collect();
            (scope, entries)
        })
        .collect()
}

fn save(dir: &Path, scopes: &BTreeMap<String, Vec<Entry>>) -> bool {
    let file = File {
        version: 1,
        scopes: scopes
            .iter()
            .map(|(scope, entries)| {
                let values = entries
                    .iter()
                    .filter_map(|entry| serde_json::to_value(entry).ok())
                    .collect();
                (scope.clone(), values)
            })
            .collect(),
    };
    let Ok(body) = serde_json::to_vec(&file) else {
        return false;
    };
    write_atomic(dir, ACTIVITY_FILE, &body).is_ok()
}

fn locked<T>(f: impl FnOnce() -> T) -> T {
    let _guard = FILE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    f()
}

/// Records a new entry (status `pending`). An entry whose hash is already recorded in the scope
/// is kept as it is. Returns whether the file now holds the entry.
pub(crate) fn record(dir: &Path, entry: Entry) -> bool {
    locked(|| {
        let mut scopes = load(dir);
        let scope = entry.account_id.clone();
        if !valid(&entry, &scope) {
            return false;
        }
        let Some(hash) = felt::parse(&entry.hash) else {
            return false;
        };
        let entries = scopes.entry(scope).or_default();
        if entries.iter().any(|e| felt::parse(&e.hash) == Some(hash)) {
            return true;
        }
        entries.push(entry);
        let excess = entries.len().saturating_sub(MAX_ENTRIES_PER_SCOPE);
        entries.drain(..excess);
        save(dir, &scopes)
    })
}

/// Folds one status observation into the entry for `hash` (`reconciledOutcome`) and returns the
/// entry's resulting status, or `None` when no such entry exists.
pub(crate) fn observe(
    dir: &Path,
    account_id: &str,
    hash: &Felt,
    observation: Observation,
) -> Option<TxStatus> {
    locked(|| {
        let mut scopes = load(dir);
        let entry = scopes
            .get_mut(account_id)?
            .iter_mut()
            .find(|e| felt::parse(&e.hash).as_ref() == Some(hash))?;
        let current = parse_status(&entry.status)?;
        match observation {
            Observation::Unknown => return Some(current),
            Observation::NotFound => {
                let count = entry.not_found_count.unwrap_or(0) + 1;
                entry.not_found_count = Some(count);
                if count >= NOT_FOUND_FAILURE_THRESHOLD {
                    entry.status = status_text(TxStatus::Rejected).into();
                }
            }
            Observation::Found {
                status,
                finalized_on_l1,
                ..
            } => {
                entry.status = status_text(monotonic(current, status)).into();
                entry.not_found_count = Some(0);
                entry.finalized_on_l1 =
                    Some(entry.finalized_on_l1.unwrap_or(false) || finalized_on_l1);
            }
        }
        let result = parse_status(&entry.status);
        save(dir, &scopes);
        result
    })
}

/// Drops the still-`pending` entry for `hash` after the node gave a determinate JSON-RPC refusal
/// of its write: the transaction never existed, and the extension records activity only after a
/// write is accepted. An entry that has already been observed is left alone.
pub(crate) fn discard(dir: &Path, account_id: &str, hash: &Felt) {
    locked(|| {
        let mut scopes = load(dir);
        let Some(entries) = scopes.get_mut(account_id) else {
            return;
        };
        let before = entries.len();
        entries.retain(|e| {
            felt::parse(&e.hash).as_ref() != Some(hash)
                || e.status != status_text(TxStatus::Pending)
                || e.not_found_count.is_some()
        });
        if entries.len() != before {
            save(dir, &scopes);
        }
    });
}

/// Entries for one account scope, newest first.
pub(crate) fn list(dir: &Path, account_id: &str) -> Vec<Entry> {
    locked(|| {
        let mut entries = load(dir).remove(account_id).unwrap_or_default();
        entries.reverse();
        entries.sort_by_key(|entry| std::cmp::Reverse(entry.submitted_at));
        entries
    })
}

/// Removes every activity file (wallet deletion): the store, a leftover write-then-rename
/// temporary, and every quarantined `activity.v1.corrupt-<n>.json`, since each can hold
/// addresses, recipients, amounts, and hashes.
pub(crate) fn remove(dir: &Path) {
    locked(|| {
        let _ = fs::remove_file(path(dir));
        let _ = fs::remove_file(dir.join(format!("{ACTIVITY_FILE}.tmp")));
        let Ok(listing) = fs::read_dir(dir) else {
            return;
        };
        for item in listing.flatten() {
            let name = item.file_name();
            let name = name.to_string_lossy();
            if name.starts_with("activity.v1.corrupt-") && name.ends_with(".json") {
                let _ = fs::remove_file(item.path());
            }
        }
    });
}

#[cfg(test)]
#[path = "store_tests.rs"]
mod tests;
