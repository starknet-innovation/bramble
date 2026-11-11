//! The history side's entry point on `WalletCore`: the activity book over this wallet's log.

use std::sync::Arc;

use crate::history::activity_book::ActivityBook;
use crate::WalletCore;

#[uniffi::export]
impl WalletCore {
    /// The history reads over this wallet's one activity log (public data; no session needed).
    /// The host keeps one per launch: Starkscan's cooldown lives in it, in memory only.
    pub fn activity_book(&self) -> Arc<ActivityBook> {
        ActivityBook::at(self.data_dir.clone())
    }
}
