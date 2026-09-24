//! Send-plan behaviour against a canned node: refusals, ordering, fee ceilings, deployment wait,
//! and review must-fix regressions 3 and 5 (mobile/docs/transactions.md §10). Nothing touches a
//! network; lock and close semantics are in `transactions_lifecycle.rs`.

mod send_support;

use bramble_core::{
    ReviewFlag, SendError, SendFailure, SendFailureCode, SendStep, StepReply, TxStatus,
};
use send_support::*;
use serde_json::json;

#[test]
fn deployed_send_confirms_and_records() {
    let (_dir, core) = wallet();
    let mut node = sepolia(true);
    let plan = reviewed(&core, &mut node, ACCOUNT_1);
    let review = plan.current_review().unwrap();
    assert!(review.can_confirm && !review.requires_deployment);
    assert_eq!(review.fee.unwrap().display, "0.008053 STRK");
    assert_eq!(review.recipient_short, "0x3fa7…41a3");
    let step = plan.advance(StepReply::Confirm).unwrap();
    let SendStep::Broadcast { hash } = run_until(&plan, &core, &mut node, step, never) else {
        panic!("no broadcast");
    };
    let finished = run_until(
        &plan,
        &core,
        &mut node,
        plan.advance(StepReply::Proceed).unwrap(),
        never,
    );
    assert_eq!(
        finished,
        SendStep::Finished {
            status: TxStatus::Accepted,
            explorer_url: Some(format!("https://sepolia.starkscan.co/tx/{hash}")),
            hash: hash.clone(),
        }
    );
    let record = &core.activity(bramble_core::NetworkId::Sepolia, 0).unwrap()[0];
    assert_eq!(
        (record.hash.as_str(), record.status),
        (hash.as_str(), TxStatus::Accepted)
    );
}

#[test]
fn zero_recipient_is_refused_before_any_estimate() {
    let (_dir, core) = wallet();
    for zero in [
        "0x0",
        "0x0000000000000000000000000000000000000000000000000000000000000000",
        " 0X0 ",
    ] {
        let result = core.clone().prepare_transfer(request(zero));
        assert_eq!(result.err(), Some(SendError::InvalidRecipient), "{zero}");
    }
    let mut unknown = request(ACCOUNT_1);
    unknown.token_address = "0x123".into();
    assert_eq!(
        core.clone().prepare_transfer(unknown).err(),
        Some(SendError::UnknownToken)
    );
}

#[test]
fn estimate_node_error_at_confirm_is_a_node_error_not_a_fee_rise() {
    let (_dir, core) = wallet();
    let mut node = sepolia(true);
    let plan = reviewed(&core, &mut node, ACCOUNT_1);
    let step = plan.advance(StepReply::Confirm).unwrap();
    let estimate = run_until(&plan, &core, &mut node, step, |m, _| {
        m == "starknet_estimateFee"
    });
    let (id, ..) = rpc_parts(&estimate);
    let error = json!({"error": {"code": 41, "message": "Transaction execution error"}});
    let failed = failure(plan.advance(rpc_reply(id, &error)).unwrap());
    assert_eq!(failed.code, SendFailureCode::NodeError);
}

#[test]
fn a_fee_above_three_halves_is_refused_before_signing() {
    let (_dir, core) = wallet();
    let mut node = sepolia(true);
    let plan = reviewed(&core, &mut node, ACCOUNT_1);
    node.invoke_estimate["l2_gas_price"] = json!("0x165a0bc00"); // double the reviewed price
    let step = plan.advance(StepReply::Confirm).unwrap();
    let failed = failure(run_until(&plan, &core, &mut node, step, never));
    assert_eq!(failed.code, SendFailureCode::ReviewedFeeExceeded);
    assert_eq!(plan.signatures_made(), 0);
    assert!(core
        .activity(bramble_core::NetworkId::Sepolia, 0)
        .unwrap()
        .is_empty());
}

