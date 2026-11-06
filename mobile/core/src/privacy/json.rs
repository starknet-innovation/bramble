//! JSON helpers for byte parity with the SDK's `JSON.stringify` bodies.
//!
//! The discovery cursor is echoed back to the service exactly as the SDK does: `JSON.parse` keeps
//! object keys in document order and `JSON.stringify` writes them back compactly. `Ordered` keeps
//! that order (serde's `Value` sorts keys). To stay exact, numbers are limited to safe integers
//! (what `JSON.stringify` of a parsed integer reproduces digit for digit) and duplicate keys are
//! refused; either is `InvalidResponse`, a documented deviation (docs/privacy.md §3).
//!
//! `js_bigint` mirrors the `BigInt(...)` coercions the SDK applies to service values, over a fixed
//! grammar: decimal or `0x` hex text, or a safe non-negative integer. It yields a `U256`; a value
//! that does not fit is at least 2^256 and so refused by every caller's `< P` bound anyway.

use std::fmt;

use serde::de::{self, Deserialize, Deserializer, MapAccess, SeqAccess, Visitor};

use crate::send::u256::U256;

/// Largest integer `JSON.parse` represents exactly (`Number.MAX_SAFE_INTEGER`).
pub const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

/// A JSON value that keeps object keys in document order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Ordered {
    Null,
    Bool(bool),
    Int(u64),
    Str(String),
    Array(Vec<Ordered>),
    Object(Vec<(String, Ordered)>),
}

