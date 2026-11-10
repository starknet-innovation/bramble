//! Preparing and running a send through mobile's wallet against a canned node: the record a plan
//! signs for, the address book and tracked tokens behind its flags, the refusals made before a
//! plan exists, and the activity store the plan's host writes. The plan mechanism itself
//! (ordering, fee ceilings, the deployment wait, node errors) is wallet-core's
//! `transactions_plan_mechanism.rs`. Nothing touches a network; lock and close semantics are in
//! `transactions_lifecycle.rs`.

mod send_support;

use bramble_core::{ReviewFlag, SendError, SendFailureCode, SendStep, StepReply, TxStatus};
use send_support::*;

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
    let record = &core
        .activity(oz_id(&core, bramble_core::NetworkId::Sepolia, 0))
        .unwrap()[0];
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
fn a_twin_of_a_saved_contact_is_refused() {
    let (_dir, core) = wallet();
    let mut node = sepolia(true);
    let contact = "0x0555aa7890abcdef1234567890abcdef1234567890abcdef1234567890aabbcc";
    core.save_contact(
        bramble_core::NetworkId::Sepolia,
        "Rent".into(),
        contact.into(),
        None,
        None,
    )
    .unwrap();
    let twin = "0x555af000000000000000000000000000000000000000000000000000000bbcc";
    let plan = reviewed(&core, &mut node, twin);
    let review = plan.current_review().unwrap();
    assert!(review.flags.contains(&ReviewFlag::AddressPoisoning) && !review.can_confirm);
    assert_eq!(
        failure(plan.advance(StepReply::Confirm).unwrap()).code,
        SendFailureCode::PoisonedRecipient
    );
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
fn a_tracked_token_recipient_is_warned_but_allowed() {
    let (_dir, core) = wallet();
    let mut node = sepolia(true);
    // Not a bundled or curated token: only the tracked list makes it known.
    let token = "0x7e57ab1ec0de";
    let mut request = request(token);
    // A host entry that is not a felt is ignored rather than failing the send.
    request.tracked_tokens = vec!["not a token".into(), token.into()];
    let plan = core.clone().prepare_transfer(request).unwrap();
    let first = plan.advance(StepReply::Start).unwrap();
    assert_eq!(
        run_until(&plan, &core, &mut node, first, never),
        SendStep::Review
    );
    let review = plan.current_review().unwrap();
    assert_eq!(review.flags, vec![ReviewFlag::TokenContractRecipient]);
    assert!(review.can_confirm);
}

#[test]
fn a_locked_wallet_cannot_prepare() {
    let (_dir, core) = wallet();
    let first = oz_id(&core, bramble_core::NetworkId::Sepolia, 0);
    core.lock();
    assert_eq!(
        core.clone().prepare_transfer(request(ACCOUNT_1)).err(),
        Some(SendError::Locked)
    );
    assert_eq!(
        core.clone().prepare_deployment(first.clone()).err(),
        Some(SendError::Locked)
    );
    core.unlock(PASSWORD.into()).unwrap();
    let mut beyond = request(ACCOUNT_1);
    beyond.account_id = "SN_SEPOLIA:0x5".into();
    assert_eq!(
        core.clone().prepare_transfer(beyond).err(),
        Some(SendError::UnknownAccount)
    );
    let mut elsewhere = request(ACCOUNT_1);
    elsewhere.account_id = oz_id(&core, bramble_core::NetworkId::Mainnet, 0);
    assert_eq!(
        core.clone().prepare_transfer(elsewhere).err(),
        Some(SendError::UnknownAccount),
        "the record must be on the request's network"
    );
}

/// Signing goes through the account record. Every family at one index shares a key, so a Braavos
/// record plans like an OpenZeppelin or Ready record; the plan reads the chain before it signs.
/// A vault still waiting for discovery has nothing to send from.
#[test]
fn braavos_records_plan_like_other_families() {
    let (_dir, _clock, core) = common_pending();
    let class = |label: &str| {
        bramble_core::account_classes()
            .into_iter()
            .find(|class| class.label == label)
            .unwrap()
            .class_hash
    };
    assert_eq!(
        core.clone().prepare_transfer(request(ACCOUNT_1)).err(),
        Some(SendError::UnknownAccount),
        "recovery pending"
    );
    let restored = core
        .restore_recovered_accounts(
            bramble_core::NetworkId::Sepolia,
            vec![
                bramble_core::RecoverySelection {
                    family: bramble_core::AccountFamily::OpenZeppelin,
                    account_index: 0,
                    ladder: None,
                    class_hash: None,
                },
                bramble_core::RecoverySelection {
                    family: bramble_core::AccountFamily::Argent,
                    account_index: 0,
                    ladder: None,
                    class_hash: Some(class("argent 0.4.0")),
                },
                bramble_core::RecoverySelection {
                    family: bramble_core::AccountFamily::Braavos,
                    account_index: 0,
                    ladder: None,
                    class_hash: Some(class("braavos 1.0.0")),
                },
            ],
        )
        .unwrap();
    // Ready (Argent) and Braavos records plan like OpenZeppelin ones; their chain state is
    // judged by the plan (wallet-core's `transactions_plan_parity.rs` and
    // `transactions_refusal_parity.rs`).
    let braavos = &restored[2];
    let mut transfer = request(ACCOUNT_1);
    transfer.account_id = braavos.id.clone();
    assert!(core.clone().prepare_transfer(transfer).is_ok());
    assert!(core.clone().prepare_deployment(braavos.id.clone()).is_ok());
    let mut ready = request(ACCOUNT_1);
    ready.account_id = restored[1].id.clone();
    assert!(core.clone().prepare_transfer(ready).is_ok());
    assert!(core
        .clone()
        .prepare_deployment(restored[1].id.clone())
        .is_ok());
    for record in &restored[1..] {
        // Reading activity is not signing; any stored record may be read.
        assert!(core.activity(record.id.clone()).unwrap().is_empty());
    }
    assert!(core.clone().prepare_transfer(request(ACCOUNT_1)).is_ok());
}
