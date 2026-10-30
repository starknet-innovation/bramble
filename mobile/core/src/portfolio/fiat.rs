//! Fiat and amount presentation, ported from the side panel's `shared/fiat.ts`,
//! `portfolio/token-row.ts` (`compactAmount`, the change badge), `home-view.ts` (the hero line)
//! and `portfolio/sparkline.ts`. Pure: the host renders the strings it gets back.

use std::sync::OnceLock;

use super::model::{DisplayCurrency, TokenBalance};
use super::prices::PriceView;
use crate::js::num::{
    is_js_whitespace, locale_grouped_2, math_round, number_to_string, string_to_number, to_fixed,
};
use crate::js::regex::Regex;

/// `formatFiat`: glyph, grouped thousands, two decimals; `<0.01` for dust; `0.00` for zero,
/// negative or non-finite input.
#[uniffi::export]
pub fn format_fiat(amount: f64, currency: DisplayCurrency) -> String {
    let symbol = currency.symbol();
    if !amount.is_finite() || amount <= 0.0 {
        return format!("{symbol}0.00");
    }
    if amount < 0.01 {
        return format!("{symbol}<0.01");
    }
    format!("{symbol}{}", locale_grouped_2(amount))
}

/// `tokenFiatValue`: `Number(formatted) * price`, or `None` without a finite price or amount.
pub fn token_fiat_value(formatted: &str, price: Option<f64>) -> Option<f64> {
    let price = price.filter(|p| p.is_finite())?;
    if formatted.trim_matches(is_js_whitespace).is_empty() {
        return None;
    }
    let amount = string_to_number(formatted);
    amount.is_finite().then_some(amount * price)
}

fn group_thousands(whole: &str) -> String {
    static GROUP: OnceLock<Regex> = OnceLock::new();
    GROUP
        .get_or_init(|| Regex::new(r"\B(?=(\d{3})+(?!\d))", false))
        .replace(whole, true, |_| ",".into())
}

const MAX_FRACTION_PLACES: usize = 8;
const SUB_UNIT_SIGNIFICANT: usize = 4;
const DEFAULT_FRACTION_PLACES: usize = 5;
/// `PORTFOLIO_FRACTION_PLACES`: the home list's fixed two places.
const PORTFOLIO_FRACTION_PLACES: u32 = 2;

/// `compactAmount(formatted, PORTFOLIO_FRACTION_PLACES)`: the Home list's amount column.
#[uniffi::export]
pub fn portfolio_amount(formatted: String) -> String {
    compact_amount(formatted, Some(PORTFOLIO_FRACTION_PLACES))
}

fn units(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}

fn text(units: &[u16]) -> String {
    String::from_utf16_lossy(units)
}

fn trim_trailing_zeros(value: &[u16]) -> &[u16] {
    let end = value
        .iter()
        .rposition(|u| *u != u16::from(b'0'))
        .map_or(0, |i| i + 1);
    &value[..end]
}

fn pad_end(value: &[u16], width: usize) -> String {
    let mut out = value.to_vec();
    while out.len() < width {
        out.push(u16::from(b'0'));
    }
    text(&out)
}

/// `compactAmount(formatted, places)`: THE display policy for token amounts.
#[uniffi::export]
pub fn compact_amount(formatted: String, places: Option<u32>) -> String {
    let mut parts = formatted.split('.');
    let whole = parts.next().unwrap_or("");
    let fraction = units(parts.next().unwrap_or(""));
    let grouped = group_thousands(whole);
    let fixed = places.map(|p| p as usize);
    if fraction.is_empty() {
        return match fixed {
            Some(p) => format!("{grouped}.{}", "0".repeat(p)),
            None => grouped,
        };
    }
    let is_sub_unit = whole == "0" || whole == "-0";
    if !is_sub_unit {
        let width = fixed.unwrap_or(DEFAULT_FRACTION_PLACES);
        let cut = &fraction[..width.min(fraction.len())];
        if fixed.is_some() {
            return format!("{grouped}.{}", pad_end(cut, width));
        }
        let trimmed = trim_trailing_zeros(cut);
        return if trimmed.is_empty() {
            grouped
        } else {
            format!("{grouped}.{}", text(trimmed))
        };
    }
    let Some(first) = fraction
        .iter()
        .position(|u| (u16::from(b'1')..=u16::from(b'9')).contains(u))
    else {
        return match fixed {
            Some(p) => format!("{grouped}.{}", "0".repeat(p)),
            None => grouped,
        };
    };
    if first >= MAX_FRACTION_PLACES {
        return format!("<0.{}1", "0".repeat(MAX_FRACTION_PLACES - 1));
    }
    if let Some(p) = fixed.filter(|p| first < *p) {
        return format!(
            "{grouped}.{}",
            pad_end(&fraction[..p.min(fraction.len())], p)
        );
    }
    let end = (first + SUB_UNIT_SIGNIFICANT).min(MAX_FRACTION_PLACES);
    let trimmed = trim_trailing_zeros(&fraction[..end.min(fraction.len())]);
    format!("{grouped}.{}", text(trimmed))
}

