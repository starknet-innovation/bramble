//! Activity (`wallet_core::history`: the Starkscan lane, the RPC history scan, the local log's
//! cadence and the row presentation): the UniFFI shapes, the `ActivityBook` and `HistoryScan`
//! objects over the core's values, the exports with Bramble's catalogs, and Bramble's copy.

pub mod activity;
pub mod activity_book;
pub mod appearance;
pub mod events;
pub mod explorer;

/// Bramble's history choices, for `wallet_core::history`: `STARKSCAN_API_BASE`
/// (`history/starkscan.ts`), `matchingToken`'s untracked-token name, and the pre-confirmed
/// `PROVISIONAL_TX_HINT`. A copy of wallet-core's `bramble-core` `HISTORY_POLICY`, value for
/// value, until 2.7 swaps it for that.
pub const HISTORY_POLICY: wallet_core::history::HistoryPolicy =
    wallet_core::history::HistoryPolicy {
        explorer_api_base: "https://starkscan.co/v1",
        untracked_token_name: "Untracked token",
        preconfirmed_hint: "Pre-confirmed, not final yet. Bramble tells you if it doesn't settle.",
    };
