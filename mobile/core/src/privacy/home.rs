//! Home balances with private value included: `home-tabs.ts` `unifiedHomeBalances` and
//! `visiblePrivateHomeBalances`, plus the amount display policy they render through
//! (`token-row.ts` `compactAmount`). Pinned by `extension-privacy-rules.json` (`unified`,
//! `compactAmounts`).

use super::types::{
    PrivacyReading, PrivacyRegistration, PrivacyState, PublicBalance, UnifiedBalance,
};
use crate::networks::{self, NetworkId, TokenInfo};
use crate::send::u256::U256;
use crate::{felt, rpc};

/// `PORTFOLIO_FRACTION_PLACES`: the Home list's fixed fraction width.
pub const PORTFOLIO_FRACTION_PLACES: usize = 2;
const DEFAULT_FRACTION_PLACES: usize = 5;
const MAX_FRACTION_PLACES: usize = 8;
const SUB_UNIT_SIGNIFICANT: usize = 4;

/// `groupThousands`: `/\B(?=(\d{3})+(?!\d))/g` over a whole part (optionally signed).
fn group_thousands(whole: &str) -> String {
    let (sign, digits) = match whole.strip_prefix('-') {
        Some(rest) => ("-", rest),
        None => ("", whole),
    };
    if !digits.bytes().all(|b| b.is_ascii_digit()) {
        return whole.to_string();
    }
    let mut out = String::with_capacity(whole.len() + digits.len() / 3);
    out.push_str(sign);
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index) % 3 == 0 {
            out.push(',');
        }
        out.push(digit);
    }
    out
}

fn pad_end(text: &str, width: usize) -> String {
    format!("{text:0<width$}")
}

/// `compactAmount(formatted, places)`: THE display policy for token amounts.
pub fn compact_amount(formatted: &str, places: Option<usize>) -> String {
    let mut parts = formatted.split('.');
    let whole = parts.next().unwrap_or("0");
    let fraction = parts.next().unwrap_or("");
    let grouped = group_thousands(whole);
    if fraction.is_empty() {
        return match places {
            Some(places) => format!("{grouped}.{}", "0".repeat(places)),
            None => grouped,
        };
    }
    let is_sub_unit = whole == "0" || whole == "-0";
    if !is_sub_unit {
        let width = places.unwrap_or(DEFAULT_FRACTION_PLACES);
        let cut: String = fraction.chars().take(width).collect();
        if places.is_some() {
            return format!("{grouped}.{}", pad_end(&cut, width));
        }
        let trimmed = cut.trim_end_matches('0');
        return if trimmed.is_empty() {
            grouped
        } else {
            format!("{grouped}.{trimmed}")
        };
    }
    let Some(first) = fraction.find(|c: char| ('1'..='9').contains(&c)) else {
        return match places {
            Some(places) => format!("{grouped}.{}", "0".repeat(places)),
            None => grouped,
        };
    };
    if first >= MAX_FRACTION_PLACES {
        return format!("<0.{}1", "0".repeat(MAX_FRACTION_PLACES - 1));
    }
    if let Some(places) = places.filter(|places| first < *places) {
        let cut: String = fraction.chars().take(places).collect();
        return format!("{grouped}.{}", pad_end(&cut, places));
    }
    let end = (first + SUB_UNIT_SIGNIFICANT).min(MAX_FRACTION_PLACES);
    let cut: String = fraction.chars().take(end).collect();
    format!("{grouped}.{}", cut.trim_end_matches('0'))
}

/// `formatTokenAmount`: full precision, trailing zeros dropped.
pub fn format_full(balance: &str, decimals: u8) -> String {
    rpc::format_amount(balance, decimals, decimals).unwrap_or_else(|_| "0".into())
}

fn same(a: &str, b: &str) -> bool {
    matches!((felt::parse(a), felt::parse(b)), (Some(x), Some(y)) if x == y)
}

fn catalog_token(network: NetworkId, address: &str) -> Option<&'static TokenInfo> {
    networks::info(network)
        .tokens
        .iter()
        .find(|t| same(&t.address, address))
}

