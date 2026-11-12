//! Durable file writes for the vault directory.

use std::fs;
use std::io::{ErrorKind, Write};
use std::path::Path;

use crate::CoreError;

pub(crate) fn storage(reason: &str) -> CoreError {
    CoreError::Storage {
        reason: reason.into(),
    }
}

/// The write itself; the error is the fixed name of the step that failed.
fn commit(dir: &Path, name: &str, body: &[u8]) -> Result<(), &'static str> {
    let temporary = dir.join(format!("{name}.tmp"));
    let mut file = fs::File::create(&temporary).map_err(|_| "create file")?;
    file.write_all(body)
        .and_then(|()| file.sync_all())
        .map_err(|_| "write file")?;
    fs::rename(&temporary, dir.join(name)).map_err(|_| "commit file")
}

/// Writes `body` to `dir/name` through a synced temporary file and a rename, so an interrupted
/// write never leaves a truncated file and a completed one has reached the disk.
pub(crate) fn write_atomic(dir: &Path, name: &str, body: &[u8]) -> Result<(), CoreError> {
    commit(dir, name, body).map_err(storage)
}

/// The wallet directory as the shared core's `Storage` (the vault and the activity log): a key is a
/// file name in it, a write is `write_atomic`'s, and a rename is `fs::rename` within it.
pub(crate) struct Directory<'a>(pub &'a Path);

impl wallet_core::host::Storage for Directory<'_> {
    fn read(&self, key: &str) -> Result<Option<Vec<u8>>, wallet_core::Error> {
        match fs::read(self.0.join(key)) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(_) => Err(wallet_core::Error::storage("read vault")),
        }
    }

    fn write(&self, key: &str, value: &[u8]) -> Result<(), wallet_core::Error> {
        commit(self.0, key, value).map_err(wallet_core::Error::storage)
    }

    fn rename(&self, from: &str, to: &str) -> Result<(), wallet_core::Error> {
        fs::rename(self.0.join(from), self.0.join(to))
            .map_err(|_| wallet_core::Error::storage("rename file"))
    }
}
