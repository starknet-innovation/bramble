//! Home balances with private value included: `home-tabs.ts` `unifiedHomeBalances` and
//! `visiblePrivateHomeBalances`, over the portfolio's Home model (`TokenPreferences::home_rows`'
//! visible `TokenBalance` rows, matched by token id). Amounts render through the one
//! `compactAmount` (`portfolio::fiat`). Pinned by `extension-privacy-rules.json` (`unified`,
//! `compactAmounts`).

use super::types::{PrivacyReading, PrivacyRegistration, PrivacyState, UnifiedBalance};
use crate::networks::{self, NetworkId, TokenInfo};
use crate::portfolio::fiat::{compact_amount, portfolio_amount};
use crate::portfolio::model::TokenBalance;
use crate::portfolio::registry::{strk_address, with_token_id};
use crate::send::u256::U256;
use crate::{felt, rpc};

/// `formatTokenAmount`: full precision, trailing zeros dropped.
pub fn format_full(balance: &str, decimals: u8) -> String {
    rpc::format_amount(balance, decimals, decimals).unwrap_or_else(|_| "0".into())
}

/// `compactAmount(formatted, places)`, the portfolio's one implementation.
pub(crate) fn compact(formatted: &str, places: Option<u32>) -> String {
    compact_amount(formatted.to_string(), places)
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

/// A catalog token's private balance as a portfolio row (`TokenConfig` id as the portfolio builds it).
fn private_row(network: NetworkId, token: &TokenInfo, amount: &U256) -> TokenBalance {
    let balance = amount.to_decimal();
    TokenBalance {
        token: with_token_id(
            network,
            &token.address,
            &token.symbol,
            &token.name,
            token.decimals,
        ),
        formatted: format_full(&balance, token.decimals),
        balance,
    }
}

/// `unifiedHomeBalances`: the portfolio's visible rows in their order with private amounts added
/// (matched by token id), tokens holding only a private balance appended, then STRK moved first
/// (a stable sort, as `compareStrkFirst`). Without a settled registered reading the rows are the
/// public ones, so the hero total degrades to public-only instead of hiding.
pub fn unified(
    network: NetworkId,
    visible: &[TokenBalance],
    hidden: &[String],
    reading: PrivacyReading,
    state: Option<&PrivacyState>,
) -> Vec<UnifiedBalance> {
    let state = super::gates::in_scope(network, state);
    let mut private: Vec<TokenBalance> = visible_private(reading, state, hidden)
        .into_iter()
        .filter_map(|entry| {
            let token = catalog_token(network, &entry.token_address)?;
            Some(private_row(
                network,
                token,
                &U256::from_decimal(&entry.balance)?,
            ))
        })
        .collect();
    let mut rows: Vec<UnifiedBalance> = visible
        .iter()
        .map(|public| {
            let public_compact = portfolio_amount(public.formatted.clone());
            let index = private.iter().position(|p| p.token.id == public.token.id);
            let extra = index.map(|index| private.remove(index));
            let balance = match extra.and_then(|p| {
                let sum = U256::from_decimal(&public.balance)?
                    .checked_add(U256::from_decimal(&p.balance)?)?;
                Some(sum.to_decimal())
            }) {
                Some(total) => TokenBalance {
                    formatted: format_full(&total, public.token.decimals),
                    balance: total,
                    token: public.token.clone(),
                },
                None => public.clone(),
            };
            UnifiedBalance {
                balance,
                public_compact,
                private_only: false,
            }
        })
        .collect();
    rows.extend(private.into_iter().map(|balance| UnifiedBalance {
        public_compact: portfolio_amount("0".into()),
        balance,
        private_only: true,
    }));
    let strk = strk_address();
    rows.sort_by_key(|row| !same(&row.balance.token.address, strk));
    rows
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compact_amounts_match_the_extension_policy() {
        let cases: [(&str, Option<u32>, &str); 14] = [
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
                compact(formatted, places),
                expected,
                "{formatted} {places:?}"
            );
        }
    }
}
