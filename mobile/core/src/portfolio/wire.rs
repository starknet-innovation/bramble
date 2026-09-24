//! The sans-IO wire contract: requests the core builds for the host to perform exactly as
//! described, what the host reports back, and how a JSON-RPC reply is classified. The host adds
//! no header, follows no redirect, sends no cookie or referrer, and never passes a truncated body.
//!
//! Bounds are the extension's (`HTTP_BODY_LIMITS`, `HTTP_REQUEST_TIMEOUT_MS`,
//! `RPC_BODY_LIMIT_BYTES`, `RPC_REQUEST_TIMEOUT_MS`, Starkscan's 8 s default); the parity fixture's
//! `limits` block pins each constant to the TypeScript value.

use serde_json::{json, Value};

use crate::js::json::{self, JsValue};

/// CoinGecko price and chart bodies (`HTTP_BODY_LIMITS.price`).
pub const PRICE_BODY_LIMIT: u64 = 512 * 1024;
/// Starkscan pages (`HTTP_BODY_LIMITS.starkscan`).
pub const STARKSCAN_BODY_LIMIT: u64 = 2 * 1024 * 1024;
/// JSON-RPC responses (`RPC_BODY_LIMIT_BYTES`).
pub const RPC_BODY_LIMIT: u64 = 32 * 1024 * 1024;
/// One untrusted exchange (`HTTP_REQUEST_TIMEOUT_MS`).
pub const HTTP_DEADLINE_MS: u64 = 15_000;
/// One JSON-RPC request (`RPC_REQUEST_TIMEOUT_MS`).
pub const RPC_DEADLINE_MS: u64 = 15_000;
/// One Starkscan exchange (`createStarkscanClient`'s default `timeoutMs`).
pub const STARKSCAN_DEADLINE_MS: u64 = 8_000;
/// A refusal body is only inspected when this short (`REFUSAL_BODY_LIMIT_BYTES`).
const REFUSAL_BODY_LIMIT: usize = 1024;
/// JSON-RPC rate-limit code (`RPC_RATE_LIMIT_CODE`).
const RPC_RATE_LIMIT_CODE: f64 = -32_005.0;

/// HTTP method of a request the core built.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum HttpMethod {
    Get,
    Post,
}

/// One request header.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct HttpHeader {
    pub name: String,
    pub value: String,
}

/// One exchange the host must perform exactly as described, within `deadline_ms` for the whole
/// exchange and aborting past `max_body_bytes`.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
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
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct HttpOutcome {
    pub status: u16,
    pub retry_after: Option<String>,
    pub body: Option<Vec<u8>>,
    pub timed_out: bool,
}

/// Bounds the host applies to every JSON-RPC exchange it performs for the core.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Record)]
pub struct RpcLimits {
    pub max_body_bytes: u64,
    pub deadline_ms: u64,
}

/// `RPC_BODY_LIMIT_BYTES` and `RPC_REQUEST_TIMEOUT_MS`, for the host's JSON-RPC transport.
#[uniffi::export]
pub fn rpc_limits() -> RpcLimits {
    RpcLimits {
        max_body_bytes: RPC_BODY_LIMIT,
        deadline_ms: RPC_DEADLINE_MS,
    }
}

/// One JSON-RPC call to POST to the endpoint currently in use.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct RpcCall {
    pub id: u64,
    pub body: String,
}

/// The endpoint's answer to one call: HTTP status and body, or `body: None` when nothing usable
/// arrived (transport failure, deadline, over-budget).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct RpcReply {
    pub id: u64,
    pub status: u16,
    pub body: Option<String>,
}

/// A JSON-RPC reply, classified as the extension's `isTransportRpcError` and `timedRpcFetch` do.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Reply {
    Result(JsValue),
    /// A JSON-RPC error with a numeric code: the node answered and refused this call.
    Semantic,
    /// This endpoint failed: move to the next one.
    Transport,
}

pub(crate) fn envelope(id: u64, method: &str, params: Value) -> String {
    json!({ "id": id, "jsonrpc": "2.0", "method": method, "params": params }).to_string()
}

pub(crate) fn rpc_call(id: u64, method: &str, params: Value) -> RpcCall {
    RpcCall {
        id,
        body: envelope(id, method, params),
    }
}

fn is_refusal(body: &str) -> bool {
    if body.len() > REFUSAL_BODY_LIMIT {
        return false;
    }
    json::parse(body).is_some_and(|value| match value.get("error") {
        Some(JsValue::String(_)) => true,
        Some(error) => error.get("code").and_then(JsValue::as_f64) == Some(RPC_RATE_LIMIT_CODE),
        None => false,
    })
}

// A JavaScript-truthy `error` member (starknet.js checks `if (error)`).
fn truthy(value: &JsValue) -> bool {
    match value {
        JsValue::Null => false,
        JsValue::Bool(b) => *b,
        JsValue::Number(n) => *n != 0.0 && !n.is_nan(),
        JsValue::String(s) => !s.is_empty(),
        _ => true,
    }
}

/// Classifies a reply to call `id`. A body that is not a JSON-RPC envelope answering `id` is a
/// transport-class failure (starknet.js throws a non-RPC error there, which `withRpcFallback`
/// fails over on); so is HTTP 429, a refusal body, or an error without a numeric code.
pub(crate) fn classify(reply: &RpcReply, id: u64) -> Reply {
    let Some(body) = reply.body.as_deref() else {
        return Reply::Transport;
    };
    if reply.id != id
        || reply.status == 429
        || body.len() as u64 > RPC_BODY_LIMIT
        || is_refusal(body)
    {
        return Reply::Transport;
    }
    let Some(value) = json::parse(body) else {
        return Reply::Transport;
    };
    if value.as_object().is_none() || value.get("id").and_then(JsValue::as_f64) != Some(id as f64) {
        return Reply::Transport;
    }
    if let Some(error) = value.get("error").filter(|e| truthy(e)) {
        return if error.get("code").and_then(JsValue::as_f64).is_some() {
            Reply::Semantic
        } else {
            Reply::Transport
        };
    }
    match value.get("result") {
        Some(result) => Reply::Result(result.clone()),
        None => Reply::Transport,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reply(status: u16, body: &str) -> RpcReply {
        RpcReply {
            id: 7,
            status,
            body: Some(body.into()),
        }
    }

    #[test]
    fn classifies_like_the_extension() {
        let ok = reply(200, r#"{"jsonrpc":"2.0","id":7,"result":["0x1"]}"#);
        assert!(matches!(classify(&ok, 7), Reply::Result(_)));
        assert_eq!(classify(&ok, 8), Reply::Transport);
        let semantic = reply(
            500,
            r#"{"jsonrpc":"2.0","id":7,"error":{"code":20,"message":"x"}}"#,
        );
        assert_eq!(classify(&semantic, 7), Reply::Semantic);
        let limited = reply(200, r#"{"jsonrpc":"2.0","id":7,"error":{"code":-32005}}"#);
        assert_eq!(classify(&limited, 7), Reply::Transport);
        assert_eq!(classify(&reply(429, "{}"), 7), Reply::Transport);
        assert_eq!(classify(&reply(502, "<html>"), 7), Reply::Transport);
        let no_code = reply(200, r#"{"jsonrpc":"2.0","id":7,"error":{"message":"x"}}"#);
        assert_eq!(classify(&no_code, 7), Reply::Transport);
        let none = RpcReply {
            id: 7,
            status: 0,
            body: None,
        };
        assert_eq!(classify(&none, 7), Reply::Transport);
    }
}
