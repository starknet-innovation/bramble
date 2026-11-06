//! The extension's fee policy, integer-exact: starknet.js `toOverheadResourceBounds` (+50% on
//! every amount and price, `x + x*50/100`), `feeBoundsMaxSpend` (Σ amount × price over the
//! signed bounds), `nodeFeeEstimate`'s unit rule, `exceedsReviewedFee`'s 3/2 headroom, and
//! `formatFeeEstimate`. Krusty's `MaxBound::from_estimate` is not used: it scales in f64 and caps
//! prices at u64, which would sign different bounds from the extension.

use krusty_kms::ResourceBounds;
use serde_json::Value;

use super::types::{FeeAmount, FeeUnit};
use super::u256::U256;

/// `REVIEWED_FEE_HEADROOM`: a submit-time spend may reach 3/2 of the reviewed spend.
pub const HEADROOM_NUMERATOR: u64 = 3;
pub const HEADROOM_DENOMINATOR: u64 = 2;

/// One resource's signed bound, before the u64 check Krusty's `ResourceBounds` needs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bound {
    pub max_amount: u128,
    pub max_price_per_unit: u128,
}

/// The three resource bounds a v3 transaction signs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bounds {
    pub l1_gas: Bound,
    pub l2_gas: Bound,
    pub l1_data_gas: Bound,
}

/// A fee as the spend its bounds authorise.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FeeQuote {
    pub spend: U256,
    pub unit: FeeUnit,
}

/// Why an estimate entry cannot become signed bounds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FeeRefusal {
    /// A field is missing or not an integer.
    Malformed,
    /// A bound does not fit u64 (amount) / u128 (price) after the margin.
    BoundsOutOfRange,
    /// The unit is present but neither FRI nor WEI.
    UnrecognisedUnit,
}

// starknet.js `integerOf`: `0x`-hex (any case) or decimal text, or a safe JSON integer.
fn quantity(value: Option<&Value>) -> Result<u128, FeeRefusal> {
    match value {
        Some(Value::String(text)) => {
            let parsed = match text.strip_prefix("0x") {
                Some(hex) if !hex.is_empty() && hex.bytes().all(|b| b.is_ascii_hexdigit()) => {
                    let significant = hex.trim_start_matches('0');
                    if significant.len() > 32 {
                        return Err(FeeRefusal::BoundsOutOfRange);
                    }
                    u128::from_str_radix(
                        if significant.is_empty() {
                            "0"
                        } else {
                            significant
                        },
                        16,
                    )
                    .map_err(|_| FeeRefusal::Malformed)
                }
                Some(_) => Err(FeeRefusal::Malformed),
                None if !text.is_empty() && text.bytes().all(|b| b.is_ascii_digit()) => text
                    .parse::<u128>()
                    .map_err(|_| FeeRefusal::BoundsOutOfRange),
                None => Err(FeeRefusal::Malformed),
            };
            parsed
        }
        Some(Value::Number(number)) => number
            .as_u64()
            .filter(|n| *n < (1u64 << 53))
            .map(u128::from)
            .ok_or(FeeRefusal::Malformed),
        _ => Err(FeeRefusal::Malformed),
    }
}

// `addPercent(x, 50)` = x + floor(x*50/100) = x + floor(x/2), without the intermediate overflow.
fn with_margin(value: u128) -> Result<u128, FeeRefusal> {
    value
        .checked_add(value / 2)
        .ok_or(FeeRefusal::BoundsOutOfRange)
}

fn bound(entry: &Value, consumed: &str, price: &str) -> Result<Bound, FeeRefusal> {
    Ok(Bound {
        max_amount: with_margin(quantity(entry.get(consumed))?)?,
        max_price_per_unit: with_margin(quantity(entry.get(price))?)?,
    })
}

/// `nodeFeeEstimate`'s unit rule: absent (or not a string) reads as FRI; FRI and WEI are
/// accepted; anything else is refused.
fn unit(entry: &Value) -> Result<FeeUnit, FeeRefusal> {
    match entry.get("unit").and_then(Value::as_str) {
        None | Some("FRI") => Ok(FeeUnit::Fri),
        Some("WEI") => Ok(FeeUnit::Wei),
        Some(_) => Err(FeeRefusal::UnrecognisedUnit),
    }
}

/// Signed bounds and authorised spend from one RPC 0.10 `FEE_ESTIMATE` entry.
pub fn quote(entry: &Value) -> Result<(Bounds, FeeQuote), FeeRefusal> {
    let unit = unit(entry)?;
    let bounds = Bounds {
        l1_gas: bound(entry, "l1_gas_consumed", "l1_gas_price")?,
        l2_gas: bound(entry, "l2_gas_consumed", "l2_gas_price")?,
        l1_data_gas: bound(entry, "l1_data_gas_consumed", "l1_data_gas_price")?,
    };
    let spend = [bounds.l1_gas, bounds.l2_gas, bounds.l1_data_gas]
        .iter()
        .try_fold(U256::ZERO, |total, b| {
            total.checked_add(U256::product(b.max_amount, b.max_price_per_unit))
        })
        .ok_or(FeeRefusal::BoundsOutOfRange)?;
    Ok((bounds, FeeQuote { spend, unit }))
}