/// The hero's 24h line (`heroDelta`): the arrow and magnitude in the up/down hue, then the
/// muted `Portfolio price · <percent>% · 24h` window (`heroChange`), which says the figure is a
/// price move rather than a change in holdings.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct FiatDelta {
    pub down: bool,
    pub amount_text: String,
    pub window_text: String,
}

/// The Home hero: the total when it can be shown (else the host prints "—") and the delta.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct PortfolioHero {
    pub total_text: Option<String>,
    pub total_value: Option<f64>,
    pub delta: Option<FiatDelta>,
}

fn portfolio_total(balances: &[TokenBalance], prices: &PriceView) -> f64 {
    balances.iter().fold(0.0, |total, balance| {
        match token_fiat_value(&balance.formatted, prices.price(&balance.token.address)) {
            Some(value) => total + value,
            None => total,
        }
    })
}

fn portfolio_delta(balances: &[TokenBalance], prices: &PriceView) -> Option<(f64, bool, f64)> {
    let (mut current, mut previous, mut priced) = (0.0, 0.0, false);
    for balance in balances {
        let Some(value) =
            token_fiat_value(&balance.formatted, prices.price(&balance.token.address))
        else {
            continue;
        };
        priced = true;
        let prior = match prices.change(&balance.token.address) {
            Some(change) if change.is_finite() && 1.0 + change / 100.0 > 0.0 => {
                value / (1.0 + change / 100.0)
            }
            _ => value,
        };
        current += value;
        previous += prior;
    }
    if !priced || previous <= 0.0 {
        return None;
    }
    let absolute = current - previous;
    Some((
        absolute.abs(),
        absolute < 0.0,
        ((absolute / previous) * 100.0).abs(),
    ))
}

/// Home's hero (`homeScreen`): shown only with an account, loaded balances (`visible` is the
/// Home list, STRK first) and a non-empty price map; the delta line only when it is non-null.
#[uniffi::export]
pub fn portfolio_hero(
    visible: Option<Vec<TokenBalance>>,
    prices: PriceView,
    has_account: bool,
) -> PortfolioHero {
    let Some(balances) = visible.filter(|_| has_account && !prices.prices.is_empty()) else {
        return PortfolioHero {
            total_text: None,
            total_value: None,
            delta: None,
        };
    };
    let total = portfolio_total(&balances, &prices);
    let delta = portfolio_delta(&balances, &prices).map(|(abs, down, percent)| FiatDelta {
        down,
        amount_text: format!(
            "{} {}",
            if down { "↓" } else { "↑" },
            format_fiat(abs, prices.currency)
        ),
        window_text: format!("Portfolio price · {}% · 24h", to_fixed(percent, 2)),
    });
    PortfolioHero {
        total_text: Some(format_fiat(total, prices.currency)),
        total_value: Some(total),
        delta,
    }
}

/// `changeBadge`: `↑|↓ <|change|.toFixed(2)>%`, `up` when the change is ≥ 0.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct ChangeBadge {
    pub up: bool,
    pub text: String,
}

/// The right-hand side of a token row: fiat value (`None` renders "—") and the change badge.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct TokenRowFiat {
    pub value_text: Option<String>,
    pub change: Option<ChangeBadge>,
}

