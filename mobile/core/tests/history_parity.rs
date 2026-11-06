//! The core's Starkscan lane, RPC history scan, activity log rules and row presentation against
//! what the extension's TypeScript produced (`fixtures/portfolio-parity.jsonl`).

mod common;

use bramble_core::portfolio_testing::{self as t, JsValue};
use bramble_core::*;
use common::portfolio::*;

const ACCOUNT: &str = "0x208361e3911b1d93a704400b88e7e53a89171fce64dbb48f8479e4f44b398d9";

fn account_id() -> String {
    activity_account_id(NetworkId::Mainnet, ACCOUNT.into()).unwrap()
}

fn entries_json(entries: &[ActivityEntry]) -> JsValue {
    JsValue::Array(
        entries
            .iter()
            .map(|e| canon(&t::parse_json(&t::entry_json(e)).unwrap()))
            .collect(),
    )
}

fn expected_entries(value: &JsValue) -> JsValue {
    JsValue::Array(value.as_array().unwrap().iter().map(canon).collect())
}

#[test]
fn starkscan_request_pages_cooldowns_and_retry_after() {
    let block = at(&fixture(), "starkscan").clone();
    let tracked: Vec<TokenConfig> = list(&block, "tracked").iter().map(token).collect();
    let dir = tempfile::tempdir().unwrap();
    let request = t::activity_book(dir.path())
        .starkscan_request(account_id(), NetworkId::Mainnet, tracked.clone(), true, 0.0)
        .unwrap();
    let want = at(&block, "request");
    assert_eq!(request.url, text(want, "url"));
    let headers: Vec<(String, String)> = at(want, "headers")
        .as_object()
        .unwrap()
        .iter()
        .map(|(k, v)| (k.clone(), v.as_str().unwrap().into()))
        .collect();
    assert_eq!(
        request
            .headers
            .iter()
            .map(|h| (h.name.clone(), h.value.clone()))
            .collect::<Vec<_>>(),
        headers
    );
    for c in list(&block, "pages") {
        let mut body = text(c, "body");
        if let Some(repeat) = opt_num(c, "repeat") {
            let page = t::parse_json(&body).unwrap();
            let item = list(&page, "items")[0].to_json();
            body = format!(
                r#"{{"items":[{}],"nextCursor":null}}"#,
                vec![item; repeat as usize].join(",")
            );
        }
        let outcome = HttpOutcome {
            status: opt_num(c, "status").unwrap_or(200.0) as u16,
            retry_after: None,
            body: Some(body.into_bytes()),
            timed_out: false,
        };
        let rows = t::transfers_to_activity(&outcome, &account_id(), NetworkId::Mainnet, &tracked);
        match at(c, "out") {
            JsValue::Null => assert!(rows.is_none(), "{} should fail", text(c, "name")),
            out => assert_eq!(
                entries_json(&rows.unwrap_or_default()),
                expected_entries(out),
                "{}",
                text(c, "name")
            ),
        }
    }
    let probes: Vec<f64> = list(&block, "probes")
        .iter()
        .map(|p| p.as_f64().unwrap())
        .collect();
    for c in list(&block, "cooldowns") {
        let answer = match opt_num(c, "status") {
            None => HttpOutcome {
                status: 0,
                retry_after: None,
                body: None,
                timed_out: false,
            },
            Some(status) => HttpOutcome {
                status: status as u16,
                retry_after: opt_text(c, "retryAfter"),
                body: Some(text(c, "body").into_bytes()),
                timed_out: false,
            },
        };
        let blocked: Vec<bool> = probes
            .iter()
            .map(|offset| {
                let dir = tempfile::tempdir().unwrap();
                let book = t::activity_book(dir.path());
                assert!(book
                    .starkscan_apply(
                        account_id(),
                        NetworkId::Mainnet,
                        tracked.clone(),
                        answer.clone(),
                        0.0
                    )
                    .is_none());
                // The cooldown lives in memory only (createStarkscanClient), so probe the same book.
                book.starkscan_request(
                    account_id(),
                    NetworkId::Mainnet,
                    tracked.clone(),
                    true,
                    *offset,
                )
                .is_none()
            })
            .collect();
        let want: Vec<bool> = list(c, "blocked")
            .iter()
            .map(|b| b == &JsValue::Bool(true))
            .collect();
        assert_eq!(blocked, want, "{}", text(c, "name"));
    }
    for c in list(&block, "retryAfter") {
        let got = t::parse_retry_after_ms(Some(&text(c, "value")), 1_000_000.0);
        let narrowed = at(c, "narrowed") == &JsValue::Bool(true);
        assert_eq!(
            got,
            if narrowed { None } else { opt_num(c, "out") },
            "{:?}",
            c
        );
    }
}

type Chain<'a> = &'a JsValue;