/// Krusty's bounds, refusing an amount above u64 rather than letting it truncate.
pub fn krusty_bounds(
    bounds: &Bounds,
) -> Result<(ResourceBounds, ResourceBounds, ResourceBounds), FeeRefusal> {
    let convert = |b: Bound| {
        Ok(ResourceBounds {
            max_amount: u64::try_from(b.max_amount).map_err(|_| FeeRefusal::BoundsOutOfRange)?,
            max_price_per_unit: b.max_price_per_unit,
        })
    };
    Ok((
        convert(bounds.l1_gas)?,
        convert(bounds.l2_gas)?,
        convert(bounds.l1_data_gas)?,
    ))
}

/// `exceedsReviewedFee`: a unit change, or `actual × 2 > reviewed × 3`.
pub fn exceeds_reviewed(reviewed: &FeeQuote, quoted: &FeeQuote) -> bool {
    if reviewed.unit != quoted.unit {
        return true;
    }
    match (
        quoted.spend.checked_mul_small(HEADROOM_DENOMINATOR),
        reviewed.spend.checked_mul_small(HEADROOM_NUMERATOR),
    ) {
        (Some(actual), Some(ceiling)) => actual > ceiling,
        _ => true,
    }
}

/// `formatFri`: the integer part, then at most six fraction digits (truncated, trailing zeros
/// removed), then " STRK".
pub fn format_fri(raw: &U256) -> String {
    let digits = format!("{:0>19}", raw.to_decimal());
    let (whole, fraction) = digits.split_at(digits.len() - 18);
    let whole = whole.trim_start_matches('0');
    let whole = if whole.is_empty() { "0" } else { whole };
    let fraction = fraction[..6].trim_end_matches('0');
    if fraction.is_empty() {
        format!("{whole} STRK")
    } else {
        format!("{whole}.{fraction} STRK")
    }
}

/// `formatFeeEstimate`: FRI as STRK, any other unit as "<n> <UNIT>".
pub fn fee_amount(quote: &FeeQuote) -> FeeAmount {
    let display = match quote.unit {
        FeeUnit::Fri => format_fri(&quote.spend),
        FeeUnit::Wei => format!("{} WEI", quote.spend.to_decimal()),
    };
    FeeAmount {
        max_spend: quote.spend.to_decimal(),
        unit: quote.unit,
        display,
    }
}

/// `sumFeeEstimates`: like units only.
pub fn sum(left: &FeeQuote, right: &FeeQuote) -> Option<FeeQuote> {
    (left.unit == right.unit).then_some(())?;
    Some(FeeQuote {
        spend: left.spend.checked_add(right.spend)?,
        unit: left.unit,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn margin_is_integer_floor() {
        assert_eq!(with_margin(3), Ok(4));
        assert_eq!(
            with_margin(u128::MAX / 3 * 2),
            Ok(u128::MAX / 3 * 2 + u128::MAX / 3)
        );
        assert_eq!(with_margin(u128::MAX), Err(FeeRefusal::BoundsOutOfRange));
    }

    #[test]
    fn units_and_malformed_entries() {
        let entry = json!({"l1_gas_consumed":"0x1","l1_gas_price":"0x1","l2_gas_consumed":"0x1",
            "l2_gas_price":"0x1","l1_data_gas_consumed":"0x1","l1_data_gas_price":"0x1","unit":"STRK"});
        assert_eq!(quote(&entry), Err(FeeRefusal::UnrecognisedUnit));
        let mut missing = entry.clone();
        missing["unit"] = json!("FRI");
        missing.as_object_mut().unwrap().remove("l2_gas_price");
        assert_eq!(quote(&missing), Err(FeeRefusal::Malformed));
    }

    #[test]
    fn ceiling_is_three_halves() {
        let q = |spend: u128, unit| FeeQuote {
            spend: U256::from_u128(spend),
            unit,
        };
        assert!(!exceeds_reviewed(
            &q(1000, FeeUnit::Fri),
            &q(1500, FeeUnit::Fri)
        ));
        assert!(exceeds_reviewed(
            &q(1000, FeeUnit::Fri),
            &q(1501, FeeUnit::Fri)
        ));
        assert!(exceeds_reviewed(
            &q(1000, FeeUnit::Fri),
            &q(1000, FeeUnit::Wei)
        ));
        assert_eq!(format_fri(&U256::from_u128(999)), "0 STRK");
        assert_eq!(
            format_fri(&U256::from_u128(1_000_000_000_000_000_000)),
            "1 STRK"
        );
    }
}