/// `balanceRow`'s fiat column and badge for one balance.
#[uniffi::export]
pub fn token_row_fiat(balance: TokenBalance, prices: PriceView) -> TokenRowFiat {
    let address = &balance.token.address;
    let value = token_fiat_value(&balance.formatted, prices.price(address));
    let change = prices
        .change(address)
        .filter(|c| c.is_finite())
        .map(|c| ChangeBadge {
            up: c >= 0.0,
            // The extension tags each row's figure as a price move (`token-change-win`).
            text: format!(
                "{} {}% · 24h price",
                if c >= 0.0 { "↑" } else { "↓" },
                to_fixed(c.abs(), 2)
            ),
        });
    TokenRowFiat {
        value_text: value.map(|v| format_fiat(v, prices.currency)),
        change,
    }
}

/// `tokenFiatValue` then `formatFiat`, for the Tokens list and detail (`None` when unpriced).
#[uniffi::export]
pub fn fiat_value_text(
    formatted: String,
    price: Option<f64>,
    currency: DisplayCurrency,
) -> Option<String> {
    token_fiat_value(&formatted, price).map(|v| format_fiat(v, currency))
}

/// Direction of a 7-day series (`sparklineTrend`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum SparklineTrend {
    Up,
    Down,
    Flat,
}

/// One sparkline vertex in the 100×32 view box.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct SparklinePoint {
    pub x: f64,
    pub y: f64,
}

/// A drawable sparkline: vertices, the SVG `points` text, and the trend hue.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct Sparkline {
    pub points: Vec<SparklinePoint>,
    pub path: String,
    pub trend: SparklineTrend,
}

const SPARK_WIDTH: f64 = 100.0;
const SPARK_HEIGHT: f64 = 32.0;

fn round2(value: f64) -> f64 {
    math_round(value * 100.0) / 100.0
}

/// `sparklinePath(points, 100, 32)` and `sparklineTrend`; `None` under two finite samples
/// ("Price history unavailable.").
#[uniffi::export]
pub fn token_sparkline(values: Vec<f64>) -> Option<Sparkline> {
    let finite: Vec<f64> = values.into_iter().filter(|v| v.is_finite()).collect();
    if finite.len() < 2 {
        return None;
    }
    let min = finite.iter().copied().fold(f64::INFINITY, f64::min);
    let max = finite.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let span = max - min;
    let step = SPARK_WIDTH / (finite.len() - 1) as f64;
    let points: Vec<SparklinePoint> = finite
        .iter()
        .enumerate()
        .map(|(index, value)| SparklinePoint {
            x: round2(index as f64 * step),
            y: round2(if span == 0.0 {
                SPARK_HEIGHT / 2.0
            } else {
                SPARK_HEIGHT - ((value - min) / span) * SPARK_HEIGHT
            }),
        })
        .collect();
    let path = points
        .iter()
        .map(|p| format!("{},{}", number_to_string(p.x), number_to_string(p.y)))
        .collect::<Vec<_>>()
        .join(" ");
    let (first, last) = (finite[0], finite[finite.len() - 1]);
    let trend = if first == last {
        SparklineTrend::Flat
    } else if last > first {
        SparklineTrend::Up
    } else {
        SparklineTrend::Down
    };
    Some(Sparkline {
        points,
        path,
        trend,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compact_amounts() {
        let c = |v: &str, p: Option<u32>| compact_amount(v.into(), p);
        assert_eq!(c("1234567.891", Some(2)), "1,234,567.89");
        assert_eq!(c("1", Some(2)), "1.00");
        assert_eq!(c("0.5", Some(2)), "0.50");
        assert_eq!(c("0.00001234", Some(2)), "0.00001234");
        assert_eq!(c("0.000000001", None), "<0.00000001");
        assert_eq!(c("12.300", None), "12.3");
        assert_eq!(c("0.000", None), "0");
    }

    #[test]
    fn formats_fiat() {
        assert_eq!(format_fiat(0.004, DisplayCurrency::Usd), "$<0.01");
        assert_eq!(format_fiat(-3.0, DisplayCurrency::Eur), "€0.00");
        assert_eq!(format_fiat(1234.5, DisplayCurrency::Gbp), "£1,234.50");
    }

    #[test]
    fn sparkline_geometry() {
        let line = token_sparkline(vec![1.0, 3.0, 2.0]).unwrap();
        assert_eq!(line.path, "0,32 50,0 100,16");
        assert_eq!(line.trend, SparklineTrend::Up);
        assert!(token_sparkline(vec![1.0, f64::NAN]).is_none());
    }
}
