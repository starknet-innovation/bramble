//! The extension's per-field activity rules split from `activity.rs`: the token-address and
//! direction grammars (`isRecordedTokenAddress`, `activityToken`) and the planted-row cleanup of
//! stored rows (`withoutPlantedRows`, audit #163).

use super::activity::{ActivityEntry, ActivityKind, TransferDirection};
use crate::js::felt::{canonical_felt, is_non_zero_felt};

/// `isRecordedTokenAddress`: absent, or one canonical non-zero field element beside a symbol.
pub(crate) fn is_recorded_token_address(address: Option<&str>, token: Option<&str>) -> bool {
    address.is_none_or(|address| {
        token.is_some()
            && is_non_zero_felt(address)
            && canonical_felt(address).as_deref() == Some(address)
    })
}

/// `activityToken`: the token's canonical address when it is a non-zero field element.
pub(crate) fn activity_token_address(address: &str) -> Option<String> {
    canonical_felt(address).filter(|address| is_non_zero_felt(address))
}

/// `isZeroAmountLabel`: `/^0(?:\.0*)?$/`, a formatted amount of zero.
fn is_zero_amount_label(amount: &str) -> bool {
    match amount.strip_prefix('0') {
        Some(rest) => {
            rest.is_empty()
                || rest
                    .strip_prefix('.')
                    .is_some_and(|z| z.chars().all(|c| c == '0'))
        }
        None => false,
    }
}

/// The symbol the explorer lane gives a token the wallet does not track.
pub(crate) const UNTRACKED_TOKEN_SYMBOL: &str = "TOKEN";

/// `withoutPlantedRows` (audit #163): the planted-row rule applied to rows stored before it
/// existed, which reach the merge as local rows and would otherwise be kept. A zero-amount
/// transfer and an outgoing untracked-token transfer are dropped; an incoming untracked-token
/// transfer loses its counterparty. The extension spares `origin: "wallet"` rows; mobile records
/// no origin, but its own sends are of a bundled token and never zero, so the rule cannot reach
/// them.
pub(crate) fn without_planted_rows(entries: Vec<ActivityEntry>) -> Vec<ActivityEntry> {
    entries
        .into_iter()
        .filter_map(|mut entry| {
            if entry.kind != ActivityKind::Transfer {
                return Some(entry);
            }
            if entry.amount.as_deref().is_some_and(is_zero_amount_label) {
                return None;
            }
            if entry.token.as_deref() != Some(UNTRACKED_TOKEN_SYMBOL) {
                return Some(entry);
            }
            if entry.summary.starts_with("Sent ") {
                return None;
            }
            entry.counterparty = None;
            Some(entry)
        })
        .collect()
}

pub(crate) fn direction_text(direction: TransferDirection) -> &'static str {
    match direction {
        TransferDirection::In => "in",
        TransferDirection::Out => "out",
    }
}

pub(crate) fn parse_direction(text: &str) -> Option<TransferDirection> {
    match text {
        "in" => Some(TransferDirection::In),
        "out" => Some(TransferDirection::Out),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::networks::NetworkId;
    use crate::send::types::TxStatus;

    #[test]
    fn planted_rows_are_dropped_or_stripped_as_the_extension_does() {
        let row = |amount: &str, token: &str, summary: &str| ActivityEntry {
            account_id: "SN_MAIN:0x1".into(),
            amount: Some(amount.into()),
            counterparty: Some("0x5".into()),
            direction: None,
            failure_notice: None,
            finalized_on_l1: None,
            hash: "0xabc".into(),
            kind: ActivityKind::Transfer,
            network: NetworkId::Mainnet,
            not_found_count: None,
            status: TxStatus::Accepted,
            submitted_at: 1,
            summary: summary.into(),
            token: Some(token.into()),
            token_address: None,
        };
        for zero in ["0", "0.", "0.000"] {
            assert!(without_planted_rows(vec![row(zero, "STRK", "Received")]).is_empty());
        }
        for kept in ["0.01", "00", "10", "0.0001"] {
            assert_eq!(
                without_planted_rows(vec![row(kept, "STRK", "Received")]).len(),
                1
            );
        }
        assert!(without_planted_rows(vec![row("1", "TOKEN", "Sent 1 TOKEN to 0x5")]).is_empty());
        let incoming = without_planted_rows(vec![row("1", "TOKEN", "Received 1 TOKEN")]);
        assert_eq!(incoming[0].counterparty, None);
        let tracked = without_planted_rows(vec![row("1", "STRK", "Sent 1 STRK to 0x5")]);
        assert_eq!(tracked[0].counterparty.as_deref(), Some("0x5"));
    }

    #[test]
    fn token_addresses_must_be_canonical_field_elements() {
        let above_p = format!("0x{}", "f".repeat(64));
        assert!(!is_recorded_token_address(Some(&above_p), Some("X")));
        assert!(!is_recorded_token_address(Some("0x0"), Some("X")));
        assert!(!is_recorded_token_address(Some("0x07"), Some("X")));
        assert!(!is_recorded_token_address(Some("0x7"), None));
        assert!(is_recorded_token_address(Some("0x7"), Some("X")));
        assert_eq!(activity_token_address("-5"), None);
        assert_eq!(activity_token_address("0x07").as_deref(), Some("0x7"));
    }
}