#[test]
fn write_transport_failure_is_indeterminate_and_never_resent() {
    let (_dir, core) = wallet();
    let mut node = sepolia(true);
    let plan = reviewed(&core, &mut node, ACCOUNT_1);
    let step = plan.advance(StepReply::Confirm).unwrap();
    let (id, ..) = rpc_parts(&run_until(&plan, &core, &mut node, step, |_, w| w));
    let hash = latest_hash(&core);
    let failed = failure(
        plan.advance(StepReply::TransportFailure { id, now_ms: NOW })
            .unwrap(),
    );
    assert_eq!(
        failed,
        SendFailure {
            code: SendFailureCode::SubmissionIndeterminate,
            hash: Some(hash)
        }
    );
    assert_eq!(
        plan.advance(StepReply::WaitElapsed),
        Err(SendError::PlanClosed)
    );
}

#[test]
fn a_different_broadcast_hash_is_a_mismatch() {
    let (_dir, core) = wallet();
    let mut node = sepolia(true);
    let plan = reviewed(&core, &mut node, ACCOUNT_1);
    let step = plan.advance(StepReply::Confirm).unwrap();
    let (id, ..) = rpc_parts(&run_until(&plan, &core, &mut node, step, |_, w| w));
    let other = json!({"result": {"transaction_hash": "0x1"}});
    assert_eq!(
        failure(plan.advance(rpc_reply(id, &other)).unwrap()).code,
        SendFailureCode::HashMismatch
    );
}

#[test]
fn a_poisoned_recipient_is_flagged_and_refused_at_confirm() {
    let (_dir, core) = wallet();
    let mut node = sepolia(true);
    let lookalike = "0x2083610000000000000000000000000000000000000000000000000000098d9";
    let plan = reviewed(&core, &mut node, lookalike);
    let review = plan.current_review().unwrap();
    assert!(review.flags.contains(&ReviewFlag::AddressPoisoning) && !review.can_confirm);
    let failed = failure(plan.advance(StepReply::Confirm).unwrap());
    assert_eq!(failed.code, SendFailureCode::PoisonedRecipient);
    assert_eq!(plan.signatures_made(), 0);
}

#[test]
fn self_transfer_is_flagged_but_allowed() {
    let (_dir, core) = wallet();
    let mut node = sepolia(true);
    let review = reviewed(&core, &mut node, ACCOUNT_0)
        .current_review()
        .unwrap();
    assert_eq!(review.flags, vec![ReviewFlag::SelfTransfer]);
    assert!(review.can_confirm);
}

#[test]
fn deploy_wait_gives_up_after_two_hundred_attempts() {
    let (_dir, core) = wallet();
    let mut node = sepolia(false);
    let plan = reviewed(&core, &mut node, ACCOUNT_1);
    node.status = json!({"finality_status": "RECEIVED"});
    let step = plan.advance(StepReply::Confirm).unwrap();
    let mut polls = 0;
    let mut step = run_until(&plan, &core, &mut node, step, |_, w| w);
    let (id, method, params, _) = rpc_parts(&step);
    let deploy_hash = latest_hash(&core);
    step = plan
        .advance(rpc_reply(
            id,
            &node.reply(&method, &params, Some(&deploy_hash)),
        ))
        .unwrap();
    loop {
        match &step {
            SendStep::Wait { delay_ms } => {
                assert_eq!(*delay_ms, 5_000);
                step = plan.advance(StepReply::WaitElapsed).unwrap();
            }
            SendStep::Rpc { .. } => {
                let (id, method, params, _) = rpc_parts(&step);
                assert_eq!(method, "starknet_getTransactionStatus");
                polls += 1;
                step = plan
                    .advance(rpc_reply(id, &node.reply(&method, &params, None)))
                    .unwrap();
            }
            _ => break,
        }
    }
    assert_eq!(polls, 200);
    assert_eq!(
        failure(step),
        SendFailure {
            code: SendFailureCode::DeploymentUnconfirmed,
            hash: Some(deploy_hash)
        }
    );
    assert_eq!(plan.signatures_made(), 1, "the invoke was never signed");
}

