//! The wallet's one activity log, `activity.v1.json` beside the vault: transactions this wallet
//! submitted and on-chain history rows, as the extension's `ActivityEntry`. The format, its rules
//! and every read-modify-write are `wallet_core::activity::ActivityLog` over the wallet
//! directory's `Storage`; mobile keeps the process-wide lock every use of the log runs under,
//! deleting the files with the wallet, the `activity_book` entry point (`feed`), and Bramble's
//! notice copy. Public on-chain data only.

use std::fs;
use std::path::Path;
use std::sync::{Mutex, PoisonError};

use wallet_core::activity::store::{ACTIVITY_FILE, CORRUPT_FILE_PREFIX};
use wallet_core::activity::ActivityLog;
use wallet_core::send::judge::TxStatus;

use crate::files::Directory;

mod feed;

/// Serialises every read-modify-write of the file within the process.
static FILE_LOCK: Mutex<()> = Mutex::new(());

/// Runs `f` over the log in `dir` under the process-wide lock, the one way any code here reaches
/// the log. The log is built per call: it holds nothing but the storage it reads.
pub(crate) fn with_log<T>(dir: &Path, f: impl FnOnce(&mut ActivityLog<'_>) -> T) -> T {
    let _guard = FILE_LOCK.lock().unwrap_or_else(PoisonError::into_inner);
    let storage = Directory(dir);
    f(&mut ActivityLog::new(&storage))
}

/// Removes every activity file (wallet deletion): the store, a leftover write-then-rename
/// temporary, and every quarantined `activity.v1.corrupt-<n>.json`, since each can hold
/// addresses, recipients, amounts, and hashes.
pub(crate) fn remove(dir: &Path) {
    let _guard = FILE_LOCK.lock().unwrap_or_else(PoisonError::into_inner);
    let _ = fs::remove_file(dir.join(ACTIVITY_FILE));
    let _ = fs::remove_file(dir.join(format!("{ACTIVITY_FILE}.tmp")));
    let Ok(listing) = fs::read_dir(dir) else {
        return;
    };
    for item in listing.flatten() {
        let name = item.file_name();
        let name = name.to_string_lossy();
        if name.starts_with(CORRUPT_FILE_PREFIX) && name.ends_with(".json") {
            let _ = fs::remove_file(item.path());
        }
    }
}

/// `failureNoticeMessage`: the copy for one owed notice. A retired entry keeps its unresolved
/// status, so it reads as "could not confirm".
pub(crate) fn failure_notice_message(status: TxStatus, summary: &str) -> String {
    match status {
        TxStatus::Reverted => format!(
            "Starknet reverted \"{summary}\" after confirming it. Check its activity details before retrying."
        ),
        TxStatus::Rejected => format!(
            "Starknet dropped \"{summary}\" after confirming it. The transaction did not happen."
        ),
        _ => format!(
            "Bramble could not confirm \"{summary}\". Check it on an explorer before retrying."
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCOPE: &str = "SN_SEPOLIA:0x1";

    // Both halves on disk: an unreadable log is set aside through `Directory::rename`, never
    // overwritten, and wallet deletion then removes the log, its temporary and every copy.
    #[test]
    fn unreadable_logs_are_set_aside_and_removed_with_the_wallet() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join(ACTIVITY_FILE);
        fs::write(&file, b"{not json").unwrap();
        assert!(with_log(dir.path(), |log| log.list(SCOPE)).is_empty());
        assert_eq!(
            fs::read(dir.path().join("activity.v1.corrupt-0.json")).unwrap(),
            b"{not json"
        );
        fs::write(&file, br#"{"version":2,"scopes":{}}"#).unwrap();
        assert!(with_log(dir.path(), |log| log.list(SCOPE)).is_empty());
        assert!(dir.path().join("activity.v1.corrupt-1.json").exists());
        assert!(!file.exists());
        fs::write(&file, br#"{"version":1,"scopes":{}}"#).unwrap();
        fs::write(dir.path().join(format!("{ACTIVITY_FILE}.tmp")), b"x").unwrap();
        fs::write(dir.path().join("unrelated.json"), b"{}").unwrap();
        remove(dir.path());
        let left: Vec<String> = fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .map(|item| item.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            left,
            vec!["unrelated.json".to_string()],
            "every activity file is removed"
        );
    }
}
