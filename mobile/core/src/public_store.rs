//! Public, non-secret wallet metadata files kept beside `vault.json`: contacts, shared accounts,
//! and coordination checkpoints. They inherit the data directory's protection (iOS complete file
//! protection and backup exclusion; Android `noBackupFilesDir`).
//!
//! Every file is `{"version":1, …}`, written with the vault's temp-file, `sync_all`, rename
//! sequence, so an interrupted write never leaves a truncated file. Reading fails closed: an
//! unreadable or invalid file is an error that names the file, never silently reset to empty.

use std::fs;
use std::io::ErrorKind;
use std::path::Path;

use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::CoreError;

/// The contacts file (the extension's address book).
pub const CONTACTS: &str = "contacts.json";
/// The shared-account registry.
pub const MULTISIGS: &str = "multisigs.json";
/// Relay choice, sync checkpoints, and held packages.
pub const COORDINATION: &str = "coordination.json";
/// Largest metadata file the core will read.
const MAX_FILE_BYTES: u64 = 1024 * 1024;

fn unreadable(file: &str) -> CoreError {
    CoreError::Storage {
        reason: format!("{file} unreadable"),
    }
}

/// Reads `file`; `Ok(None)` when it does not exist yet.
pub fn read<T: DeserializeOwned>(dir: &Path, file: &str) -> Result<Option<T>, CoreError> {
    let path = dir.join(file);
    match fs::metadata(&path) {
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(unreadable(file)),
        Ok(meta) if meta.len() > MAX_FILE_BYTES => return Err(unreadable(file)),
        Ok(_) => {}
    }
    let text = fs::read_to_string(&path).map_err(|_| unreadable(file))?;
    serde_json::from_str(&text)
        .map(Some)
        .map_err(|_| unreadable(file))
}

/// Writes `file` atomically, through the vault's one durable-write path (`files::write_atomic`).
pub fn write<T: Serialize>(dir: &Path, file: &str, value: &T) -> Result<(), CoreError> {
    let failed = || CoreError::Storage {
        reason: format!("{file} not written"),
    };
    let body = serde_json::to_vec(value).map_err(|_| failed())?;
    crate::files::write_atomic(dir, file, &body).map_err(|_| failed())
}

/// Removes every metadata file; called when the wallet is deleted.
pub fn remove_all(dir: &Path) -> Result<(), CoreError> {
    for file in [CONTACTS, MULTISIGS, COORDINATION] {
        for name in [file.to_string(), format!("{file}.tmp")] {
            match fs::remove_file(dir.join(&name)) {
                Err(error) if error.kind() != ErrorKind::NotFound => {
                    return Err(CoreError::Storage {
                        reason: format!("{file} not removed"),
                    })
                }
                _ => {}
            }
        }
    }
    Ok(())
}
