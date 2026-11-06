//! `activity.v1.json`, next to the vault: `{version: 1, scopes: {"<networkId>:<address>":
//! [entry…]}, sync: [..]}`, where an entry is the extension's `ActivityEntry` field for field and
//! a scope is the account record id (`activity_account_id`). It is the wallet's ONE activity log:
//! transactions this wallet submitted and on-chain history rows (`feed.rs`) live in the same
//! scope, with the history reads' bookkeeping in `sync`. The core owns the file; the host never
//! reads or writes it.
//!
//! Rules mirror `packages/features/transactions/src/activity/activity.ts` and
//! `tx-observation.ts` (whose policy is `observation.rs`): entries are validated on read (invalid ones are dropped), at most 200
//! per scope (oldest dropped), de-duplicated by numeric hash, status moves forward only
//! (`monotonicTxStatus`), and three consecutive not-found answers make an entry
//! `rejected`. A file that cannot be read as version 1 is never overwritten blind: it is renamed
//! `activity.v1.corrupt-<n>.json` and the store starts empty. Writes are write-then-rename.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use starknet_types_core::felt::Felt;

use super::observation;
use crate::felt;
use crate::files::write_atomic;
use crate::history::activity_rules::{is_recorded_token_address, parse_direction};
use crate::send::judge::Observation;
use crate::send::types::{ActivityKind, TxStatus};

pub(crate) const ACTIVITY_FILE: &str = "activity.v1.json";
const MAX_ENTRIES_PER_SCOPE: usize = 200;
const MAX_FILE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_TEXT: usize = 200;
/// `NOT_FOUND_FAILURE_THRESHOLD` in `tx-observation.ts`.
pub(crate) const NOT_FOUND_FAILURE_THRESHOLD: u32 = 3;

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub direction: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure_notice: Option<String>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token_address: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct File {
    version: u32,
    scopes: BTreeMap<String, Vec<serde_json::Value>>,
    /// History-read bookkeeping per scope (`markHistorySynced`); absent in older files.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    sync: Vec<serde_json::Value>,
}

/// One scope's last history read (`activity.ts` sync record).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SyncRecord {
    pub account_id: String,
    pub synced_at: u64,
    pub unavailable: bool,
}

/// The whole log as read: scopes and sync records, both validated.
pub(super) struct Log {
    pub scopes: BTreeMap<String, Vec<Entry>>,
    pub sync: Vec<SyncRecord>,
}

pub(crate) fn kind_text(kind: ActivityKind) -> &'static str {
    match kind {
        ActivityKind::Declare => "declare",
        ActivityKind::Deploy => "deploy",
        ActivityKind::Invoke => "invoke",
        ActivityKind::Transfer => "transfer",
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
        "declare" => Some(ActivityKind::Declare),
        "deploy" => Some(ActivityKind::Deploy),
        "invoke" => Some(ActivityKind::Invoke),
        "transfer" => Some(ActivityKind::Transfer),
        _ => None,
    }
}

/// `monotonicTxStatus`: terminal failures stick, and progress never moves backwards.
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
        && entry
            .direction
            .as_deref()
            .is_none_or(|direction| parse_direction(direction).is_some())
        && is_recorded_token_address(entry.token_address.as_deref(), entry.token.as_deref())
        && entry
            .failure_notice
            .as_deref()
            .is_none_or(|notice| matches!(notice, "pending" | "delivered"))
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

/// Reads the log; an unreadable file is quarantined and reads as empty.
pub(super) fn load_log(dir: &Path) -> Log {
    let empty = || Log {
        scopes: BTreeMap::new(),
        sync: Vec::new(),
    };
    let file = path(dir);
    let Ok(metadata) = fs::metadata(&file) else {
        return empty();
    };
    let parsed = (metadata.len() <= MAX_FILE_BYTES)
        .then(|| fs::read(&file).ok())
        .flatten()
        .and_then(|bytes| serde_json::from_slice::<File>(&bytes).ok())
        .filter(|parsed| parsed.version == 1);
    let Some(parsed) = parsed else {
        quarantine(dir);
        return empty();
    };
    let sync = parsed
        .sync
        .into_iter()
        .filter_map(|value| serde_json::from_value::<SyncRecord>(value).ok())
        .filter(|record| record.synced_at < (1u64 << 53))
        .collect();
    let scopes = parsed
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
        .collect();
    Log { scopes, sync }
}

