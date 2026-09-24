//! Fixture items 3–6 and 8 of `extension-transactions-*.json`: fee policy, amount grammar and call
//! encoding, presentation rules, status judgement, and timing, each computed by the extension's
//! own code and asserted against the core's port here.

use serde_json::Value;
use starknet_types_core::felt::Felt;

use super::calls;
use super::fees::{self, FeeQuote, FeeRefusal};
use super::judge::{self, Observation};
use super::plan::{CONFIRMATION_DELAYS_MS, DEPLOY_POLL_ATTEMPTS, DEPLOY_POLL_INTERVAL_MS};
use super::types::{FeeUnit, ReviewFlag, SendAmountError, TxStatus};
use super::u256::U256;
use crate::activity::store;
use crate::felt;
use crate::networks::NetworkId;

fn fixture() -> Value {
    let mut whole = serde_json::Map::new();
    for text in [
        include_str!("../../tests/fixtures/extension-transactions-rules.json"),
        include_str!("../../tests/fixtures/extension-transactions-presentation.json"),
        include_str!("../../tests/fixtures/extension-transactions-status.json"),
    ] {
        let part: Value = serde_json::from_str(text).unwrap();
        whole.extend(part.as_object().unwrap().clone());
    }
    Value::Object(whole)
}

fn hex_u128(value: &Value) -> Option<u128> {
    u128::from_str_radix(value.as_str()?.trim_start_matches("0x"), 16).ok()
}

#[test]
fn fee_bounds_match_starknet_js() {
    for case in fixture()["fees"]["bounds"].as_array().unwrap() {
        let expected = &case["resourceBounds"];
        let fits = ["l1_gas", "l2_gas", "l1_data_gas"].iter().all(|r| {
            hex_u128(&expected[r]["max_amount"]).is_some_and(|a| a <= u128::from(u64::MAX))
                && hex_u128(&expected[r]["max_price_per_unit"]).is_some()
        });
        match fees::quote(&case["estimate"]) {
            Ok((bounds, quote)) => {
                for (name, bound) in [
                    ("l1_gas", bounds.l1_gas),
                    ("l2_gas", bounds.l2_gas),
                    ("l1_data_gas", bounds.l1_data_gas),
                ] {
                    assert_eq!(
                        Some(bound.max_amount),
                        hex_u128(&expected[name]["max_amount"])
                    );
                    assert_eq!(
                        Some(bound.max_price_per_unit),
                        hex_u128(&expected[name]["max_price_per_unit"])
                    );
                }
                assert_eq!(quote.spend.to_decimal(), case["maxSpend"].as_str().unwrap());
                let amount = fees::fee_amount(&quote);
                assert_eq!(
                    amount.max_spend,
                    case["reviewed"]["overallFee"].as_str().unwrap()
                );
                let unit = if quote.unit == FeeUnit::Fri {
                    "FRI"
                } else {
                    "WEI"
                };
                assert_eq!(unit, case["reviewed"]["unit"].as_str().unwrap());
                assert_eq!(fits, fees::krusty_bounds(&bounds).is_ok(), "{case}");
            }
            // starknet.js computes bounds past u128; the core refuses them instead of truncating.
            Err(refusal) => {
                assert_eq!(refusal, FeeRefusal::BoundsOutOfRange);
                assert!(!fits, "{case}");
            }
        }
    }
}

#[test]
fn reviewed_fee_ceiling_matches_the_extension() {
    let fees_json = &fixture()["fees"];
    assert_eq!(fees_json["headroom"]["numerator"], fees::HEADROOM_NUMERATOR);
    assert_eq!(
        fees_json["headroom"]["denominator"],
        fees::HEADROOM_DENOMINATOR
    );
    let quote = |v: &Value| FeeQuote {
        spend: U256::from_decimal(v["overallFee"].as_str().unwrap()).unwrap(),
        unit: if v["unit"] == "FRI" {
            FeeUnit::Fri
        } else {
            FeeUnit::Wei
        },
    };
    for case in fees_json["ceiling"].as_array().unwrap() {
        assert_eq!(
            fees::exceeds_reviewed(&quote(&case["reviewed"]), &quote(&case["quoted"])),
            case["exceeds"].as_bool().unwrap(),
            "{case}"
        );
    }
}

