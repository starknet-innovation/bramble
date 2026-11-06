//! `BigInt(string)` as JavaScript evaluates it, for the felt helpers the extension builds on it
//! (`canonicalFelt`, `sameFelt`, `asFelt`, `tokenGlyph`'s tone). Only what those helpers need:
//! parsing, comparison, hex and decimal rendering.

use super::num::js_trim;

/// Longest trimmed input parsed. Every caller rejects anything this long (a felt has at most 66
/// characters, a u256 78 digits), so refusing it here only avoids quadratic work on hostile text.
const MAX_INPUT_CHARS: usize = 2_048;

/// A non-negative arbitrary-precision integer, little-endian base 2^32.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Big(Vec<u32>);

impl Big {
    pub fn zero() -> Self {
        Self(Vec::new())
    }

    fn trim(mut self) -> Self {
        while self.0.last() == Some(&0) {
            self.0.pop();
        }
        self
    }

    pub fn is_zero(&self) -> bool {
        self.0.iter().all(|limb| *limb == 0)
    }

    fn mul_add(&mut self, mul: u32, add: u32) {
        let mut carry = u64::from(add);
        for limb in &mut self.0 {
            let value = u64::from(*limb) * u64::from(mul) + carry;
            *limb = value as u32;
            carry = value >> 32;
        }
        if carry != 0 {
            self.0.push(carry as u32);
        }
    }

    /// Divides in place, returning the remainder.
    fn div_rem(&mut self, divisor: u32) -> u32 {
        let mut rem: u64 = 0;
        for limb in self.0.iter_mut().rev() {
            let value = (rem << 32) | u64::from(*limb);
            *limb = (value / u64::from(divisor)) as u32;
            rem = value % u64::from(divisor);
        }
        let trimmed = std::mem::take(&mut self.0);
        *self = Self(trimmed).trim();
        rem as u32
    }

    /// Bits needed to hold the value.
    pub fn bits(&self) -> usize {
        match self.0.iter().rposition(|limb| *limb != 0) {
            None => 0,
            Some(top) => top * 32 + (32 - self.0[top].leading_zeros() as usize),
        }
    }

    /// The value when it fits in 128 bits.
    pub fn to_u128(&self) -> Option<u128> {
        if self.bits() > 128 {
            return None;
        }
        Some(
            self.0
                .iter()
                .rev()
                .fold(0u128, |acc, limb| (acc << 32) | u128::from(*limb)),
        )
    }

    /// Lowercase hex without prefix (`0` for zero), as `bigint.toString(16)`.
    pub fn to_hex(&self) -> String {
        let trimmed = self.clone().trim();
        if trimmed.0.is_empty() {
            return "0".into();
        }
        let mut out = format!("{:x}", trimmed.0[trimmed.0.len() - 1]);
        for limb in trimmed.0.iter().rev().skip(1) {
            out.push_str(&format!("{limb:08x}"));
        }
        out
    }

    /// Base-10 digits, as `bigint.toString()`.
    pub fn to_decimal(&self) -> String {
        let mut value = self.clone().trim();
        if value.0.is_empty() {
            return "0".into();
        }
        let mut chunks = Vec::new();
        while !value.is_zero() {
            chunks.push(value.div_rem(1_000_000_000));
        }
        let mut out = chunks.pop().map(|c| c.to_string()).unwrap_or_default();
        for chunk in chunks.iter().rev() {
            out.push_str(&format!("{chunk:09}"));
        }
        out
    }

    fn cmp_value(&self, other: &Self) -> std::cmp::Ordering {
        let (a, b) = (self.clone().trim(), other.clone().trim());
        a.0.len()
            .cmp(&b.0.len())
            .then_with(|| a.0.iter().rev().cmp(b.0.iter().rev()))
    }
}

impl PartialOrd for Big {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Big {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.cmp_value(other)
    }
}

/// A parsed `BigInt(string)`: sign and magnitude.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JsBigInt {
    pub negative: bool,
    pub magnitude: Big,
}

impl JsBigInt {
    /// `bigint.toString(16)`, sign included (`-5` for minus five).
    pub fn to_hex_string(&self) -> String {
        let hex = self.magnitude.to_hex();
        if self.negative && !self.magnitude.is_zero() {
            format!("-{hex}")
        } else {
            hex
        }
    }
}

fn digits(text: &str, radix: u32) -> Option<Big> {
    if text.is_empty() {
        return None;
    }
    let mut value = Big::zero();
    for c in text.chars() {
        value.mul_add(radix, c.to_digit(radix)?);
    }
    Some(value.trim())
}

/// `BigInt(value)` for a string: JavaScript whitespace trimmed, empty is zero, `0x`/`0o`/`0b`
/// prefixes (either case, unsigned), otherwise an optionally signed decimal. `None` where
/// JavaScript throws a `SyntaxError` (and, as a bound, for inputs over 2048 characters).
pub fn parse_bigint(value: &str) -> Option<JsBigInt> {
    let text = js_trim(value);
    if text.chars().count() > MAX_INPUT_CHARS {
        return None;
    }
    if text.is_empty() {
        return Some(JsBigInt {
            negative: false,
            magnitude: Big::zero(),
        });
    }
    let bytes = text.as_bytes();
    if bytes.len() > 2 && bytes[0] == b'0' {
        let radix = match bytes[1] {
            b'x' | b'X' => Some(16),
            b'o' | b'O' => Some(8),
            b'b' | b'B' => Some(2),
            _ => None,
        };
        if let Some(radix) = radix {
            return digits(&text[2..], radix).map(|magnitude| JsBigInt {
                negative: false,
                magnitude,
            });
        }
    }
    let (negative, rest) = match text.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, text.strip_prefix('+').unwrap_or(text)),
    };
    digits(rest, 10).map(|magnitude| JsBigInt {
        negative,
        magnitude,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_like_javascript() {
        let hex = |v: &str| parse_bigint(v).map(|b| b.to_hex_string());
        assert_eq!(hex(""), Some("0".into()));
        assert_eq!(hex("  0x1F \n"), Some("1f".into()));
        assert_eq!(hex("0XAB"), Some("ab".into()));
        assert_eq!(hex("255"), Some("ff".into()));
        assert_eq!(hex("-5"), Some("-5".into()));
        assert_eq!(hex("+5"), Some("5".into()));
        assert_eq!(hex("0b101"), Some("5".into()));
        assert_eq!(hex("0o17"), Some("f".into()));
        for bad in ["0x", "-0x1", "1.5", "1e3", "abc", "0x1g", "--1", "1_000"] {
            assert_eq!(hex(bad), None, "{bad}");
        }
    }

    #[test]
    fn renders_and_compares() {
        let v = parse_bigint("340282366920938463463374607431768211456").unwrap();
        assert_eq!(v.magnitude.bits(), 129);
        assert_eq!(v.magnitude.to_u128(), None);
        assert_eq!(
            v.magnitude.to_decimal(),
            "340282366920938463463374607431768211456"
        );
        let small = parse_bigint(&u128::MAX.to_string()).unwrap().magnitude;
        assert!(small < v.magnitude);
        assert_eq!(small.to_u128(), Some(u128::MAX));
    }
}
