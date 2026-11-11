//! Sans-IO authority read for shared accounts (the extension's `getArgentMultisigConfig` at one
//! pinned block): the read, its bodies and its judging are
//! `wallet_core::accounts::multisig_read`; this module holds one behind a mutex for UniFFI and
//! passes Bramble's pinned class.

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use starknet_types_core::felt::Felt;
use wallet_core::accounts::multisig_read;

use crate::networks::NetworkId;
use crate::rpc_request::RpcRequest;
use crate::{multisig_constants, CoreError};

pub use wallet_core::accounts::multisig_read::MultisigAuthorityStatus;

/// Outcome of one authority read, as the extension's `ArgentMultisigAuthorityStatus` minus
/// `unsupported-signers`, which needs `SignerLinked` event discovery (deferred).
#[uniffi::remote(Enum)]
pub enum MultisigAuthorityStatus {
    Available,
    Undeployed,
    UnsupportedClass,
    InvalidConfig,
    NetworkUnavailable,
}

/// Reads one address's class, threshold and signer GUIDs at one pinned block.
#[derive(uniffi::Object)]
pub struct MultisigAuthorityRead {
    read: Mutex<multisig_read::MultisigAuthorityRead>,
}

impl MultisigAuthorityRead {
    /// Starts a read for a canonical, non-zero address.
    pub fn start(network: NetworkId, address: &str) -> Result<Self, CoreError> {
        let read = multisig_read::MultisigAuthorityRead::new(
            network,
            address,
            multisig_constants::argent_multisig_class(),
        )?;
        Ok(Self {
            read: Mutex::new(read),
        })
    }

    fn read(&self) -> MutexGuard<'_, multisig_read::MultisigAuthorityRead> {
        self.read.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The network this read targets.
    pub fn network(&self) -> NetworkId {
        self.read().network()
    }

    /// The canonical address this read targets.
    pub fn address(&self) -> String {
        self.read().address()
    }

    /// Threshold and ascending signer GUIDs, once the status is `Available`.
    pub fn authority(&self) -> Option<(u32, Vec<Felt>)> {
        self.read().authority()
    }
}

#[uniffi::export]
impl MultisigAuthorityRead {
    /// Starts a read of `address` on `network`; the address must be a non-zero felt.
    #[uniffi::constructor]
    pub fn new(network: NetworkId, address: String) -> Result<Arc<Self>, CoreError> {
        Self::start(network, &address).map(Arc::new)
    }

    /// The next request to send, or `None` once the status is decided.
    pub fn next_request(&self) -> Option<RpcRequest> {
        self.read().next_request()
    }

    /// Judges the response to the pending request. A body for any other id is refused and changes
    /// nothing; a malformed or failed answer settles `NetworkUnavailable`.
    pub fn accept_response(&self, id: u64, body: String) -> Result<(), CoreError> {
        Ok(self.read().accept_response(id, &body)?)
    }

    /// The host could not complete the pending request (timeout, TLS, HTTP status).
    pub fn transport_failed(&self, id: u64) {
        self.read().transport_failed(id);
    }

    /// The decided status, once there is one.
    pub fn status(&self) -> Option<MultisigAuthorityStatus> {
        self.read().status()
    }
}
