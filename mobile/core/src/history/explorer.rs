//! Account ids and explorer links (`wallet_core::history::explorer`, the extension's
//! `canonicalAccountId` / `isAccountIdForNetwork` and `explorerTransactionUrl` /
//! `explorerAccountUrl`, whose export is in `lib.rs`): the exports, over the bundled network
//! catalog, which holds every `NetworkId`. A link is built only from a validated felt, never
//! from a response body.

use wallet_core::history::explorer as port;

use crate::networks::{self, NetworkId};
use crate::CoreError;

/// The only builder of an activity, snapshot or history-scan account id:
/// `SN_MAIN`/`SN_SEPOLIA` + `:` + the **unpadded** canonical address (token ids, by contrast,
/// use the padded address). Swift and Kotlin never assemble this string.
#[uniffi::export]
pub fn activity_account_id(network: NetworkId, address: String) -> Result<String, CoreError> {
    Ok(port::activity_account_id(network, address)?)
}

/// `explorerTransactionUrl`: `None` for anything that is not a non-zero lowercase felt.
#[uniffi::export]
pub fn explorer_transaction_url(network: NetworkId, hash: String) -> Option<String> {
    port::explorer_transaction_url(networks::all(), network, hash)
}
