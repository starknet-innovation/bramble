//! What stays mobile's of `extension-transactions-*.json` until 2.7: Bramble's failure-notice
//! sentences (`failureNoticeMessage`) and mobile's copy of Bramble's send numbers
//! (`SEND_POLICY`), each checked against the extension's own values. The send mechanism's rules,
//! explorer links and the activity log's status merge and observation policy are wallet-core's
//! (`crates/bramble-core/tests/transactions_rules_parity.rs`).

use serde_json::Value;

use super::plan::{CONFIRMATION_DELAYS_MS, FEE_MARGIN_PERCENT, REVIEWED_FEE_HEADROOM, SEND_POLICY};
use crate::activity::failure_notice_message;
use wallet_core::activity::store::parse_status;
use wallet_core::send::fees;
use wallet_core::send::plan::{DEPLOY_POLL_ATTEMPTS, DEPLOY_POLL_INTERVAL_MS};

fn fixture() -> Value {
    let mut whole = serde_json::Map::new();
    for text in [
        include_str!("../../tests/fixtures/extension-transactions-rules.json"),
        include_str!("../../tests/fixtures/extension-transactions-status.json"),
    ] {
        let part: Value = serde_json::from_str(text).unwrap();
        whole.extend(part.as_object().unwrap().clone());
    }
    Value::Object(whole)
}

#[test]
fn failure_notices_match_the_extension() {
    let notices = fixture()["status"]["notices"].as_array().unwrap().clone();
    assert!(!notices.is_empty());
    for notice in notices {
        let status = parse_status(notice["status"].as_str().unwrap()).unwrap();
        assert_eq!(
            failure_notice_message(status, notice["summary"].as_str().unwrap()),
            notice["message"].as_str().unwrap()
        );
    }
}

/// Mobile holds Bramble's send numbers until 2.7; wallet-core's `bramble-core` holds the same
/// values, checked against the same fixture.
#[test]
fn send_policy_matches_the_extension() {
    let whole = fixture();
    let timing = &whole["timing"];
    let delays: Vec<u32> = timing["confirmationDelaysMs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| u32::try_from(v.as_u64().unwrap()).unwrap())
        .collect();
    assert_eq!(delays, CONFIRMATION_DELAYS_MS);
    assert_eq!(SEND_POLICY.confirmation_delays_ms, CONFIRMATION_DELAYS_MS);
    assert_eq!(timing["deployPollIntervalMs"], DEPLOY_POLL_INTERVAL_MS);
    assert_eq!(timing["deployPollAttempts"], DEPLOY_POLL_ATTEMPTS);
    for headroom in [&whole["fees"]["headroom"], &timing["feeHeadroom"]] {
        assert_eq!(headroom["numerator"], REVIEWED_FEE_HEADROOM.numerator);
        assert_eq!(headroom["denominator"], REVIEWED_FEE_HEADROOM.denominator);
    }
    assert_eq!(SEND_POLICY.reviewed_fee_headroom, REVIEWED_FEE_HEADROOM);
    // The margin is the one starknet.js bounds were computed with: every quotable case's spend.
    assert_eq!(SEND_POLICY.fee_margin_percent, FEE_MARGIN_PERCENT);
    let mut quoted = 0;
    for case in whole["fees"]["bounds"].as_array().unwrap() {
        if let Ok((_, quote)) = fees::quote(&case["estimate"], FEE_MARGIN_PERCENT) {
            assert_eq!(quote.spend.to_decimal(), case["maxSpend"].as_str().unwrap());
            quoted += 1;
        }
    }
    assert!(quoted > 0);
}
