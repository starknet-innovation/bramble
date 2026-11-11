//! The host's transport contract: one JSON-RPC body to POST and the reply it read. The records
//! are `wallet_core::rpc::{Request, Response}`, with the RPC mechanism (bodies, judging, the
//! response bound); their UniFFI shapes are declared here. The host moves the bytes with its
//! platform HTTP stack (URLSession / OkHttp), so TLS, proxies, and certificate policy stay with
//! the operating system and no network code runs in Rust.

pub use wallet_core::rpc::{Request as RpcRequest, Response as RpcResponse};

/// One JSON-RPC body for the host to POST, with the largest reply the core will judge for it.
/// The host's one transport stops reading and reports a transport failure past
/// `max_response_bytes`, so a hostile endpoint cannot make the app buffer an unbounded body
/// before the core's own size check runs.
#[uniffi::remote(Record)]
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

/// A response body the host received for one request.
#[uniffi::remote(Record)]
pub struct RpcResponse {
    pub id: u64,
    pub body: String,
}