fn is_strk(token: &TokenInfo) -> bool {
    token.symbol == "STRK"
}

/// Private balances Home may count: only a settled registered reading, hidden tokens excluded.
pub fn visible_private<'a>(
    reading: PrivacyReading,
    state: Option<&'a PrivacyState>,
    hidden: &[String],
) -> Vec<&'a super::types::PrivateBalance> {
    let registered = reading
        == PrivacyReading::Settled {
            registration: PrivacyRegistration::Registered,
        };
    match state {
        Some(state) if registered && state.registration == PrivacyRegistration::Registered => state
            .balances
            .iter()
            .filter(|entry| !hidden.iter().any(|h| same(h, &entry.token_address)))
            .collect(),
        _ => Vec::new(),
    }
}

fn row(token: &TokenInfo, public: U256, private: Option<U256>) -> UnifiedBalance {
    let total = private
        .and_then(|p| public.checked_add(p))
        .unwrap_or(public)
        .to_decimal();
    let formatted = format_full(&total, token.decimals);
    UnifiedBalance {
        token_address: token.address.clone(),
        symbol: token.symbol.clone(),
        decimals: token.decimals,
        compact: compact_amount(&formatted, Some(PORTFOLIO_FRACTION_PLACES)),
        public_compact: compact_amount(
            &format_full(&public.to_decimal(), token.decimals),
            Some(PORTFOLIO_FRACTION_PLACES),
        ),
        balance: total,
        formatted,
        private_only: false,
    }
}

/// `unifiedHomeBalances`: public rows in their order with private amounts added, tokens holding
/// only a private balance appended, then STRK moved first (a stable sort, as `compareStrkFirst`).
pub fn unified(
    network: NetworkId,
    public: &[PublicBalance],
    hidden: &[String],
    reading: PrivacyReading,
    state: Option<&PrivacyState>,
) -> Vec<UnifiedBalance> {
    let state = super::gates::in_scope(network, state);
    let mut private: Vec<(&'static TokenInfo, U256)> = visible_private(reading, state, hidden)
        .into_iter()
        .filter_map(|entry| {
            Some((
                catalog_token(network, &entry.token_address)?,
                U256::from_decimal(&entry.balance)?,
            ))
        })
        .collect();
    let mut rows: Vec<UnifiedBalance> = public
        .iter()
        .filter(|balance| !hidden.iter().any(|h| same(h, &balance.token_address)))
        .filter_map(|balance| {
            let token = catalog_token(network, &balance.token_address)?;
            let amount = U256::from_decimal(&balance.balance)?;
            let index = private
                .iter()
                .position(|(t, _)| same(&t.address, &token.address));
            let extra = index.map(|index| private.remove(index).1);
            Some(row(token, amount, extra))
        })
        .collect();
    rows.extend(private.into_iter().map(|(token, amount)| UnifiedBalance {
        private_only: true,
        ..row(token, amount, None)
    }));
    rows.sort_by_key(|row| {
        catalog_token(network, &row.token_address).is_none_or(|token| !is_strk(token))
    });
    rows
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compact_amounts_match_the_extension_policy() {
        let cases: [(&str, Option<usize>, &str); 14] = [
            ("0", Some(2), "0.00"),
            ("1", None, "1"),
            ("1234567.891", Some(2), "1,234,567.89"),
            ("1234.5", None, "1,234.5"),
            ("12.000001", None, "12"),
            ("0.5", Some(2), "0.50"),
            ("0.00001234", Some(2), "0.00001234"),
            ("0.000012345678", None, "0.00001234"),
            ("0.000000001", Some(2), "<0.00000001"),
            ("0.000", Some(2), "0.00"),
            ("0.000", None, "0"),
            ("999", Some(2), "999.00"),
            ("1000", None, "1,000"),
            ("0.1", None, "0.1"),
        ];
        for (formatted, places, expected) in cases {
            assert_eq!(
                compact_amount(formatted, places),
                expected,
                "{formatted} {places:?}"
            );
        }
    }
}
