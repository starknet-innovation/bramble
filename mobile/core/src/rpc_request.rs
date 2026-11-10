//! The host's transport contract: one JSON-RPC body to POST and the reply it read. The RPC
//! mechanism itself (bodies, judging, the response bound) is `wallet_core::rpc`; these records
//! are mobile's FFI around it. The host moves the bytes with its platform HTTP stack
//! (URLSession / OkHttp), so TLS, proxies, and certificate policy stay with the operating system
//! and no network code runs in Rust.

use crate::rpc::MAX_RESPONSE_BYTES;
use crate::CoreError;

/// One JSON-RPC body for the host to POST, with the largest reply the core will judge for it.
/// The host's one transport stops reading and reports a transport failure past
/// `max_response_bytes`, so a hostile endpoint cannot make the app buffer an unbounded body
/// before the core's own size check runs.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct RpcRequest {
    pub id: u64,
    pub body: String,
    pub max_response_bytes: u64,
    /// An advisory read the core can do without: when its POST fails (a timeout, a non-200
    /// status, a reply past `max_response_bytes`), the host answers it with an empty body instead
    /// of failing the batch, and the core judges that as no answer.
    #[uniffi(default = false)]
    pub optional: bool,
}

impl RpcRequest {
    /// A request whose reply is bounded by the core's default `MAX_RESPONSE_BYTES`.
    pub(crate) fn new(id: u64, body: String) -> Self {
        Self::bounded(id, body, MAX_RESPONSE_BYTES)
    }

    /// A request whose reply may be up to `max_bytes` (a class definition, for example).
    pub(crate) fn bounded(id: u64, body: String, max_bytes: usize) -> Self {
        Self {
            id,
            body,
            max_response_bytes: max_bytes as u64,
            optional: false,
        }
    }

    /// An advisory read whose transport failure the host answers with an empty body.
    pub(crate) fn optional(id: u64, body: String, max_bytes: usize) -> Self {
        Self {
            optional: true,
            ..Self::bounded(id, body, max_bytes)
        }
    }
}

/// A response body the host received for one request.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct RpcResponse {
    pub id: u64,
    pub body: String,
}

pub(crate) fn rpc_error(reason: &str) -> CoreError {
    CoreError::Rpc {
        reason: reason.into(),
    }
}