#[test]
fn amounts_and_transfer_call_match_the_extension() {
    let calls_json = &fixture()["calls"];
    for case in calls_json["amounts"].as_array().unwrap() {
        let decimals = u8::try_from(case["decimals"].as_u64().unwrap()).unwrap();
        let parsed = calls::parse_token_amount(case["amount"].as_str().unwrap(), decimals);
        match (case["raw"].as_str(), case["error"].as_str()) {
            (Some(raw), None) if raw.len() > 77 && U256::from_decimal(raw).is_none() => {
                assert_eq!(parsed, Err(SendAmountError::TooLarge), "{case}");
            }
            (Some(raw), None) => assert_eq!(parsed.unwrap().to_decimal(), raw, "{case}"),
            (None, Some(error)) => {
                let expected = match error {
                    "Invalid transfer amount" => SendAmountError::Invalid,
                    "Too many decimal places" => SendAmountError::TooManyDecimals,
                    "Transfer amount must be greater than zero" => SendAmountError::NotPositive,
                    other => panic!("unmapped error {other}"),
                };
                assert_eq!(parsed, Err(expected), "{case}");
            }
            _ => panic!("bad case {case}"),
        }
    }
    assert_eq!(calls_json["transferSelector"], calls::TRANSFER_SELECTOR);
    let call = &calls_json["transferCall"];
    let token = felt::parse(call["contractAddress"].as_str().unwrap()).unwrap();
    let recipient = Felt::from_dec_str(call["calldata"][0].as_str().unwrap()).unwrap();
    let amount = U256::from_decimal(call["calldata"][1].as_str().unwrap()).unwrap();
    let calldata = calls::transfer_execute_calldata(&token, &recipient, &amount).unwrap();
    let expected: Vec<Felt> = calls_json["executeCalldata"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| Felt::from_dec_str(v.as_str().unwrap()).unwrap())
        .collect();
    assert_eq!(calldata, expected);
    for case in calls_json["zeroAddressErrors"].as_array().unwrap() {
        assert_eq!(case["error"], "Invalid transfer address");
        let token = calls::validate_recipient(case["token"].as_str().unwrap()).unwrap();
        let recipient = calls::validate_recipient(case["recipient"].as_str().unwrap()).unwrap();
        assert!(
            calls::transfer_execute_calldata(&token, &recipient, &U256::from_u128(1)).is_none()
        );
    }
    // `cairo.uint256` refuses 2^256; the core refuses it at parse time.
    assert!(calls_json["overflowError"].as_str().is_some());
    let over = "115792089237316195423570985008687907853269984665640564039457.584007913129639936";
    assert_eq!(
        calls::parse_token_amount(over, 18),
        Err(SendAmountError::TooLarge)
    );
}

