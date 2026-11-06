//! Durable file writes for the vault directory.

use std::fs;
use std::io::Write;
use std::path::Path;

use crate::CoreError;

pub(crate) fn storage(reason: &str) -> CoreError {
    CoreError::Storage {
        reason: reason.into(),
    }
}

/// Writes `body` to `dir/name` through a synced temporary file and a rename, so an interrupted
/// write never leaves a truncated file and a completed one has reached the disk.
pub(crate) fn write_atomic(dir: &Path, name: &str, body: &[u8]) -> Result<(), CoreError> {
    let temporary = dir.join(format!("{name}.tmp"));
    let mut file = fs::File::create(&temporary).map_err(|_| storage("create file"))?;
    file.write_all(body)
        .and_then(|()| file.sync_all())
        .map_err(|_| storage("write file"))?;
    fs::rename(&temporary, dir.join(name)).map_err(|_| storage("commit file"))
}
