//! What stays mobile's of `extension-transactions-*.json` until Phase 2.4 moves the explorer and
//! the activity store into wallet-core: explorer transaction URLs, the store's status merge and
//! observation policy, and mobile's copy of Bramble's send numbers (`SEND_POLICY`), each checked
//! against the extension's own values. The send mechanism's rules are wallet-core's
//! `transactions_rules_parity.rs`.

use serde_json::Value;

use super::plan::{CONFIRMATION_DELAYS_MS, FEE_MARGIN_PERCENT, REVIEWED_FEE_HEADROOM, SEND_POLICY};
use crate::activity::observation::{self, Tier};
use crate::activity::store;
use crate::networks::NetworkId;
use wallet_core::send::fees;
use wallet_core::send::plan::{DEPLOY_POLL_ATTEMPTS, DEPLOY_POLL_INTERVAL_MS};

fn fixture() -> Value {
    let mut whole = serde_json::Map::new();
    for text in [
        include_str!("../../tests/fixtures/extension-transactions-rules.json"),
        include_str!("../../tests/fixtures/extension-transactions-presentation.json"),
        include_str!("../../tests/fixtures/extension-transactions-status.json"),
        include_str!("../../tests/fixtures/extension-transactions-observation.json"),
    ] {
        let part: Value = serde_json::from_str(text).unwrap();
        whole.extend(part.as_object().unwrap().clone());
    }
    Value::Object(whole)
}

#[test]
fn explorer_transaction_urls_match_the_extension() {
    for case in fixture()["presentation"]["explorerTransactionUrls"]
        .as_array()
        .unwrap()
    {
        let network = match case["networkId"].as_str().unwrap() {
            "SN_MAIN" => NetworkId::Mainnet,
            _ => NetworkId::Sepolia,
        };
        let url = crate::history::explorer::explorer_transaction_url(
            network,
            case["hash"].as_str().unwrap().into(),
        );
        assert_eq!(url.as_deref(), case["url"].as_str(), "{case}");
    }
}

#[test]
fn the_store_merges_status_like_the_extension() {
    let status_json = &fixture()["status"];
    for case in status_json["monotonic"].as_array().unwrap() {
        let parse = |v: &Value| store::parse_status(v.as_str().unwrap()).unwrap();
        assert_eq!(
            store::monotonic(parse(&case["current"]), parse(&case["observed"])),
            parse(&case["merged"])
        );
    }
    assert_eq!(
        status_json["notFoundThreshold"],
        store::NOT_FOUND_FAILURE_THRESHOLD
    );
    assert_eq!(
        status_json["unresolvedWindowMs"],
        observation::UNRESOLVED_WINDOW_MS
    );
    assert_eq!(
        status_json["l1FinalityWindowMs"],
        observation::L1_FINALITY_WINDOW_MS
    );
    let minutes = |key: &str| status_json[key].as_u64().unwrap() * 60_000;
    assert_eq!(
        minutes("fastObservationPeriodMinutes"),
        observation::period_ms(Tier::Fast)
    );
    assert_eq!(
        minutes("slowObservationPeriodMinutes"),
        observation::period_ms(Tier::Slow)
    );
    assert_eq!(
        status_json["maxAlertsPerDrain"],
        observation::MAX_ALERTS_PER_DRAIN
    );
}

#[test]
fn observation_tiers_retirement_and_notices_match_the_extension() {
    let whole = fixture();
    let status_json = &whole["status"];
    let observed = &whole["observation"];
    let columns: Vec<&str> = observed["columns"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c.as_str().unwrap())
        .collect();
    assert_eq!(
        columns,
        [
            "status",
            "finalizedOnL1",
            "failureNotice",
            "ageMs",
            "fast",
            "slow",
            "expired"
        ]
    );
    let cases = observed["cases"].as_array().unwrap();
    assert!(!cases.is_empty());
    for case in cases {
        let status = store::parse_status(case[0].as_str().unwrap()).unwrap();
        let finalized = case[1].as_bool() == Some(true);
        let has_notice = !case[2].is_null();
        let (at, now) = (1_000, 1_000 + case[3].as_u64().unwrap());
        let fast = observation::is_observed_at(status, finalized, at, Tier::Fast, now);
        let slow = observation::is_observed_at(status, finalized, at, Tier::Slow, now);
        assert_eq!(fast, case[4].as_bool().unwrap(), "{case}");
        assert_eq!(slow, case[5].as_bool().unwrap(), "{case}");
        assert_eq!(
            observation::is_observed(status, finalized, at, now),
            fast || slow
        );
        let expired = observation::is_expired(status, has_notice, at, now);
        assert_eq!(expired, case[6].as_bool().unwrap(), "{case}");
    }
    // `retiredOutcome`: one pending notice, the status untouched (`store::retire_expired`).
    for retired in observed["retired"].as_array().unwrap() {
        assert_eq!(retired["failureNotice"], "pending");
        assert!(store::parse_status(retired["status"].as_str().unwrap()).is_some());
        assert_eq!(
            retired.as_object().unwrap().len(),
            2,
            "nothing else changes"
        );
    }
    for notice in status_json["notices"].as_array().unwrap() {
        let status = store::parse_status(notice["status"].as_str().unwrap()).unwrap();
        assert_eq!(
            observation::failure_notice_message(status, notice["summary"].as_str().unwrap()),
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
