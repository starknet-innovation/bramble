//! Plan lifecycle against a canned node: what happens when the app is backgrounded or the
//! wallet locked mid-send (review must-fix items 1, 2 and 4 in mobile/docs/transactions.md §10).

mod send_support;

use bramble_core::{SendError, SendFailureCode, SendStep, StepReply, TxStatus};
use send_support::*;
use serde_json::json;

#[test]
fn close_between_invoke_write_and_reply_keeps_the_pending_record() {
    let (_dir, core) = wallet();
    let mut node = sepolia(true);
    let plan = reviewed(&core, &mut node, ACCOUNT_1);
    let step = plan.advance(StepReply::Confirm).unwrap();
    let write = run_until(&plan, &core, &mut node, step, |_, write| write);
    let (id, method, params, _) = rpc_parts(&write);
    assert_eq!(method, "starknet_addInvokeTransaction");
    let hash = latest_hash(&core);
    plan.close(); // the app is backgrounded or locked while the write is in flight
    let reply = node.reply(&method, &params, Some(&hash));
    assert_eq!(
        plan.advance(rpc_reply(id, &reply)),
        Err(SendError::PlanClosed)
    );
    let records = core
        .activity(oz_id(&core, bramble_core::NetworkId::Sepolia, 0))
        .unwrap();
    assert_eq!(records.len(), 1);
    assert_eq!(
        (records[0].hash.as_str(), records[0].status),
        (hash.as_str(), TxStatus::Pending)
    );
    assert_eq!(records[0].summary, "Send 1.5 STRK to 0x3fa7…41a3");
    // The journey reports "status unknown" with the hash, never "not sent".
    let interrupted = plan.interrupted_failure().unwrap();
    assert_eq!(interrupted.code, SendFailureCode::SubmissionIndeterminate);
    assert_eq!(interrupted.hash.as_deref(), Some(hash.as_str()));

    // The record is settled later by reconciliation, not by the closed plan.
    let refresh = core
        .clone()
        .refresh_activity(
            oz_id(&core, bramble_core::NetworkId::Sepolia, 0),
            hash.clone(),
        )
        .unwrap();
    let done = run_until(
        &refresh,
        &core,
        &mut node,
        refresh.advance(StepReply::Start).unwrap(),
        never,
    );
    assert!(matches!(
        done,
        SendStep::Finished {
            status: TxStatus::Accepted,
            ..
        }
    ));
    assert_eq!(refresh.signatures_made(), 0);
}

#[test]
fn close_between_auto_deploy_write_and_reply_keeps_the_pending_record() {
    let (_dir, core) = wallet();
    let mut node = sepolia(false);
    let plan = reviewed(&core, &mut node, ACCOUNT_1);
    assert!(plan.current_review().unwrap().requires_deployment);
    let step = plan.advance(StepReply::Confirm).unwrap();
    let write = run_until(&plan, &core, &mut node, step, |_, write| write);
    assert_eq!(rpc_parts(&write).1, "starknet_addDeployAccountTransaction");
    let hash = latest_hash(&core);
    plan.close();
    assert_eq!(
        plan.advance(StepReply::WaitElapsed),
        Err(SendError::PlanClosed)
    );
    let records = core
        .activity(oz_id(&core, bramble_core::NetworkId::Sepolia, 0))
        .unwrap();
    assert_eq!(records.len(), 1, "the invoke was never signed");
    assert_eq!(records[0].summary, "Deploy account contract");
    assert_eq!(records[0].status, TxStatus::Pending);
    assert_eq!(plan.signatures_made(), 1);
    let interrupted = plan.interrupted_failure().unwrap();
    assert_eq!(interrupted.code, SendFailureCode::DeploymentUnconfirmed);
    assert_eq!(interrupted.hash.as_deref(), Some(hash.as_str()));

    // Three consecutive not-found answers settle it as rejected.
    for expected in [TxStatus::Pending, TxStatus::Pending, TxStatus::Rejected] {
        let refresh = core
            .clone()
            .refresh_activity(
                oz_id(&core, bramble_core::NetworkId::Sepolia, 0),
                hash.clone(),
            )
            .unwrap();
        let (id, ..) = rpc_parts(&refresh.advance(StepReply::Start).unwrap());
        let gone = json!({"error": {"code": 29, "message": "Transaction hash not found"}});
        let step = refresh.advance(rpc_reply(id, &gone)).unwrap();
        assert!(matches!(step, SendStep::Finished { status, .. } if status == expected));
    }
}

#[test]
fn lock_then_unlock_voids_a_reviewed_plan() {
    let (_dir, core) = wallet();
    let mut node = sepolia(true);
    let plan = reviewed(&core, &mut node, ACCOUNT_1);
    core.lock();
    core.unlock(PASSWORD.into()).unwrap();
    let failed = failure(plan.advance(StepReply::Confirm).unwrap());
    assert_eq!(failed.code, SendFailureCode::Locked);
    assert_eq!(plan.signatures_made(), 0);
    assert_eq!(plan.advance(StepReply::Confirm), Err(SendError::PlanClosed));
    assert!(
        plan.interrupted_failure().is_none(),
        "nothing left the device"
    );
}

