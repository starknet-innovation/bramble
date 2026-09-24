//! The unsigned 256-bit arithmetic the send path needs and nothing more: ERC-20 amounts are
//! u256 on chain, and a fee's maximum spend (Σ u64 × u128 over three resources, then × 3 for the
//! reviewed-fee ceiling) exceeds u128. Every operation is checked; nothing wraps.

use std::cmp::Ordering;

/// A 256-bit unsigned integer as two u128 limbs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct U256 {
    pub high: u128,
    pub low: u128,
}

impl Ord for U256 {
    fn cmp(&self, other: &Self) -> Ordering {
        (self.high, self.low).cmp(&(other.high, other.low))
    }
}

impl PartialOrd for U256 {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl U256 {
    pub const ZERO: Self = Self { high: 0, low: 0 };

    pub fn from_u128(value: u128) -> Self {
        Self {
            high: 0,
            low: value,
        }
    }

    /// The full 256-bit product of two u128 values.
    pub fn product(a: u128, b: u128) -> Self {
        const MASK: u128 = u64::MAX as u128;
        let (a1, a0) = (a >> 64, a & MASK);
        let (b1, b0) = (b >> 64, b & MASK);
        let (p00, p01, p10, p11) = (a0 * b0, a0 * b1, a1 * b0, a1 * b1);
        let (low, carry1) = p00.overflowing_add(p01 << 64);
        let (low, carry2) = low.overflowing_add(p10 << 64);
        let high = p11 + (p01 >> 64) + (p10 >> 64) + u128::from(carry1) + u128::from(carry2);
        Self { high, low }
    }

    pub fn checked_add(self, other: Self) -> Option<Self> {
        let (low, carry) = self.low.overflowing_add(other.low);
        let high = self
            .high
            .checked_add(other.high)?
            .checked_add(u128::from(carry))?;
        Some(Self { high, low })
    }

    pub fn checked_mul_small(self, factor: u64) -> Option<Self> {
        let low = Self::product(self.low, u128::from(factor));
        let high = self.high.checked_mul(u128::from(factor))?;
        Some(Self {
            high: high.checked_add(low.high)?,
            low: low.low,
        })
    }

    /// Parses a base-10 integer (digits only, at most 78 of them) without wrapping.
    pub fn from_decimal(text: &str) -> Option<Self> {
        if text.is_empty() || text.len() > 78 || !text.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        text.bytes().try_fold(Self::ZERO, |value, digit| {
            value
                .checked_mul_small(10)?
                .checked_add(Self::from_u128(u128::from(digit - b'0')))
        })
    }

    /// Base-10 spelling, no leading zeros.
    pub fn to_decimal(self) -> String {
        crate::rpc::u256_to_decimal(self.low, self.high)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn products_are_exact() {
        let max = U256::product(u128::MAX, u128::MAX);
        assert_eq!(
            max,
            U256 {
                high: u128::MAX - 1,
                low: 1
            }
        );
        assert_eq!(U256::product(1 << 64, 1 << 64), U256 { high: 1, low: 0 });
        assert_eq!(U256::product(12, 11), U256::from_u128(132));
    }

    #[test]
    fn decimal_round_trip_and_overflow() {
        let max = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
        assert_eq!(U256::from_decimal(max).unwrap().to_decimal(), max);
        let over = "115792089237316195423570985008687907853269984665640564039457584007913129639936";
        assert_eq!(U256::from_decimal(over), None);
        assert_eq!(U256::from_decimal("0").unwrap(), U256::ZERO);
        assert_eq!(U256::from_decimal(""), None);
        assert_eq!(U256::from_decimal("1a"), None);
        assert!(U256::from_u128(u128::MAX)
            .checked_add(U256::from_u128(1))
            .is_some_and(|v| v == U256 { high: 1, low: 0 }));
        assert_eq!(
            U256 {
                high: u128::MAX,
                low: 0
            }
            .checked_mul_small(2),
            None
        );
    }
}
