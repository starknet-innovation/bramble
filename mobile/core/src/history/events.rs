//! The RPC history scan (`wallet_core::history::events`, `history/tx-history-scan.ts
//! collectTransactionHistory` and `tx-history.ts decodeTransferEvent`) as a sans-IO step machine:
//! the UniFFI shape and the `HistoryScan` object, which holds the core's scan behind a lock.
//!
//! Failover (design §3.9): `accept` reports `Transport` when the endpoint failed; the host then
//! calls `restart` and replays the whole scan on the next chain-id-verified endpoint, exactly as
//! `withRpcFallback` reruns `collectTransactionHistory`.

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use wallet_core::history::events as port;
pub use wallet_core::history::events::ScanStep;

use super::activity::ActivityEntry;
use crate::networks::NetworkId;
use crate::portfolio::model::TokenConfig;
use crate::portfolio::wire::{RpcReply, RpcRequest};
use crate::CoreError;

/// What the host does after handing a reply to `accept`.
#[uniffi::remote(Enum)]
pub enum ScanStep {
    /// Keep going: ask `next_calls` again (empty means `finish`).
    Continue,
    /// This endpoint failed at transport level: `restart` on the next endpoint, or, when none is
    /// left, mark history unavailable.
    Transport,
}

/// One account's on-chain history scan on one network.
#[derive(uniffi::Object)]
pub struct HistoryScan {
    scan: Mutex<port::HistoryScan>,
}

impl HistoryScan {
    fn lock(&self) -> MutexGuard<'_, port::HistoryScan> {
        self.scan.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[uniffi::export]
impl HistoryScan {
    /// A scan for `account_id` (from `activity_account_id`) over the tracked tokens.
    #[uniffi::constructor]
    pub fn new(
        account_id: String,
        network: NetworkId,
        tracked: Vec<TokenConfig>,
    ) -> Result<Arc<Self>, CoreError> {
        let scan = port::HistoryScan::new(account_id, network, tracked)?;
        Ok(Arc::new(Self {
            scan: Mutex::new(scan),
        }))
    }

    /// The calls to send now (events one at a time, timestamps up to four at once); empty when
    /// the scan is waiting for replies or done.
    pub fn next_calls(&self) -> Vec<RpcRequest> {
        self.lock().next_calls()
    }

    /// Judges one reply. A node error skips that token, dropping the rows its earlier reads found
    /// (or leaves that block undated).
    pub fn accept(&self, reply: RpcReply) -> ScanStep {
        self.lock().accept(reply)
    }

    /// Discards all progress so the scan replays from `starknet_blockNumber` on another endpoint.
    pub fn restart(&self) {
        self.lock().restart();
    }

    /// The dated rows (at most 25, newest block first), once every call has been answered.
    pub fn finish(&self) -> Result<Vec<ActivityEntry>, CoreError> {
        Ok(self.lock().finish()?)
    }
}