#[test]
fn idle_lock_then_unlock_voids_a_reviewed_plan() {
    let (_dir, clock, core) = wallet_with_clock();
    let mut node = sepolia(true);
    let plan = reviewed(&core, &mut node, ACCOUNT_1);
    // No explicit lock: the session idles out, and a fresh unlock starts a new generation.
    clock.advance(bramble_core::testing::IDLE_LOCK_MS);
    core.unlock(PASSWORD.into()).unwrap();
    let failed = failure(plan.advance(StepReply::Confirm).unwrap());
    assert_eq!(failed.code, SendFailureCode::Locked);
    assert_eq!(plan.signatures_made(), 0);
}

#[test]
fn a_reviewed_plan_signs_in_its_own_session_and_renews_it() {
    let (_dir, clock, core) = wallet_with_clock();
    let mut node = sepolia(true);
    let plan = reviewed(&core, &mut node, ACCOUNT_1);
    clock.advance(bramble_core::testing::IDLE_LOCK_MS - 1_000);
    let step = plan.advance(StepReply::Confirm).unwrap();
    run_until(&plan, &core, &mut node, step, |method, _| {
        method == "starknet_addInvokeTransaction"
    });
    assert_eq!(plan.signatures_made(), 1);
    // Signing is user-initiated: the idle window restarted at the signature.
    assert!(core.session_remaining_ms().unwrap() > 1_000);
}

#[test]
fn lock_during_submit_is_refused_at_the_signing_point() {
    let (_dir, core) = wallet();
    let mut node = sepolia(true);
    let plan = reviewed(&core, &mut node, ACCOUNT_1);
    let step = plan.advance(StepReply::Confirm).unwrap();
    // Stop at the nonce read that precedes signing, lock and unlock, then answer it.
    let mut nonces = 0;
    let at_last_nonce = run_until(&plan, &core, &mut node, step, |method, _| {
        if method == "starknet_getNonce" {
            nonces += 1;
        }
        nonces == 2
    });
    let (id, method, params, _) = rpc_parts(&at_last_nonce);
    core.lock();
    core.unlock(PASSWORD.into()).unwrap();
    let failed = failure(
        plan.advance(rpc_reply(id, &node.reply(&method, &params, None)))
            .unwrap(),
    );
    assert_eq!(failed.code, SendFailureCode::Locked);
    assert_eq!(plan.signatures_made(), 0);
    assert!(core
        .activity(oz_id(&core, bramble_core::NetworkId::Sepolia, 0))
        .unwrap()
        .is_empty());
}

#[test]
fn delete_wallet_removes_activity() {
    let (dir, core) = wallet();
    let mut node = sepolia(true);
    let plan = reviewed(&core, &mut node, ACCOUNT_1);
    let step = plan.advance(StepReply::Confirm).unwrap();
    run_until(&plan, &core, &mut node, step, |_, w| w);
    assert!(dir.path().join("activity.v1.json").exists());
    core.delete_wallet(PASSWORD.into()).unwrap();
    assert!(!dir.path().join("activity.v1.json").exists());
}

#[test]
fn a_refused_invoke_write_leaves_no_activity_record() {
    let (_dir, core) = wallet();
    let mut node = sepolia(true);
    let plan = reviewed(&core, &mut node, ACCOUNT_1);
    let step = plan.advance(StepReply::Confirm).unwrap();
    let write = run_until(&plan, &core, &mut node, step, |_, write| write);
    let (id, ..) = rpc_parts(&write);
    let refused = json!({"error": {"code": 55, "message": "Account validation failed"}});
    let failed = failure(plan.advance(rpc_reply(id, &refused)).unwrap());
    assert_eq!(failed.code, SendFailureCode::NodeError);
    assert!(core
        .activity(oz_id(&core, bramble_core::NetworkId::Sepolia, 0))
        .unwrap()
        .is_empty());
}

#[test]
fn a_refused_deploy_write_leaves_no_activity_record() {
    let (_dir, core) = wallet();
    let mut node = sepolia(false);
    let plan = reviewed(&core, &mut node, ACCOUNT_1);
    let step = plan.advance(StepReply::Confirm).unwrap();
    let write = run_until(&plan, &core, &mut node, step, |_, write| write);
    let (id, ..) = rpc_parts(&write);
    let refused = json!({"error": {"code": 55, "message": "Account validation failed"}});
    let failed = failure(plan.advance(rpc_reply(id, &refused)).unwrap());
    assert_eq!(failed.code, SendFailureCode::AutoDeploymentFailed);
    assert!(core
        .activity(oz_id(&core, bramble_core::NetworkId::Sepolia, 0))
        .unwrap()
        .is_empty());
}

