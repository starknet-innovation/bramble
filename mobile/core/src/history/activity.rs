//! Activity rows (`wallet_core::history::activity`, the extension's `ActivityEntry`,
//! `isActivityEntry`, `onChainActivityEntry` and `mergeActivity`): the UniFFI shapes.

pub use wallet_core::history::activity::{
    ActivityEntry, ActivityKind, FailureNotice, TransferDirection, TxStatus,
};

use crate::networks::NetworkId;

/// Reconciliation bookkeeping for a failure the user has moved past.
#[uniffi::remote(Enum)]
pub enum FailureNotice {
    Delivered,
    Pending,
}

/// Whether value came into or went out of the account (`ActivityEntry.direction`).
#[uniffi::remote(Enum)]
pub enum TransferDirection {
    In,
    Out,
}

/// The extension's `ActivityEntry`. Built only by the core (on-chain rows) or validated by it
/// (`activity::store::record`).
#[uniffi::remote(Record)]
pub struct ActivityEntry {
    pub account_id: String,
    pub amount: Option<String>,
    pub counterparty: Option<String>,
    /// Recorded where known: from the decoded transfer on discovered rows, `Out` on a send this
    /// wallet made. The feed reads it before the summary, whose token symbol a third party
    /// chooses (Sherlock 196). Absent on legacy rows and rows that are not one value movement.
    #[uniffi(default = None)]
    pub direction: Option<TransferDirection>,
    pub failure_notice: Option<FailureNotice>,
    pub finalized_on_l1: Option<bool>,
    pub hash: String,
    pub kind: ActivityKind,
    pub network: NetworkId,
    pub not_found_count: Option<u64>,
    pub status: TxStatus,
    pub submitted_at: u64,
    pub summary: String,
    pub token: Option<String>,
    /// The canonical address of the token `token` names (issue 643); never without `token`.
    #[uniffi(default = None)]
    pub token_address: Option<String>,
}
