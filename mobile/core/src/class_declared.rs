//! Whether the pinned Argent Multisig 0.2 class is declared on a network, as a sans-IO read (the
//! extension's `isArgentMultisigClassDeclared`): the read is
//! `wallet_core::accounts::multisig_declared`; this module holds one behind a mutex for UniFFI and
//! passes Bramble's pinned class.

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use wallet_core::accounts::multisig_declared;

use crate::networks::NetworkId;
use crate::rpc_request::RpcRequest;
use crate::{multisig_constants, CoreError};

/// Whether the pinned Argent Multisig 0.2 class is declared on a network. Only a class-not-found
/// answer (JSON-RPC 28) means `false`. Unlike the extension this does not yet re-hash the CASM
/// against the pinned compiled class hash: deployment is deferred, and this only drives a warning.
#[derive(uniffi::Object)]
pub struct ClassDeclaredRead {
    read: Mutex<multisig_declared::ClassDeclaredRead>,
}

impl ClassDeclaredRead {
    fn read(&self) -> MutexGuard<'_, multisig_declared::ClassDeclaredRead> {
        self.read.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[uniffi::export]
impl ClassDeclaredRead {
    /// Starts a class-declared read on `network`.
    #[uniffi::constructor]
    pub fn new(network: NetworkId) -> Arc<Self> {
        Arc::new(Self {
            read: Mutex::new(multisig_declared::ClassDeclaredRead::new(
                network,
                multisig_constants::argent_multisig_class(),
            )),
        })
    }

    /// The next request, or `None` once decided.
    pub fn next_request(&self) -> Option<RpcRequest> {
        self.read().next_request()
    }

    /// Judges the pending response; any other id is refused.
    pub fn accept_response(&self, id: u64, body: String) -> Result<(), CoreError> {
        Ok(self.read().accept_response(id, &body)?)
    }

    /// The host could not complete the pending request.
    pub fn transport_failed(&self, id: u64) {
        self.read().transport_failed(id);
    }

    /// Whether the read has settled (including as unavailable).
    pub fn finished(&self) -> bool {
        self.read().finished()
    }

    /// `Some(declared)` once known; `None` while pending or when the network was unavailable.
    pub fn declared(&self) -> Option<bool> {
        self.read().declared()
    }
}
