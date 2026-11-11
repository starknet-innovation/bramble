//! Crate-internal hooks the integration tests use. Not part of the FFI surface.

pub use crate::js::json::{parse as parse_json, JsValue};
pub use crate::js::num::number_to_string;

/// An activity book over the log in `dir`, exactly as `WalletCore::activity_book` opens it.
pub fn activity_book(dir: &std::path::Path) -> std::sync::Arc<crate::ActivityBook> {
    crate::history::activity_book::ActivityBook::at(dir.to_path_buf())
}
