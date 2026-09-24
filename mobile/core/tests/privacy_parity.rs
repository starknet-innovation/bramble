//! The core's privacy behaviour against the extension's, from `extension-privacy-*.json`
//! (written by `bun run mobile:parity` from the extension's own code): viewing keys, routing, the
//! exact discovery bodies, every judged reply, and every gate.

mod privacy_support;

use bramble_core::testing::{privacy as hooks, strk20_viewing_key};
use bramble_core::{
    privacy_entry, privacy_status, private_line, receive_pool_notice, shield_tile,
    shielded_balances_included, token_detail_privacy, unified_home_balances, DeploymentState,
    DetailAction, DetailSummary, NetworkId, PoolNotice, PrivacyBlocker, PrivacyEntry,
    PrivacyPurpose, PrivacyReading, PrivacyRegistration, PrivacyState, PrivacyStatus,
    PrivateBalance, PrivateLine, PublicBalance, ShieldTile,
};
use privacy_support::{drive, mainnet_plan, rules, steady, wallet, wire, Script, PHRASE};
use serde_json::Value;

fn text(value: &Value) -> &str {
    value.as_str().unwrap()
}

#[test]
fn viewing_keys_match_the_extension_krusty_path() {
    let wire = wire();
    let keys = &wire["viewingKeys"];
    let (chain, pool) = (text(&keys["chainId"]), text(&keys["pool"]));
    for account in keys["accounts"].as_array().unwrap() {
        let index = account["accountIndex"].as_u64().unwrap() as u32;
        let derived = strk20_viewing_key(PHRASE, index, chain, pool).unwrap();
        assert_eq!(derived, text(&account["viewingKey"]), "account {index}");
    }
    for vector in keys["crate"].as_array().unwrap() {
        let private_key =
            starknet_types_core::felt::Felt::from_hex(text(&vector["privateKey"])).unwrap();
        let key = krusty_kms::derive_scoped_strk20_viewing_key(
            &private_key,
            text(&vector["chainId"]),
            text(&vector["pool"]),
        )
        .unwrap();
        assert_eq!(format!("{key:#x}"), text(&vector["viewingKey"]));
    }
    for refusal in keys["refusals"].as_array().unwrap() {
        assert!(refusal["refused"].as_bool().unwrap());
        assert!(strk20_viewing_key(PHRASE, 0, chain, text(&refusal["pool"])).is_err());
    }
}

#[test]
fn routing_matches_and_ohttp_is_never_routed() {
    let wire = wire();
    let routing = &wire["routing"];
    assert_eq!(
        text(&routing["bundled"]),
        include_str!("../generated/privacy.json")
    );
    assert_eq!(
        hooks::routed_networks(text(&routing["bundled"])),
        Some(vec![NetworkId::Mainnet])
    );
    for variant in ["ohttpEnabled", "ohttpRelay"] {
        assert_eq!(
            hooks::routed_networks(text(&routing[variant])),
            Some(vec![]),
            "{variant}"
        );
        assert!(
            !text(&routing[variant]).contains("discoveryUrl"),
            "{variant}"
        );
    }
    assert!(!bramble_core::privacy_configured(NetworkId::Sepolia));
}