/// Writes the whole log (write-then-rename).
pub(super) fn save_log(dir: &Path, log: &Log) -> bool {
    let scopes = &log.scopes;
    let file = File {
        version: 1,
        sync: log
            .sync
            .iter()
            .filter_map(|record| serde_json::to_value(record).ok())
            .collect(),
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

pub(super) fn locked<T>(f: impl FnOnce() -> T) -> T {
    let _guard = FILE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    f()
}

/// Records a new entry (status `pending`). An entry whose hash is already recorded in the scope
/// is kept as it is. Returns whether the file now holds the entry.
pub(crate) fn record(dir: &Path, entry: Entry) -> bool {
    locked(|| {
        let mut log = load_log(dir);
        let scopes = &mut log.scopes;
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
        save_log(dir, &log)
    })
}

/// Folds one status observation into every entry for `hash` (`reconciledOutcome`; a multi-leg
/// transaction is stored as one row per leg) and returns the first entry's resulting status, or
/// `None` when no such entry exists.
pub(crate) fn observe(
    dir: &Path,
    account_id: &str,
    hash: &Felt,
    observation: Observation,
) -> Option<TxStatus> {
    locked(|| {
        let mut log = load_log(dir);
        let scopes = &mut log.scopes;
        let mut result = None;
        for entry in scopes
            .get_mut(account_id)?
            .iter_mut()
            .filter(|e| felt::parse(&e.hash).as_ref() == Some(hash))
        {
            let Some(status) = observe_entry(entry, observation) else {
                continue;
            };
            result.get_or_insert(status);
        }
        if result.is_some() && observation != Observation::Unknown {
            save_log(dir, &log);
        }
        result
    })
}

// One entry's share of `observe`; `None` when its stored status does not parse.
fn observe_entry(entry: &mut Entry, observation: Observation) -> Option<TxStatus> {
    {
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
        parse_status(&entry.status)
    }
}

/// Drops the still-`pending` entry for `hash` after the node gave a determinate JSON-RPC refusal
/// of its write: the transaction never existed, and the extension records activity only after a
/// write is accepted. An entry that has already been observed is left alone.
pub(crate) fn discard(dir: &Path, account_id: &str, hash: &Felt) {
    locked(|| {
        let mut log = load_log(dir);
        let scopes = &mut log.scopes;
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
            save_log(dir, &log);
        }
    });
}

/// Retires the scope's unresolved entries that outlived their observation window
/// (`expiredObservations` + `retiredOutcome`): each keeps its status and gains one pending
/// notice. Returns how many were retired.
pub(crate) fn retire_expired(dir: &Path, account_id: &str, now_ms: u64) -> usize {
    locked(|| {
        let mut log = load_log(dir);
        let Some(entries) = log.scopes.get_mut(account_id) else {
            return 0;
        };
        let mut retired = 0;
        for entry in entries.iter_mut() {
            let Some(status) = parse_status(&entry.status) else {
                continue;
            };
            if observation::is_expired(
                status,
                entry.failure_notice.is_some(),
                entry.submitted_at,
                now_ms,
            ) {
                entry.failure_notice = Some("pending".into());
                retired += 1;
            }
        }
        if retired > 0 && !save_log(dir, &log) {
            return 0;
        }
        retired
    })
}

/// `takeFailureNotices`: the scope's entries owing a notice (at most `MAX_ALERTS_PER_DRAIN`),
/// marked delivered in the same write so each notice is handed out once. Nothing is returned
/// unless that write lands.
pub(crate) fn take_failure_notices(dir: &Path, account_id: &str) -> Vec<Entry> {
    locked(|| {
        let mut log = load_log(dir);
        let Some(entries) = log.scopes.get_mut(account_id) else {
            return Vec::new();
        };
        let mut taken = Vec::new();
        for entry in entries.iter_mut() {
            if taken.len() == observation::MAX_ALERTS_PER_DRAIN {
                break;
            }
            if entry.failure_notice.as_deref() == Some("pending") {
                taken.push(entry.clone());
                entry.failure_notice = Some("delivered".into());
            }
        }
        if taken.is_empty() || !save_log(dir, &log) {
            return Vec::new();
        }
        taken
    })
}

/// Entries for one account scope, newest first.
pub(crate) fn list(dir: &Path, account_id: &str) -> Vec<Entry> {
    locked(|| {
        let mut entries = load_log(dir).scopes.remove(account_id).unwrap_or_default();
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