#[test]
fn presentation_rules_match_the_extension() {
    let presentation = &fixture()["presentation"];
    for case in presentation["recipients"].as_array().unwrap() {
        let valid =
            calls::validate_recipient(case["input"].as_str().unwrap()).map(|f| felt::canonical(&f));
        assert_eq!(valid.as_deref(), case["valid"].as_str(), "{case}");
    }
    for case in presentation["shortAddresses"].as_array().unwrap() {
        assert_eq!(
            calls::short_address(case["input"].as_str().unwrap()),
            case["short"].as_str().unwrap()
        );
    }
    for case in presentation["explorerTransactionUrls"].as_array().unwrap() {
        let network = match case["networkId"].as_str().unwrap() {
            "SN_MAIN" => NetworkId::Mainnet,
            _ => NetworkId::Sepolia,
        };
        let url = super::explorer_transaction_url(network, case["hash"].as_str().unwrap().into());
        assert_eq!(url.as_deref(), case["url"].as_str(), "{case}");
    }
    for case in presentation["feeText"].as_array().unwrap() {
        let spend = U256::from_decimal(case["fee"]["overallFee"].as_str().unwrap()).unwrap();
        let unit = if case["fee"]["unit"] == "FRI" {
            FeeUnit::Fri
        } else {
            FeeUnit::Wei
        };
        assert_eq!(
            fees::fee_amount(&FeeQuote { spend, unit }).display,
            case["text"].as_str().unwrap()
        );
        assert_eq!(
            fees::format_fri(&spend),
            case["formatFri"].as_str().unwrap()
        );
    }
    for case in presentation["tokenAmounts"].as_array().unwrap() {
        let raw = U256::from_decimal(case["raw"].as_str().unwrap()).unwrap();
        let decimals = u8::try_from(case["decimals"].as_u64().unwrap()).unwrap();
        assert_eq!(
            calls::format_token_amount(&raw, decimals),
            case["text"].as_str().unwrap()
        );
    }
    for case in presentation["verification"].as_array().unwrap() {
        let recipient = felt::parse(case["recipient"].as_str().unwrap()).unwrap();
        let account = felt::parse(case["account"].as_str().unwrap()).unwrap();
        let token = crate::networks::all()
            .iter()
            .flat_map(|n| n.tokens.iter())
            .find(|t| t.address == case["token"].as_str().unwrap())
            .unwrap();
        let summary = calls::transfer_summary(
            &U256::from_u128(1_500_000_000_000_000_000),
            token.decimals,
            &token.symbol,
            &recipient,
        );
        assert_eq!(summary, case["summary"].as_str().unwrap());
        let flags: Vec<&str> = calls::transfer_flags(&recipient, &account)
            .iter()
            .map(|flag| match flag {
                ReviewFlag::SelfTransfer => "self-transfer",
                ReviewFlag::AddressPoisoning => "address-poisoning",
            })
            .collect();
        let expected: Vec<&str> = case["flags"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| f["code"].as_str().unwrap())
            .collect();
        assert_eq!(flags, expected, "{case}");
    }
}

#[test]
fn status_judgement_matches_the_extension() {
    let status_json = &fixture()["status"];
    for case in status_json["judged"].as_array().unwrap() {
        let mut body = case["reply"].clone();
        body["jsonrpc"] = "2.0".into();
        body["id"] = 1.into();
        let report = &case["report"];
        match judge::status(judge::answer(&body.to_string(), 1)) {
            Observation::Found {
                status,
                finalized_on_l1,
                ..
            } => {
                assert!(report["found"].as_bool().unwrap(), "{case}");
                assert_eq!(
                    store::status_text(status),
                    report["status"].as_str().unwrap(),
                    "{case}"
                );
                assert_eq!(finalized_on_l1, report["finalizedOnL1"].as_bool().unwrap());
            }
            Observation::NotFound => assert!(!report["found"].as_bool().unwrap(), "{case}"),
            Observation::Unknown => panic!("unreadable {case}"),
        }
    }
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
        store::UNRESOLVED_WINDOW_MS
    );
    assert_eq!(
        status_json["fastObservationPeriodMinutes"]
            .as_u64()
            .unwrap()
            * 60_000,
        store::FAST_OBSERVATION_PERIOD_MS
    );
    let _ = TxStatus::Pending;
}

#[test]
fn timing_matches_the_extension() {
    let timing = &fixture()["timing"];
    let delays: Vec<u32> = timing["confirmationDelaysMs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| u32::try_from(v.as_u64().unwrap()).unwrap())
        .collect();
    assert_eq!(delays, CONFIRMATION_DELAYS_MS);
    assert_eq!(timing["deployPollIntervalMs"], DEPLOY_POLL_INTERVAL_MS);
    assert_eq!(timing["deployPollAttempts"], DEPLOY_POLL_ATTEMPTS);
}
