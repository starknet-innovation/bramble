//! Whether the pinned Argent Multisig 0.2 class is declared on a network, as a sans-IO read
//! (the extension's `isArgentMultisigClassDeclared` in `packages/features/multisig/src/deploy.ts`).

use std::sync::Mutex;

use serde_json::json;

use crate::multisig_rpc::{envelope, judge, strict_felt, Answer, RpcRequest};
use crate::networks::{self, NetworkId};
use crate::{argent_multisig, felt, CoreError};

/// A class definition is large; this bound applies to the class-declared read only.
const MAX_CLASS_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
const CLASS_HASH_NOT_FOUND: i64 = 28;

#[derive(Clone, Copy)]
enum ClassPhase {
    ChainId,
    GetClass,
    Done(Option<bool>),
}

/// Whether the pinned Argent Multisig 0.2 class is declared on a network. Only a class-not-found
/// answer (JSON-RPC 28) means `false`. Unlike the extension this does not yet re-hash the CASM
/// against the pinned compiled class hash: deployment is deferred, and this only drives a warning.
#[derive(uniffi::Object)]
pub struct ClassDeclaredRead {
    network: NetworkId,
    state: Mutex<(ClassPhase, Option<u64>, u64)>,
}

#[uniffi::export]
impl ClassDeclaredRead {
    /// Starts a class-declared read on `network`.
    #[uniffi::constructor]
    pub fn new(network: NetworkId) -> std::sync::Arc<Self> {
        std::sync::Arc::new(Self {
            network,
            state: Mutex::new((ClassPhase::ChainId, None, 1)),
        })
    }

    /// The next request, or `None` once decided.
    pub fn next_request(&self) -> Option<RpcRequest> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let (method, params) = match state.0 {
            ClassPhase::ChainId => ("starknet_chainId", json!([])),
            ClassPhase::GetClass => (
                "starknet_getClass",
                json!({ "block_id": "latest", "class_hash": argent_multisig::class_hash() }),
            ),
            ClassPhase::Done(_) => return None,
        };
        let id = state.1.unwrap_or(state.2);
        if state.1.is_none() {
            state.1 = Some(id);
            state.2 += 1;
        }
        Some(RpcRequest {
            id,
            body: envelope(id, method, params),
            max_response_bytes: MAX_CLASS_RESPONSE_BYTES as u64,
        })
    }

    /// Judges the pending response; any other id is refused.
    pub fn accept_response(&self, id: u64, body: String) -> Result<(), CoreError> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.1 != Some(id) {
            return Err(CoreError::Rpc {
                reason: "response does not answer this request".into(),
            });
        }
        state.1 = None;
        state.0 = match (state.0, judge(&body, id, MAX_CLASS_RESPONSE_BYTES)) {
            (ClassPhase::ChainId, Answer::Result(chain)) => {
                let expected = &networks::info(self.network).chain_id;
                match strict_felt(&chain) {
                    Some(chain) if &felt::canonical(&chain) == expected => ClassPhase::GetClass,
                    _ => ClassPhase::Done(None),
                }
            }
            (ClassPhase::GetClass, Answer::Result(class)) if class.is_object() => {
                ClassPhase::Done(Some(true))
            }
            (ClassPhase::GetClass, Answer::NodeError(CLASS_HASH_NOT_FOUND)) => {
                ClassPhase::Done(Some(false))
            }
            _ => ClassPhase::Done(None),
        };
        Ok(())
    }

    /// The host could not complete the pending request.
    pub fn transport_failed(&self, id: u64) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.1 == Some(id) {
            state.1 = None;
            state.0 = ClassPhase::Done(None);
        }
    }

    /// Whether the read has settled (including as unavailable).
    pub fn finished(&self) -> bool {
        matches!(
            self.state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .0,
            ClassPhase::Done(_)
        )
    }

    /// `Some(declared)` once known; `None` while pending or when the network was unavailable.
    pub fn declared(&self) -> Option<bool> {
        match self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .0
        {
            ClassPhase::Done(declared) => declared,
            _ => None,
        }
    }
}
