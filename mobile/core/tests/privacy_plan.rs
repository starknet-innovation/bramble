//! `PrivacyReadPlan` behaviour the fixture cannot show: reply ordering, lock, budgets, the page
//! cap, retries restarting from page one, the pinned `block_ref`, size bounds, and configuration.

mod privacy_support;

use bramble_core::{
    NetworkId, PrivacyError, PrivacyFailure, PrivacyPurpose, PrivacyReply, PrivacyStep,
};
use privacy_support::{drive, mainnet_plan, steady, wallet, Script, MAINNET_CHAIN, NOW};
use serde_json::json;

fn chain_reply(id: u64, now: u64) -> PrivacyReply {
    PrivacyReply::Rpc {
        id,
        body: format!(r#"{{"jsonrpc":"2.0","id":{id},"result":"{MAINNET_CHAIN}"}}"#),
        now_ms: now,
    }
}

fn id_of(step: &PrivacyStep) -> u64 {
    match step {
        PrivacyStep::Post { id, .. } | PrivacyStep::Rpc { id, .. } => *id,
        other => panic!("no id on {other:?}"),
    }
}

fn http(status: u16, body: serde_json::Value) -> (u16, Vec<u8>) {
    (status, body.to_string().into_bytes())
}

fn registered() -> (u16, Vec<u8>) {
    http(
        200,
        json!({ "block_ref": "0x1", "sender_registered": true }),
    )
}

fn fee() -> String {
    r#"{"jsonrpc":"2.0","id":0,"result":["0x5"]}"#.into()
}

fn incomplete_page(block: &str) -> (u16, Vec<u8>) {
    http(
        200,
        json!({ "block_ref": block, "channels": [], "notes": [], "cursor": { "channel_discovery_complete": false } }),
    )
}

fn complete_page(block: &str) -> (u16, Vec<u8>) {
    http(
        200,
        json!({ "block_ref": block, "channels": [], "notes": [], "cursor": { "channel_discovery_complete": true } }),
    )
}

fn script(pages: Vec<(u16, Vec<u8>)>) -> Script {
    Script {
        preflight: vec![registered()].into(),
        pages: pages.into(),
        fee: vec![fee()].into(),
    }
}

#[test]
fn a_reply_out_of_order_closes_the_plan() {
    let (_dir, core) = wallet();
    let plan = mainnet_plan(&core);
    let chain = plan.advance(PrivacyReply::Start { now_ms: NOW }).unwrap();
    assert!(matches!(
        chain,
        PrivacyStep::Rpc {
            purpose: PrivacyPurpose::ChainId,
            ..
        }
    ));
    let wrong = plan.advance(PrivacyReply::Http {
        id: id_of(&chain),
        status: 200,
        body: vec![],
        now_ms: NOW,
    });
    assert_eq!(wrong, Err(PrivacyError::OutOfOrder));
    assert_eq!(
        plan.advance(chain_reply(id_of(&chain), NOW)),
        Err(PrivacyError::PlanClosed)
    );

    let plan = mainnet_plan(&core);
    let chain = plan.advance(PrivacyReply::Start { now_ms: NOW }).unwrap();
    assert_eq!(
        plan.advance(chain_reply(id_of(&chain) + 1, NOW)),
        Err(PrivacyError::OutOfOrder)
    );

    let plan = mainnet_plan(&core);
    plan.close();
    assert_eq!(
        plan.advance(PrivacyReply::Start { now_ms: NOW }),
        Err(PrivacyError::PlanClosed)
    );
}

#[test]
fn a_wrong_chain_stops_before_any_post() {
    let (_dir, core) = wallet();
    let plan = mainnet_plan(&core);
    let chain = plan.advance(PrivacyReply::Start { now_ms: NOW }).unwrap();
    let id = id_of(&chain);
    let step = plan
        .advance(PrivacyReply::Rpc {
            id,
            body: format!(r#"{{"jsonrpc":"2.0","id":{id},"result":"0x534e5f5345504f4c4941"}}"#),
            now_ms: NOW,
        })
        .unwrap();
    assert_eq!(
        step,
        PrivacyStep::Failed {
            failure: PrivacyFailure::WrongChain
        }
    );
}

#[test]
fn a_lock_fails_the_next_derivation_even_after_a_new_unlock() {
    let (_dir, core) = wallet();
    let plan = mainnet_plan(&core);
    let chain = plan.advance(PrivacyReply::Start { now_ms: NOW }).unwrap();
    let preflight = plan.advance(chain_reply(id_of(&chain), NOW)).unwrap();
    assert!(matches!(
        preflight,
        PrivacyStep::Post {
            purpose: PrivacyPurpose::PreflightCheck,
            ..
        }
    ));
    core.lock();
    core.unlock(privacy_support::PASSWORD.into()).unwrap();
    let (status, body) = registered();
    let step = plan
        .advance(PrivacyReply::Http {
            id: id_of(&preflight),
            status,
            body,
            now_ms: NOW,
        })
        .unwrap();
    assert_eq!(
        step,
        PrivacyStep::Failed {
            failure: PrivacyFailure::Locked
        }
    );
}

#[test]
fn preparing_needs_an_unlocked_wallet_a_known_account_and_routing() {
    let (_dir, core) = wallet();
    assert_eq!(
        core.clone()
            .prepare_privacy_read(NetworkId::Sepolia, 0)
            .err(),
        Some(PrivacyError::NotConfigured)
    );
    assert_eq!(
        core.clone()
            .prepare_privacy_read(NetworkId::Mainnet, 5)
            .err(),
        Some(PrivacyError::UnknownAccount)
    );
    core.lock();
    assert_eq!(
        core.clone()
            .prepare_privacy_read(NetworkId::Mainnet, 0)
            .err(),
        Some(PrivacyError::Locked)
    );
}

#[test]
fn the_discovery_budget_is_per_attempt_on_host_time() {
    let (_dir, core) = wallet();
    // One page takes 61 s of host time: the attempt's 60 s budget has lapsed.
    let mut slow = |now: u64| now + 61_000;
    let run = drive(
        &mainnet_plan(&core),
        script(vec![complete_page("0x1")]),
        &mut slow,
    );
    assert_eq!(
        run.outcome.clone().unwrap().unwrap_err(),
        PrivacyFailure::BudgetExceeded
    );

    // 50 s, a throttled reply, a pause, then 50 s again: each attempt stays within its own budget.
    let mut half = |now: u64| now + 50_000;
    let throttled = http(429, json!({ "error": "Too Many Requests" }));
    let run = drive(
        &mainnet_plan(&core),
        script(vec![throttled, complete_page("0x1")]),
        &mut half,
    );
    assert!(run.outcome.clone().unwrap().is_ok());
    assert_eq!(run.waits, vec![1_000]);
}

#[test]
fn a_retry_restarts_discovery_from_the_first_page() {
    let (_dir, core) = wallet();
    let throttled = http(503, json!({ "error": "rate limit" }));
    let run = drive(
        &mainnet_plan(&core),
        script(vec![
            incomplete_page("0x1"),
            throttled,
            complete_page("0x2"),
        ]),
        &mut steady,
    );
    assert!(run.outcome.clone().unwrap().is_ok());
    let incoming: Vec<_> = run
        .posts
        .iter()
        .filter(|(_, _, p)| *p == PrivacyPurpose::IncomingState)
        .collect();
    assert_eq!(incoming.len(), 3);
    // The retried attempt starts over: its body is the first page's, with an empty cursor.
    assert_eq!(incoming[2].1, incoming[0].1);
    assert!(std::str::from_utf8(&incoming[2].1)
        .unwrap()
        .ends_with(r#""cursor":{}}"#));
    assert_eq!(run.waits, vec![1_000]);
}

#[test]
fn failures_keep_their_classification() {
    let (_dir, core) = wallet();
    let cases = [
        (
            http(409, json!({ "error": "BLOCK_REORGED" })),
            PrivacyFailure::Reorg,
        ),
        ((429, Vec::new()), PrivacyFailure::ServiceUnavailable),
        (
            (500, b"internal".to_vec()),
            PrivacyFailure::ServiceUnavailable,
        ),
        (
            (200, b"{not json".to_vec()),
            PrivacyFailure::InvalidResponse,
        ),
        (
            http(
                200,
                json!({ "block_ref": "pending", "channels": [], "notes": [], "cursor": {} }),
            ),
            PrivacyFailure::InvalidResponse,
        ),
        (
            (200, vec![b' '; 2 * 1024 * 1024 + 1]),
            PrivacyFailure::InvalidResponse,
        ),
    ];
    for ((status, body), failure) in cases {
        let run = drive(
            &mainnet_plan(&core),
            script(vec![(status, body)]),
            &mut steady,
        );
        assert_eq!(
            run.outcome.clone().unwrap().unwrap_err(),
            failure,
            "{status}"
        );
    }
    let throttled = || http(429, json!({ "error": "rate limit" }));
    let run = drive(
        &mainnet_plan(&core),
        script(vec![throttled(), throttled(), throttled()]),
        &mut steady,
    );
    assert_eq!(
        run.outcome.clone().unwrap().unwrap_err(),
        PrivacyFailure::RateLimited
    );
    assert_eq!(run.waits, vec![1_000, 2_000]);
}

#[test]
fn a_changed_block_ref_is_refused() {
    let (_dir, core) = wallet();
    let run = drive(
        &mainnet_plan(&core),
        script(vec![incomplete_page("0x1"), complete_page("0x2")]),
        &mut steady,
    );
    assert_eq!(
        run.outcome.clone().unwrap().unwrap_err(),
        PrivacyFailure::InvalidResponse
    );
    let run = drive(
        &mainnet_plan(&core),
        script(vec![incomplete_page("0x1"), complete_page("0x1")]),
        &mut steady,
    );
    assert!(run.outcome.clone().unwrap().is_ok());
    // The pinned block is echoed on the later page.
    let later = &run
        .posts
        .iter()
        .filter(|(_, _, p)| *p == PrivacyPurpose::IncomingState)
        .nth(1)
        .unwrap()
        .1;
    assert!(std::str::from_utf8(later)
        .unwrap()
        .ends_with(r#""block_ref":"0x1"}"#));
}

#[test]
fn pagination_stops_at_the_page_cap() {
    let (_dir, core) = wallet();
    let pages = (0..300).map(|_| incomplete_page("0x1")).collect();
    let run = drive(&mainnet_plan(&core), script(pages), &mut steady);
    assert_eq!(
        run.outcome.clone().unwrap().unwrap_err(),
        PrivacyFailure::InvalidResponse
    );
    assert_eq!(run.count(PrivacyPurpose::IncomingState), 256);
}

#[test]
fn an_unregistered_account_reads_no_notes() {
    let (_dir, core) = wallet();
    let script = Script {
        preflight: vec![http(
            200,
            json!({ "block_ref": "0x1", "sender_registered": false }),
        )]
        .into(),
        pages: Default::default(),
        fee: vec![fee()].into(),
    };
    let run = drive(&mainnet_plan(&core), script, &mut steady);
    let state = run.outcome.clone().unwrap().unwrap();
    assert!(state.balances.is_empty());
    assert_eq!(state.pool_fee_fri, "0x5");
    assert_eq!(run.count(PrivacyPurpose::IncomingState), 0);
}