// Answers one scan call from a scripted chain, as the TypeScript fake HistoryRpc does.
fn answer(chain: Chain, call: &RpcRequest) -> RpcReply {
    let body = t::parse_json(&call.body).unwrap();
    let id = call.id;
    let ok = |result: String| RpcReply {
        id,
        status: 200,
        body: Some(format!(
            r#"{{"jsonrpc":"2.0","id":{id},"result":{result}}}"#
        )),
    };
    match text(&body, "method").as_str() {
        "starknet_blockNumber" => ok(at(chain, "latest").to_json()),
        "starknet_getEvents" => {
            let filter = at(at(&body, "params"), "filter");
            let key = format!(
                "{}|{}|{}|{}",
                text(filter, "address"),
                list(filter, "keys").len() as i64 - 2,
                num(at(filter, "from_block"), "block_number"),
                opt_text(filter, "continuation_token").unwrap_or_default()
            );
            match at(chain, "pages").get(&key) {
                Some(JsValue::String(s)) if s == "semantic" => RpcReply {
                    id,
                    status: 200,
                    body: Some(format!(
                        r#"{{"jsonrpc":"2.0","id":{id},"error":{{"code":24,"message":"x"}}}}"#
                    )),
                },
                Some(page) => ok(page.to_json()),
                None => ok(r#"{"events":[]}"#.into()),
            }
        }
        _ => {
            let block = num(at(at(&body, "params"), "block_id"), "block_number");
            match at(chain, "timestamps").get(&t::number_to_string(block)) {
                Some(JsValue::Number(n)) => {
                    ok(format!(r#"{{"timestamp":{}}}"#, t::number_to_string(*n)))
                }
                _ => ok("{}".into()),
            }
        }
    }
}

// Drives a scan to completion; `fail_at` makes that call (1-based) a transport failure.
fn drive(scan: &HistoryScan, chain: Chain, fail_at: Option<usize>) -> bool {
    let mut sent = 0;
    loop {
        let calls = scan.next_calls();
        if calls.is_empty() {
            return true;
        }
        for call in calls {
            sent += 1;
            let reply = if Some(sent) == fail_at {
                RpcReply {
                    id: call.id,
                    status: 0,
                    body: None,
                }
            } else {
                answer(chain, &call)
            };
            if scan.accept(reply) == ScanStep::Transport {
                return false;
            }
        }
    }
}

#[test]
fn transfer_events_decode_like_the_extension() {
    for c in list(at(&fixture(), "events"), "decode") {
        let decoded = t::decode_transfer_event(at(c, "event"), ACCOUNT);
        match at(c, "out") {
            JsValue::Null => assert!(decoded.is_none(), "{:?}", c),
            out => {
                let d = decoded.unwrap_or_else(|| panic!("decodes {:?}", c));
                assert_eq!(d.amount_raw, text(out, "amountRaw"));
                assert_eq!(d.block_number as f64, num(out, "blockNumber"));
                assert_eq!(d.counterparty, text(out, "counterparty"));
                assert_eq!(
                    if d.incoming { "in" } else { "out" },
                    text(out, "direction")
                );
                assert_eq!(d.hash, text(out, "hash"));
            }
        }
    }
}

#[test]
fn history_scan_replays_collect_transaction_history() {
    for c in list(at(&fixture(), "events"), "scans") {
        let tokens: Vec<TokenConfig> = list(c, "tokens").iter().map(token).collect();
        let scan = HistoryScan::new(account_id(), NetworkId::Mainnet, tokens).unwrap();
        assert!(drive(&scan, at(c, "chain"), None), "{}", text(c, "name"));
        assert_eq!(
            entries_json(&scan.finish().unwrap()),
            expected_entries(at(c, "out")),
            "{}",
            text(c, "name")
        );
    }
}

#[test]
fn history_scan_fails_over_to_the_next_endpoint() {
    let fixture = fixture();
    let c = &list(at(&fixture, "events"), "scans")[0];
    let tokens: Vec<TokenConfig> = list(c, "tokens").iter().map(token).collect();
    let scan = HistoryScan::new(account_id(), NetworkId::Mainnet, tokens).unwrap();
    // First endpoint: the fourth call fails at transport level mid-scan.
    assert!(!drive(&scan, at(c, "chain"), Some(4)));
    assert!(
        scan.finish().is_err(),
        "a failed endpoint never yields a partial feed"
    );
    // Second endpoint answers: the replay yields exactly the extension's rows.
    scan.restart();
    assert!(drive(&scan, at(c, "chain"), None));
    assert_eq!(
        entries_json(&scan.finish().unwrap()),
        expected_entries(at(c, "out"))
    );
    // Every endpoint failing leaves only the local log, marked unavailable.
    let dir = tempfile::tempdir().unwrap();
    let book = t::activity_book(dir.path());
    let view = book.mark_unavailable(account_id(), NetworkId::Mainnet, 1_000.0);
    assert!(view.history_unavailable && view.entries.is_empty());
    assert!(!book.history_due(account_id(), NetworkId::Mainnet, false, 30_000.0));
    assert!(book.history_due(account_id(), NetworkId::Mainnet, false, 61_000.0));
}

#[test]
fn activity_ids_validator_and_merge() {
    let block = at(&fixture(), "activity").clone();
    for c in list(&block, "ids") {
        // Mobile has no devnet: a devnet id is refused (a deliberate, documented narrowing).
        let expected = opt_text(c, "out").filter(|id| !id.starts_with("SN_DEVNET:"));
        assert_eq!(
            t::canonical_account_id(&text(c, "value")),
            expected,
            "{:?}",
            c
        );
    }
    for c in list(&block, "entries") {
        assert_eq!(
            t::entry_from_json(at(c, "value")).is_some(),
            at(c, "out") == &JsValue::Bool(true),
            "{:?}",
            c
        );
    }
    for c in list(&block, "merge") {
        let read = |key: &str| {
            list(c, key)
                .iter()
                .map(|e| t::entry_from_json(e).expect("valid entry"))
                .collect::<Vec<_>>()
        };
        let merged = t::merge_activity(&read("local"), &read("onChain"));
        assert_eq!(entries_json(&merged), expected_entries(at(c, "out")));
    }
}

/// Audit #163 part A, the RPC cases from `planted-history-rows.test.ts`.
const PLANTED_ACCOUNT: &str = "0x6c16710431efd3962d3c6f55faf00d8c855188029acb42781b9ac77c438ade5";
const PLANTED_LOOKALIKE: &str = "0x1176a1bd84444c89232ec27754698e5d2e7e1a7f1539f12027f28b23ec9f3d8";
const PLANTED_TOKEN: &str = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const TRANSFER_KEY: &str = "0x99cd8bde557814842a3121e8ddfd433a539b8c9f14bf31ebf108d12e6196e9";

fn planted_event(from: &str, to: &str, amount: &str, hash: &str) -> JsValue {
    t::parse_json(&format!(
        r#"{{"block_number":10,"data":["{amount}","0"],"keys":["{TRANSFER_KEY}","{from}","{to}"],"transaction_hash":"{hash}"}}"#
    ))
    .expect("event")
}

#[test]
fn a_zero_amount_transfer_is_dropped_in_both_directions() {
    assert!(t::decode_transfer_event(
        &planted_event(PLANTED_ACCOUNT, PLANTED_LOOKALIKE, "0", "0x1"),
        PLANTED_ACCOUNT
    )
    .is_none());
    assert!(t::decode_transfer_event(
        &planted_event(PLANTED_LOOKALIKE, PLANTED_ACCOUNT, "0x0", "0x2"),
        PLANTED_ACCOUNT
    )
    .is_none());
    let kept = t::decode_transfer_event(
        &planted_event(PLANTED_ACCOUNT, PLANTED_LOOKALIKE, "1", "0x3"),
        PLANTED_ACCOUNT,
    )
    .expect("a non-zero transfer");
    assert!(!kept.incoming);
}

#[test]
fn a_planted_zero_transfer_never_becomes_a_sent_row() {
    let account_id = activity_account_id(NetworkId::Mainnet, PLANTED_ACCOUNT.into()).unwrap();
    let scan = HistoryScan::new(
        account_id,
        NetworkId::Mainnet,
        vec![TokenConfig {
            id: format!("SN_MAIN:STRK:{PLANTED_TOKEN}"),
            network: NetworkId::Mainnet,
            address: PLANTED_TOKEN.into(),
            symbol: "STRK".into(),
            name: "Starknet Token".into(),
            decimals: 18,
        }],
    )
    .unwrap();
    let page = format!(
        "[{},{},{}]",
        event_json(PLANTED_ACCOUNT, PLANTED_LOOKALIKE, "0", "0xbad"),
        event_json(PLANTED_LOOKALIKE, PLANTED_ACCOUNT, "0", "0xbad2"),
        event_json(PLANTED_ACCOUNT, PLANTED_LOOKALIKE, "5", "0x900d"),
    );
    loop {
        let calls = scan.next_calls();
        if calls.is_empty() {
            break;
        }
        for call in calls {
            let parsed = t::parse_json(&call.body).unwrap();
            let method = text(&parsed, "method");
            let result = match method.as_str() {
                "starknet_blockNumber" => "500".to_string(),
                "starknet_getEvents" => format!(r#"{{"events":{page}}}"#),
                "starknet_getBlockWithTxHashes" => r#"{"timestamp":1700000010}"#.to_string(),
                other => panic!("unexpected {other}"),
            };
            assert_eq!(
                scan.accept(RpcReply {
                    id: call.id,
                    status: 200,
                    body: Some(format!(
                        r#"{{"jsonrpc":"2.0","id":{},"result":{result}}}"#,
                        call.id
                    )),
                }),
                ScanStep::Continue
            );
        }
    }
    let rows = scan.finish().unwrap();
    assert_eq!(
        rows.iter().map(|row| row.hash.as_str()).collect::<Vec<_>>(),
        ["0x900d"]
    );
}

fn event_json(from: &str, to: &str, amount: &str, hash: &str) -> String {
    format!(
        r#"{{"block_number":10,"data":["{amount}","0"],"keys":["{TRANSFER_KEY}","{from}","{to}"],"transaction_hash":"{hash}"}}"#
    )
}