/// One activity list and store: a submitted transaction and an on-chain history row for the
/// same account land in the same log, keyed by the account record id that `activity_account_id`
/// builds, and the history merge promotes the pending row once the chain saw it.
#[test]
fn submitted_and_on_chain_rows_share_one_log() {
    use bramble_core::{activity_account_id, ActivityEntry, ActivityKind, NetworkId};
    let (_dir, core) = wallet();
    let mut node = sepolia(true);
    let plan = reviewed(&core, &mut node, ACCOUNT_1);
    let step = plan.advance(StepReply::Confirm).unwrap();
    run_until(&plan, &core, &mut node, step, |_, w| w);
    let hash = latest_hash(&core);
    let id = oz_id(&core, NetworkId::Sepolia, 0);
    let record = core.active_account().unwrap().unwrap();
    assert_eq!(
        activity_account_id(NetworkId::Sepolia, record.address).unwrap(),
        id
    );
    let incoming = ActivityEntry {
        account_id: id.clone(),
        amount: Some("2".into()),
        counterparty: Some("0x123".into()),
        failure_notice: None,
        finalized_on_l1: None,
        hash: "0x777".into(),
        kind: ActivityKind::Transfer,
        network: NetworkId::Sepolia,
        not_found_count: None,
        status: TxStatus::Accepted,
        submitted_at: 1,
        summary: "Received 2 STRK from 0x123".into(),
        token: Some("STRK".into()),
    };
    let book = core.activity_book();
    let view = book.scan_apply(id.clone(), NetworkId::Sepolia, vec![incoming], 2_000.0);
    assert_eq!(view.entries.len(), 2);
    let listed = core.activity(id.clone()).unwrap();
    assert_eq!(
        listed, view.entries,
        "the send journey and the feed read the same list"
    );
    assert!(listed
        .iter()
        .any(|e| e.hash == hash && e.status == TxStatus::Pending));
    assert_eq!(book.cached(id, NetworkId::Sepolia).entries, listed);
}

/// The extension's two observation tiers and its one-time "retired" notice, through the exported
/// surface the hosts use: a record whose write reply was lost stays observed for an hour, is then
/// retired with its status kept, and its notice is handed out exactly once. An accepted record
/// waiting on L1 stays on the slow tier for seven days.
#[test]
fn an_unresolved_record_is_retired_after_an_hour_with_one_notice() {
    use bramble_core::{
        activity_needs_observation, activity_observation_period_for,
        activity_observation_period_ms, NetworkId,
    };
    let (_dir, core) = wallet();
    let mut node = sepolia(true);
    let plan = reviewed(&core, &mut node, ACCOUNT_1);
    let step = plan.advance(StepReply::Confirm).unwrap();
    run_until(&plan, &core, &mut node, step, |_, write| write);
    plan.close();
    let id = oz_id(&core, NetworkId::Sepolia, 0);
    let record = core.activity(id.clone()).unwrap().remove(0);
    let hour = 60 * 60 * 1_000;
    let at = record.submitted_at;
    assert!(activity_needs_observation(record.clone(), at + hour - 1));
    assert!(!activity_needs_observation(record.clone(), at + hour));
    assert_eq!(activity_observation_period_for(record.clone()), 60_000);
    assert_eq!(activity_observation_period_ms(), 60_000);

    assert!(core
        .take_activity_notices(id.clone(), at + hour - 1)
        .unwrap()
        .is_empty());
    assert_eq!(
        core.take_activity_notices(id.clone(), at + hour).unwrap(),
        vec![format!(
            "Bramble could not confirm \"{}\". Check it on an explorer before retrying.",
            record.summary
        )]
    );
    assert!(core
        .take_activity_notices(id.clone(), at + 2 * hour)
        .unwrap()
        .is_empty());
    let retired = core.activity(id.clone()).unwrap().remove(0);
    assert_eq!(
        retired.status,
        TxStatus::Pending,
        "the outcome is never invented"
    );

    let week = 7 * 24 * hour;
    let accepted = bramble_core::ActivityEntry {
        status: TxStatus::Accepted,
        failure_notice: None,
        ..record
    };
    assert!(activity_needs_observation(accepted.clone(), at + week - 1));
    assert!(!activity_needs_observation(accepted.clone(), at + week));
    assert_eq!(
        activity_observation_period_for(accepted.clone()),
        15 * 60_000
    );
    let final_on_l1 = bramble_core::ActivityEntry {
        finalized_on_l1: Some(true),
        ..accepted
    };
    assert!(!activity_needs_observation(final_on_l1, at));
    core.lock();
    assert!(core.take_activity_notices(id, at).is_err(), "locked");
}