#[test]
fn unknown_deployment_state_fails_the_review_closed() {
    let (_dir, core) = wallet();
    let plan = core.clone().prepare_transfer(request(ACCOUNT_1)).unwrap();
    let (id, ..) = rpc_parts(&plan.advance(StepReply::Start).unwrap());
    let chain = json!({"result": chain_id(bramble_core::NetworkId::Sepolia)});
    let (id2, method, ..) = rpc_parts(&plan.advance(rpc_reply(id, &chain)).unwrap());
    assert_eq!(method, "starknet_getClassHashAt");
    let odd = json!({"error": {"code": 1, "message": "internal"}});
    assert_eq!(
        plan.advance(rpc_reply(id2, &odd)).unwrap(),
        SendStep::Review
    );
    let review = plan.current_review().unwrap();
    assert!(
        review.requires_deployment
            && review.fee_estimate_failed
            && review.deployment_fee_estimate_failed
    );
    assert!(!review.can_confirm);
    assert_eq!(plan.advance(StepReply::Confirm), Err(SendError::OutOfOrder));
}

#[test]
fn bulk_estimate_without_the_invoke_entry_fails_the_fee() {
    let (_dir, core) = wallet();
    let mut node = sepolia(false);
    node.invoke_estimate = json!(null);
    let plan = core.clone().prepare_transfer(request(ACCOUNT_1)).unwrap();
    let first = plan.advance(StepReply::Start).unwrap();
    let step = run_until(&plan, &core, &mut node, first, |m, _| {
        m == "starknet_estimateFee"
    });
    let (id, ..) = rpc_parts(&step);
    let only_deploy = json!({"result": [node.deploy_estimate.clone()]});
    let step = plan.advance(rpc_reply(id, &only_deploy)).unwrap();
    assert_eq!(
        run_until(&plan, &core, &mut node, step, never),
        SendStep::Review
    );
    let review = plan.current_review().unwrap();
    assert!(review.fee_estimate_failed && review.deployment_fee.is_some() && !review.can_confirm);
}

#[test]
fn wrong_chain_and_out_of_order_replies_close_the_plan() {
    let (_dir, core) = wallet();
    let plan = core.clone().prepare_transfer(request(ACCOUNT_1)).unwrap();
    let (id, ..) = rpc_parts(&plan.advance(StepReply::Start).unwrap());
    let mainnet = json!({"result": chain_id(bramble_core::NetworkId::Mainnet)});
    assert_eq!(
        failure(plan.advance(rpc_reply(id, &mainnet)).unwrap()).code,
        SendFailureCode::WrongChain
    );

    let plan = core.clone().prepare_transfer(request(ACCOUNT_1)).unwrap();
    assert_eq!(plan.advance(StepReply::Confirm), Err(SendError::OutOfOrder));
    assert_eq!(plan.advance(StepReply::Start), Err(SendError::PlanClosed));

    let plan = core.clone().prepare_transfer(request(ACCOUNT_1)).unwrap();
    let (id, ..) = rpc_parts(&plan.advance(StepReply::Start).unwrap());
    let chain = json!({"result": chain_id(bramble_core::NetworkId::Sepolia)});
    assert_eq!(
        plan.advance(rpc_reply(id + 1, &chain)),
        Err(SendError::OutOfOrder)
    );

    let mut node = sepolia(true);
    let plan = reviewed(&core, &mut node, ACCOUNT_1);
    assert!(matches!(
        plan.advance(StepReply::Confirm).unwrap(),
        SendStep::Rpc { .. }
    ));
    assert_eq!(plan.advance(StepReply::Confirm), Err(SendError::OutOfOrder));
}

#[test]
fn a_locked_wallet_cannot_prepare() {
    let (_dir, core) = wallet();
    core.lock();
    assert_eq!(
        core.clone().prepare_transfer(request(ACCOUNT_1)).err(),
        Some(SendError::Locked)
    );
    assert_eq!(
        core.clone()
            .prepare_deployment(bramble_core::NetworkId::Sepolia, 0)
            .err(),
        Some(SendError::Locked)
    );
    core.unlock(PASSWORD.into()).unwrap();
    let mut beyond = request(ACCOUNT_1);
    beyond.account_index = 5;
    assert_eq!(
        core.clone().prepare_transfer(beyond).err(),
        Some(SendError::UnknownAccount)
    );
}