fn case(wire: &Value, id: &str) -> Value {
    wire["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == id)
        .unwrap()
        .clone()
}

#[test]
fn discovery_bodies_are_byte_identical_to_the_sdk() {
    let wire = wire();
    let (_dir, core) = wallet();
    let run = drive(
        &mainnet_plan(&core),
        Script::from_case(&case(&wire, "three-pages")["script"]),
        &mut steady,
    );
    let capture = wire["capture"].as_array().unwrap();
    let posts: Vec<_> = capture.iter().filter(|r| r["kind"] != "rpc").collect();
    assert_eq!(run.posts.len(), posts.len());
    for ((url, body, _), expected) in run.posts.iter().zip(&posts) {
        assert_eq!(url, text(&expected["url"]));
        assert_eq!(std::str::from_utf8(body).unwrap(), text(&expected["body"]));
    }
    let fee = capture.iter().find(|r| r["kind"] == "rpc").unwrap();
    let (body, _) = run
        .rpcs
        .iter()
        .find(|(_, p)| *p == PrivacyPurpose::PoolFee)
        .unwrap();
    let sent: Value = serde_json::from_str(body).unwrap();
    assert_eq!(sent["method"], "starknet_call");
    assert_eq!(sent["params"], fee["params"]);
}

#[test]
fn every_judged_reply_reaches_the_extension_outcome() {
    let wire = wire();
    let (_dir, core) = wallet();
    for entry in wire["cases"].as_array().unwrap() {
        let id = text(&entry["id"]);
        let run = drive(
            &mainnet_plan(&core),
            Script::from_case(&entry["script"]),
            &mut steady,
        );
        let outcome = run.outcome.clone().unwrap();
        if let Some(deviation) = entry.get("mobile") {
            assert_eq!(
                format!("{:?}", outcome.unwrap_err()),
                text(deviation),
                "{id}"
            );
            continue;
        }
        let expected = &entry["outcome"];
        if expected.get("error").is_some() {
            assert!(
                outcome.is_err(),
                "{id}: the extension failed, mobile gave {outcome:?}"
            );
        } else {
            let state = outcome.unwrap_or_else(|f| panic!("{id}: mobile failed {f:?}"));
            let registered = text(&expected["registration"]) == "registered";
            assert_eq!(
                state.registration == PrivacyRegistration::Registered,
                registered,
                "{id}"
            );
            assert_eq!(state.pool_fee_fri, text(&expected["poolFeeFri"]), "{id}");
            let balances = expected["balances"].as_array().unwrap();
            assert_eq!(state.balances.len(), balances.len(), "{id}");
            for (mine, theirs) in state.balances.iter().zip(balances) {
                assert_eq!(mine.token_address, text(&theirs["token"]), "{id}");
                assert_eq!(mine.balance, text(&theirs["balance"]), "{id}");
            }
        }
        let requests = &entry["requests"];
        assert_eq!(
            run.count(PrivacyPurpose::PreflightCheck) as u64,
            requests["preflight"].as_u64().unwrap(),
            "{id}"
        );
        assert_eq!(
            run.count(PrivacyPurpose::IncomingState) as u64,
            requests["incoming"].as_u64().unwrap(),
            "{id}"
        );
        assert_eq!(
            run.count(PrivacyPurpose::PoolFee) as u64,
            requests["fee"].as_u64().unwrap(),
            "{id}"
        );
        let pauses: Vec<u32> = entry["pauses"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| {
                assert!(
                    p["retryAfterMs"].is_null(),
                    "{id}: the SDK error carries no Retry-After"
                );
                p["attempt"].as_u64().unwrap() as u32 * 1_000
            })
            .collect();
        assert_eq!(run.waits, pauses, "{id}");
    }
}

fn reading(name: &str) -> (NetworkId, PrivacyReading) {
    let settled = |registration| PrivacyReading::Settled { registration };
    match name {
        "idle" => (NetworkId::Mainnet, PrivacyReading::Idle),
        "loading" => (NetworkId::Mainnet, PrivacyReading::Loading),
        "failed" => (NetworkId::Mainnet, PrivacyReading::Failed),
        "unconfigured" => (NetworkId::Sepolia, PrivacyReading::Unconfigured),
        "unregistered" => (
            NetworkId::Mainnet,
            settled(PrivacyRegistration::Unregistered),
        ),
        "registered" => (NetworkId::Mainnet, settled(PrivacyRegistration::Registered)),
        other => panic!("reading {other}"),
    }
}

fn deployment(name: &str) -> DeploymentState {
    match name {
        "deployed" => DeploymentState::Deployed,
        "undeployed" => DeploymentState::Undeployed,
        _ => DeploymentState::Unknown,
    }
}

fn funded(name: &str) -> Option<bool> {
    match name {
        "zero" => Some(false),
        "funded" => Some(true),
        _ => None,
    }
}

const ETH: &str = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const STRK: &str = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

fn registered_state(network: NetworkId, rules: &Value) -> PrivacyState {
    let entry = |address: &str, symbol: &str, balance: &str, formatted: &str| PrivateBalance {
        token_address: address.into(),
        symbol: symbol.into(),
        decimals: 18,
        balance: balance.into(),
        formatted: formatted.into(),
    };
    PrivacyState {
        network,
        account_index: 0,
        registration: PrivacyRegistration::Registered,
        balances: vec![
            entry(
                ETH,
                "ETH",
                text(&rules["privateEth"]["balance"]),
                text(&rules["privateEth"]["formatted"]),
            ),
            entry(STRK, "STRK", "0", "0"),
        ],
        pool_fee_fri: "0x53444835ec580000".into(),
        pool_address: "0x0".into(),
    }
}

#[test]
fn static_gates_match_the_rendered_extension() {
    let rules = rules();
    for row in rules["static"].as_array().unwrap() {
        let (network, read) = reading(text(&row["reading"]));
        let dep = deployment(text(&row["deployment"]));
        let fund = funded(text(&row["strk"]));
        let state = Some(registered_state(network, &rules));
        let label = format!("{row}");
        let tile = &row["tile"];
        let expected_tile = match (text(&tile["action"]), text(&tile["label"])) {
            ("receive", _) => ShieldTile::FundFirst,
            ("send-shield", _) => ShieldTile::Ready,
            ("privacy-open", "Deploy and enable") => ShieldTile::DeployAndEnable,
            ("privacy-open", _) => ShieldTile::Activate,
            _ => ShieldTile::NoStrkToken,
        };
        assert_eq!(
            shield_tile(network, dep, fund, read),
            expected_tile,
            "{label}"
        );
        let expected_line = match text(&row["privateLine"]["text"]) {
            "Discovering…" => PrivateLine::Discovering,
            "Unavailable" => PrivateLine::Unavailable,
            "Register to start shielding" => PrivateLine::RegisterToStart,
            "Fund with STRK" => PrivateLine::FundWithStrk,
            "Deploy and enable" => PrivateLine::DeployAndEnable,
            amount => PrivateLine::Amount {
                text: amount.into(),
            },
        };
        assert_eq!(
            private_line(network, dep, fund, read, ETH.into(), state.clone()),
            expected_line,
            "{label}"
        );
        let status = privacy_status(network, read);
        assert_eq!(
            status == PrivacyStatus::Unavailable,
            row["retryRow"].as_bool().unwrap(),
            "{label}"
        );
        let expected_status = match row["status"].as_str() {
            None => PrivacyStatus::Current,
            Some(s) if s.contains("refreshing") => PrivacyStatus::Refreshing,
            Some(_) => PrivacyStatus::Unavailable,
        };
        assert_eq!(status, expected_status, "{label}");
        let expected_notice = match text(&row["notice"]) {
            "fund-first" => PoolNotice::FundFirst,
            "deploy-first" => PoolNotice::DeployFirst,
            "register" => PoolNotice::Register,
            _ => PoolNotice::Hidden,
        };
        assert_eq!(
            receive_pool_notice(dep, fund, read),
            expected_notice,
            "{label}"
        );
        let detail = token_detail_privacy(network, dep, fund, read, ETH.into(), state);
        let expected_summary = match row["detail"]["summary"].as_str() {
            None => DetailSummary::None,
            Some("Try again") => DetailSummary::Retry,
            Some("Register to start shielding") => DetailSummary::RegisterToStart,
            Some(amount) => DetailSummary::Amount {
                text: amount.into(),
            },
        };
        assert_eq!(detail.summary, expected_summary, "{label}");
        let actions: Vec<&str> = row["detail"]["actions"]
            .as_array()
            .unwrap()
            .iter()
            .map(text)
            .collect();
        let expected_action = match actions.as_slice() {
            [] => DetailAction::None,
            ["Go private"] => DetailAction::GoPrivate,
            ["Shield", "Unshield"] => DetailAction::ShieldUnshield,
            ["Fund with STRK"] => DetailAction::FundWithStrk,
            ["Deploy and enable"] => DetailAction::DeployAndEnable,
            other => panic!("unexpected actions {other:?}"),
        };
        assert_eq!(detail.action, expected_action, "{label}");
    }
}

#[test]
fn journey_outcomes_match_the_bound_extension() {
    let rules = rules();
    for row in rules["journeys"].as_array().unwrap() {
        let (network, mut read) = reading(text(&row["reading"]));
        let mut dep = deployment(text(&row["deployment"]));
        let (_, loaded) = match text(&row["load"]) {
            "failed" => (NetworkId::Mainnet, PrivacyReading::Failed),
            other => reading(other),
        };
        let mut after_read = false;
        let outcome = loop {
            match hooks::entry_outcome(network, dep, read, after_read).as_str() {
                "check" => match text(&row["deploymentRead"]) {
                    "throws" => break "blocked:service".to_string(),
                    other => dep = deployment(other),
                },
                "discovering" => {
                    assert!(!after_read, "{row}: discovering twice");
                    read = loaded;
                    after_read = true;
                }
                done => break done.to_string(),
            }
        };
        assert_eq!(outcome, text(&row["outcome"]), "{row}");
        if outcome == "open-shield" || outcome == "activate" {
            assert_eq!(
                privacy_entry(network, dep, read, after_read),
                PrivacyEntry::Blocked {
                    blocker: PrivacyBlocker::Unsupported
                }
            );
        }
    }
}

#[test]
fn unified_home_balances_match_the_extension() {
    let rules = rules();
    for entry in rules["unified"].as_array().unwrap() {
        let (network, read) = reading(text(&entry["reading"]));
        let state = Some(registered_state(network, &rules));
        let public: Vec<PublicBalance> = entry["public"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| PublicBalance {
                token_address: text(&p["token"]).into(),
                balance: text(&p["balance"]).into(),
            })
            .collect();
        let rows = unified_home_balances(network, public, vec![], read, state.clone());
        let expected = entry["rows"].as_array().unwrap();
        assert_eq!(rows.len(), expected.len(), "{entry}");
        for (mine, theirs) in rows.iter().zip(expected) {
            assert_eq!(mine.token_address, text(&theirs["token"]), "{entry}");
            assert_eq!(mine.balance, text(&theirs["balance"]), "{entry}");
            assert_eq!(mine.formatted, text(&theirs["formatted"]), "{entry}");
            assert_eq!(mine.compact, text(&theirs["compact"]), "{entry}");
        }
        assert_eq!(
            shielded_balances_included(read, state, vec![]),
            entry["includesShielded"].as_bool().unwrap(),
            "{entry}"
        );
    }
    for entry in rules["compactAmounts"].as_array().unwrap() {
        let places = entry["places"].as_u64().map(|p| p as usize);
        assert_eq!(
            hooks::compact_amount(text(&entry["input"]), places),
            text(&entry["text"]),
            "{entry}"
        );
    }
}

/// The extension's scope guard: a Mainnet reading never feeds Sepolia rows, although ETH and STRK
/// share addresses on both networks (the window between a network switch and the next read).
#[test]
fn a_reading_from_another_network_is_ignored() {
    let rules = rules();
    let state = Some(registered_state(NetworkId::Mainnet, &rules));
    let read = PrivacyReading::Settled {
        registration: PrivacyRegistration::Registered,
    };
    let public = vec![PublicBalance {
        token_address: ETH.into(),
        balance: "1".into(),
    }];
    let rows = unified_home_balances(
        NetworkId::Sepolia,
        public.clone(),
        vec![],
        read,
        state.clone(),
    );
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].balance, "1");
    assert!(!rows[0].private_only);
    let mainnet = unified_home_balances(NetworkId::Mainnet, public, vec![], read, state);
    let eth = mainnet.iter().find(|row| row.symbol == "ETH").unwrap();
    assert_ne!(
        eth.balance, "1",
        "the same reading counts on its own network"
    );
}
