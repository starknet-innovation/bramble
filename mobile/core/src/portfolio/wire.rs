//! The sans-IO wire contract (`wallet_core::portfolio::wire`): requests the core builds for the
//! host to perform exactly as described, what the host reports back, and how a JSON-RPC reply is
//! classified. The host adds no header, follows no redirect, sends no cookie or referrer, and
//! never passes a truncated body. The types are the core's; their UniFFI shapes are declared here.

pub(crate) use crate::rpc_request::RpcRequest;
pub use wallet_core::portfolio::wire::{
    HttpHeader, HttpMethod, HttpOutcome, HttpRequest, RpcLimits, RpcReply,
};

/// HTTP method of a request the core built.
#[uniffi::remote(Enum)]
pub enum HttpMethod {
    Get,
    Post,
}

/// One request header.
#[uniffi::remote(Record)]
pub struct HttpHeader {
    pub name: String,
    pub value: String,
}

/// One exchange the host must perform exactly as described, within `deadline_ms` for the whole
/// exchange and aborting past `max_body_bytes`.
#[uniffi::remote(Record)]
pub struct HttpRequest {
    pub method: HttpMethod,
    pub url: String,
    pub headers: Vec<HttpHeader>,
    pub body: Option<String>,
    pub max_body_bytes: u64,
    pub deadline_ms: u64,
}

/// What the host saw. `body` is `None` for a transport failure, a deadline, a refused redirect
/// or an over-budget body (then `status` is whatever arrived, or 0); `timed_out` marks a deadline.
#[uniffi::remote(Record)]
pub struct HttpOutcome {
    pub status: u16,
    pub retry_after: Option<String>,
    pub body: Option<Vec<u8>>,
    pub timed_out: bool,
}

/// Bounds the host applies to every JSON-RPC exchange it performs for the core.
#[uniffi::remote(Record)]
pub struct RpcLimits {
    pub max_body_bytes: u64,
    pub deadline_ms: u64,
}

/// `RPC_BODY_LIMIT_BYTES` and `RPC_REQUEST_TIMEOUT_MS`, for the host's JSON-RPC transport.
#[uniffi::export]
pub fn rpc_limits() -> RpcLimits {
    wallet_core::portfolio::wire::rpc_limits()
}

/// The endpoint's answer to one call: HTTP status and body, or `body: None` when nothing usable
/// arrived (transport failure, deadline, over-budget).
#[uniffi::remote(Record)]
pub struct RpcReply {
    pub id: u64,
    pub status: u16,
    pub body: Option<String>,
}
