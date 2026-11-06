//! Judges privacy replies. Every reply is untrusted: bounded, parsed into a fixed shape, and never
//! echoed. Service text is read for one thing only, the extension's retry rule.
//!
//! The retry rule mirrors `official-sdk-errors.ts` `isRetryableStrk20ServiceError` applied to what
//! the SDK throws. A discovery failure is `Error("Indexer API <path> failed (<status>): <body>")`
//! (or `ReorgError("Block reorged during <path>: <body>")`), so the pattern
//! `/rate limit|too many requests|\bHTTP 429\b/i` can only match the body text: a bare 429 is not
//! retried. A pool-fee failure is a starknet.js `RpcError`: retried on code `-32005`, or when
//! `"<code> <message> <revert text>"` matches the same pattern.

use serde_json::Value;

use super::bodies::BlockRef;
use super::json::{Ordered, MAX_SAFE_INTEGER};
use crate::felt;

/// Longest privacy reply the core parses; hosts stop reading at this many bytes. 4,096 notes at
/// about 400 bytes each, plus cursor headroom.
pub const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;

fn is_word(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

fn has_bounded(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .enumerate()
        .any(|(start, window)| {
            let end = start + needle.len();
            window == needle
                && (start == 0 || !is_word(haystack[start - 1]))
                && (end == haystack.len() || !is_word(haystack[end]))
        })
}

/// `/rate limit|too many requests|\bHTTP 429\b/i` over text (ASCII case folding).
pub fn matches_retry(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    lower.contains("rate limit")
        || lower.contains("too many requests")
        || has_bounded(lower.as_bytes(), b"http 429")
}

/// Parses a 2xx body into an ordered value; `None` for oversized or malformed JSON.
pub fn parse_body(body: &[u8]) -> Option<Ordered> {
    if body.len() > MAX_RESPONSE_BYTES {
        return None;
    }
    serde_json::from_slice(body).ok()
}

/// A preflight reply's `sender_registered`: the SDK reads `!resp.sender_registered`, so absent or
/// `null` is unregistered; any other non-boolean is refused (stricter).
pub fn preflight_registered(reply: &Ordered) -> Option<bool> {
    let Ordered::Object(_) = reply else {
        return None;
    };
    match reply.get("sender_registered") {
        None | Some(Ordered::Null) => Some(false),
        Some(Ordered::Bool(value)) => Some(*value),
        Some(_) => None,
    }
}

/// A reply's `block_ref`, as the service's flat `BlockId` wire format writes it: a felt hash
/// string, a block number, or one of three tags. Anything else is refused.
pub fn block_ref(reply: &Ordered) -> Option<BlockRef> {
    match reply.get("block_ref")? {
        Ordered::Int(number) if *number <= MAX_SAFE_INTEGER => Some(BlockRef::Number(*number)),
        Ordered::Str(text)
            if matches!(text.as_str(), "latest" | "pre_confirmed" | "l1_accepted")
                || felt::parse(text).is_some() =>
        {
            Some(BlockRef::Text(text.clone()))
        }
        _ => None,
    }
}

/// A pool-fee reply.
#[derive(Debug, PartialEq, Eq)]
pub enum FeeAnswer {
    Fee(u128),
    Retryable,
    Failed,
}

fn revert_text(data: Option<&Value>) -> &str {
    match data {
        Some(Value::String(text)) => text,
        Some(Value::Object(fields)) => ["revert_error", "execution_error"]
            .iter()
            .find_map(|key| fields.get(*key).and_then(Value::as_str))
            .unwrap_or(""),
        _ => "",
    }
}

/// Judges a `get_fee_amount` reply: exactly one felt, at most `max_fee`.
pub fn pool_fee(body: &str, id: u64, max_fee: u128) -> FeeAnswer {
    if body.len() > crate::rpc::MAX_RESPONSE_BYTES {
        return FeeAnswer::Failed;
    }
    let Ok(value) = serde_json::from_str::<Value>(body) else {
        return FeeAnswer::Failed;
    };
    if value.get("jsonrpc").and_then(Value::as_str) != Some("2.0")
        || value.get("id").and_then(Value::as_u64) != Some(id)
    {
        return FeeAnswer::Failed;
    }
    if let Some(error) = value.get("error") {
        let code = error.get("code").and_then(Value::as_i64);
        let message = error.get("message").and_then(Value::as_str).unwrap_or("");
        let text = [
            code.map(|c| c.to_string()).unwrap_or_default(),
            message.to_string(),
            revert_text(error.get("data")).to_string(),
        ]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
        return if code == Some(-32005) || matches_retry(&text) {
            FeeAnswer::Retryable
        } else {
            FeeAnswer::Failed
        };
    }
    let fee = match value
        .get("result")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
    {
        Some([Value::String(text)]) if felt::parse(text).is_some() => {
            u128::from_str_radix(text.trim_start_matches("0x").trim_start_matches('0'), 16)
                .ok()
                .or_else(|| (felt::parse(text) == Some(Default::default())).then_some(0))
        }
        _ => None,
    };
    match fee {
        Some(fee) if fee <= max_fee => FeeAnswer::Fee(fee),
        _ => FeeAnswer::Failed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_pattern_matches_the_extension() {
        assert!(matches_retry("Rate limit exceeded"));
        assert!(matches_retry("{\"error\":\"Too Many Requests\"}"));
        assert!(matches_retry("upstream said HTTP 429."));
        assert!(!matches_retry("HTTP 4290"));
        assert!(!matches_retry("XHTTP 429"));
        assert!(!matches_retry("429"));
        assert!(!matches_retry(""));
    }

    #[test]
    fn block_refs_follow_the_service_wire_format() {
        let reply = |v: &str| -> Ordered {
            serde_json::from_str(&format!(r#"{{"block_ref":{v}}}"#)).unwrap()
        };
        assert_eq!(
            block_ref(&reply(r#""0xabc""#)),
            Some(BlockRef::Text("0xabc".into()))
        );
        assert_eq!(block_ref(&reply("12345")), Some(BlockRef::Number(12345)));
        assert_eq!(
            block_ref(&reply(r#""latest""#)),
            Some(BlockRef::Text("latest".into()))
        );
        for bad in [
            r#""pending""#,
            r#""0xZZ""#,
            "null",
            "true",
            r#"{"block_hash":"0x1"}"#,
        ] {
            assert_eq!(block_ref(&reply(bad)), None, "{bad}");
        }
    }

    #[test]
    fn pool_fee_shapes() {
        let ok = |r: &str| format!(r#"{{"jsonrpc":"2.0","id":4,"result":{r}}}"#);
        assert_eq!(
            pool_fee(&ok(r#"["0x53444835ec580000"]"#), 4, u128::MAX),
            FeeAnswer::Fee(0x53444835ec580000)
        );
        let max = format!(r#"["0x{}"]"#, "f".repeat(32));
        assert_eq!(pool_fee(&ok(&max), 4, u128::MAX), FeeAnswer::Fee(u128::MAX));
        let over = format!(r#"["0x1{}"]"#, "0".repeat(32));
        assert_eq!(pool_fee(&ok(&over), 4, u128::MAX), FeeAnswer::Failed);
        assert_eq!(
            pool_fee(&ok(r#"["0x1","0x0"]"#), 4, u128::MAX),
            FeeAnswer::Failed
        );
        assert_eq!(pool_fee(&ok(r#"["0x1"]"#), 5, u128::MAX), FeeAnswer::Failed);
        let throttled = r#"{"jsonrpc":"2.0","id":4,"error":{"code":-32005,"message":"x"}}"#;
        assert_eq!(pool_fee(throttled, 4, u128::MAX), FeeAnswer::Retryable);
        let text = r#"{"jsonrpc":"2.0","id":4,"error":{"code":1,"message":"Too many requests"}}"#;
        assert_eq!(pool_fee(text, 4, u128::MAX), FeeAnswer::Retryable);
        let other =
            r#"{"jsonrpc":"2.0","id":4,"error":{"code":21,"message":"Invalid message selector"}}"#;
        assert_eq!(pool_fee(other, 4, u128::MAX), FeeAnswer::Failed);
    }
}