impl Ordered {
    /// A member of an object, by key.
    pub fn get(&self, key: &str) -> Option<&Ordered> {
        match self {
            Self::Object(members) => members.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    /// `JSON.stringify` of this value.
    pub fn write(&self, out: &mut String) {
        match self {
            Self::Null => out.push_str("null"),
            Self::Bool(value) => out.push_str(if *value { "true" } else { "false" }),
            Self::Int(value) => out.push_str(&value.to_string()),
            Self::Str(value) => write_str(out, value),
            Self::Array(items) => {
                out.push('[');
                for (index, item) in items.iter().enumerate() {
                    if index > 0 {
                        out.push(',');
                    }
                    item.write(out);
                }
                out.push(']');
            }
            Self::Object(members) => {
                out.push('{');
                for (index, (key, value)) in members.iter().enumerate() {
                    if index > 0 {
                        out.push(',');
                    }
                    write_str(out, key);
                    out.push(':');
                    value.write(out);
                }
                out.push('}');
            }
        }
    }
}

/// A JSON string literal as `JSON.stringify` writes it (serde_json's escaping is the same:
/// `\"`, `\\`, `\b\f\n\r\t`, other controls as lowercase `\u00xx`, nothing else escaped).
pub fn write_str(out: &mut String, value: &str) {
    out.push_str(&serde_json::to_string(value).unwrap_or_else(|_| "\"\"".into()));
}

struct OrderedVisitor;

impl<'de> Visitor<'de> for OrderedVisitor {
    type Value = Ordered;

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("JSON with safe-integer numbers and unique keys")
    }

    fn visit_unit<E: de::Error>(self) -> Result<Ordered, E> {
        Ok(Ordered::Null)
    }

    fn visit_none<E: de::Error>(self) -> Result<Ordered, E> {
        Ok(Ordered::Null)
    }

    fn visit_bool<E: de::Error>(self, value: bool) -> Result<Ordered, E> {
        Ok(Ordered::Bool(value))
    }

    fn visit_u64<E: de::Error>(self, value: u64) -> Result<Ordered, E> {
        if value > MAX_SAFE_INTEGER {
            return Err(E::custom("unsafe integer"));
        }
        Ok(Ordered::Int(value))
    }

    fn visit_i64<E: de::Error>(self, value: i64) -> Result<Ordered, E> {
        u64::try_from(value)
            .map_err(|_| E::custom("negative number"))
            .and_then(|v| self.visit_u64(v))
    }

    fn visit_f64<E: de::Error>(self, _: f64) -> Result<Ordered, E> {
        Err(E::custom("fractional number"))
    }

    fn visit_str<E: de::Error>(self, value: &str) -> Result<Ordered, E> {
        Ok(Ordered::Str(value.to_string()))
    }

    fn visit_string<E: de::Error>(self, value: String) -> Result<Ordered, E> {
        Ok(Ordered::Str(value))
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Ordered, A::Error> {
        let mut items = Vec::new();
        while let Some(item) = seq.next_element::<Ordered>()? {
            items.push(item);
        }
        Ok(Ordered::Array(items))
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Ordered, A::Error> {
        let mut members: Vec<(String, Ordered)> = Vec::new();
        while let Some((key, value)) = map.next_entry::<String, Ordered>()? {
            if members.iter().any(|(existing, _)| *existing == key) {
                return Err(de::Error::custom("duplicate key"));
            }
            members.push((key, value));
        }
        Ok(Ordered::Object(members))
    }
}

impl<'de> Deserialize<'de> for Ordered {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(OrderedVisitor)
    }
}

fn from_hex(digits: &str) -> Option<U256> {
    if digits.is_empty() || digits.len() > 64 || !digits.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let split = digits.len().saturating_sub(32);
    let (high, low) = digits.split_at(split);
    Some(U256 {
        high: if high.is_empty() {
            0
        } else {
            u128::from_str_radix(high, 16).ok()?
        },
        low: u128::from_str_radix(low, 16).ok()?,
    })
}

/// `BigInt(value)` for a non-negative service value, over the fixed grammar above.
pub fn js_bigint(value: &Ordered) -> Option<U256> {
    match value {
        Ordered::Int(n) => Some(U256::from_u128(u128::from(*n))),
        Ordered::Str(text) => match text.strip_prefix("0x").or_else(|| text.strip_prefix("0X")) {
            Some(digits) => from_hex(digits.trim_start_matches('0')).or_else(|| {
                (!digits.is_empty() && digits.bytes().all(|b| b == b'0')).then_some(U256::ZERO)
            }),
            None => U256::from_decimal(text.trim_start_matches('0')).or_else(|| {
                (!text.is_empty() && text.bytes().all(|b| b == b'0')).then_some(U256::ZERO)
            }),
        },
        _ => None,
    }
}

/// The Stark field prime `P = 2^251 + 17·2^192 + 1`.
pub const FIELD_PRIME: U256 = U256 {
    high: (1 << 123) + (17 << 64),
    low: 1,
};

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(text: &str) -> Option<Ordered> {
        serde_json::from_str(text).ok()
    }

    #[test]
    fn keeps_document_order_and_writes_like_json_stringify() {
        let text = r#"{ "z": 1, "a": {"y": [true, null, "x\n"], "b": false} }"#;
        let mut out = String::new();
        parse(text).unwrap().write(&mut out);
        assert_eq!(out, r#"{"z":1,"a":{"y":[true,null,"x\n"],"b":false}}"#);
    }

    #[test]
    fn refuses_what_json_stringify_would_respell() {
        for text in [
            r#"{"a":1.5}"#,
            r#"{"a":1.0}"#,
            r#"{"a":-1}"#,
            r#"{"a":9007199254740992}"#,
            r#"{"a":1,"a":2}"#,
        ] {
            assert_eq!(parse(text), None, "{text}");
        }
        assert_eq!(
            parse("9007199254740991"),
            Some(Ordered::Int(MAX_SAFE_INTEGER))
        );
    }

    #[test]
    fn bigint_grammar() {
        let big = |t: &str| js_bigint(&Ordered::Str(t.into()));
        assert_eq!(big("1000"), Some(U256::from_u128(1000)));
        assert_eq!(big("0x3e8"), Some(U256::from_u128(1000)));
        assert_eq!(big("0X3E8"), Some(U256::from_u128(1000)));
        assert_eq!(big("0"), Some(U256::ZERO));
        assert_eq!(big("0x0"), Some(U256::ZERO));
        assert_eq!(big("0x000001"), Some(U256::from_u128(1)));
        for bad in ["", "0x", "-1", " 1", "1e3", "0xg"] {
            assert_eq!(big(bad), None, "{bad:?}");
        }
        assert_eq!(js_bigint(&Ordered::Int(7)), Some(U256::from_u128(7)));
        assert_eq!(js_bigint(&Ordered::Bool(true)), None);
        let p = big("0x800000000000011000000000000000000000000000000000000000000000001");
        assert_eq!(p, Some(FIELD_PRIME));
    }
}
