//! A read pinned to one accepted block is retried when that node has not seen the block, as the
//! extension's `atAcceptedBlock` (`account-compatibility.ts`). Three misses fail closed. Argent
//! and Braavos share the pin; OpenZeppelin reads `latest` and is not part of this.

mod send_support;

use std::sync::Arc;

use bramble_core::{
    AccountFamily, Ladder, NetworkId, RecoverySelection, SendStep, StepReply, TransferPlan,
    TransferRequest, WalletCore,
};
use send_support::*;
use serde_json::{json, Value};

fn class_hash(label: &str) -> String {
    bramble_core::account_classes()
        .into_iter()
        .find(|class| class.label == label)
        .unwrap_or_else(|| panic!("{label}"))
        .class_hash
}

fn account(family: AccountFamily, label: &str) -> (tempfile::TempDir, Arc<WalletCore>, String) {
    let (dir, _clock, core) = common_pending();
    let record = core
        .restore_recovered_accounts(
            NetworkId::Mainnet,
            vec![RecoverySelection {
                family,
                account_index: 0,
                ladder: matches!(family, AccountFamily::Argent).then_some(Ladder::Account),
                class_hash: Some(class_hash(label)),
            }],
        )
        .unwrap()
        .remove(0);
    (dir, core, record.id)
}

fn transfer(core: &Arc<WalletCore>, account_id: &str) -> Arc<TransferPlan> {
    core.clone()
        .prepare_transfer(TransferRequest {
            network: NetworkId::Mainnet,
            account_id: account_id.into(),
            token_address: STRK.into(),
            recipient: ACCOUNT_1.into(),
            amount: "1.5".into(),
            fee_balance: None,
        })
        .unwrap()
}

fn block() -> Value {
    json!({"result": {"block_hash": "0xb7aa05", "block_number": 1}})
}

fn miss(code: Option<i64>, message: &str) -> Value {
    let mut error = json!({"message": message});
    if let Some(code) = code {
        error["code"] = json!(code);
    }
    json!({"error": error})
}

/// Feeds `replies` in order. A `starknet_chainId` is answered from the network. Returns the step
/// once `replies` are spent or the plan stops asking.
fn play(
    plan: &TransferPlan,
    mut step: SendStep,
    mut replies: Vec<(&str, Value)>,
) -> (SendStep, Vec<String>) {
    let mut seen = Vec::new();
    loop {
        let SendStep::Rpc { .. } = &step else {
            return (step, seen);
        };
        let (id, method, _, _) = rpc_parts(&step);
        seen.push(method.clone());
        if method == "starknet_chainId" {
            let reply = json!({"result": chain_id(NetworkId::Mainnet)});
            step = plan.advance(rpc_reply(id, &reply)).unwrap();
            continue;
        }
        let Some((expected, _)) = replies.first() else {
            return (step, seen);
        };
        assert_eq!(&method, expected);
        let reply = replies.remove(0).1;
        step = plan.advance(rpc_reply(id, &reply)).unwrap();
    }
}

#[test]
fn a_block_miss_repins_once_for_argent_and_braavos() {
    let cases = [
        (
            AccountFamily::Argent,
            "argent 0.4.0",
            "argent 0.4.0",
            miss(Some(24), "Block not found"),
        ),
        (
            AccountFamily::Braavos,
            "braavos 1.0.0",
            "braavos current",
            miss(None, "Block not found"),
        ),
    ];
    for (family, record, live, missed) in cases {
        let (_dir, core, id) = account(family, record);
        let plan = transfer(&core, &id);
        let step = plan.advance(StepReply::Start).unwrap();
        let (step, seen) = play(
            &plan,
            step,
            vec![
                ("starknet_blockHashAndNumber", block()),
                ("starknet_getClassHashAt", missed),
                ("starknet_blockHashAndNumber", block()),
                (
                    "starknet_getClassHashAt",
                    json!({"result": class_hash(live)}),
                ),
            ],
        );
        let SendStep::Rpc { .. } = &step else {
            panic!("{record}: stopped at {step:?}");
        };
        let (_, method, _, _) = rpc_parts(&step);
        assert_eq!(method, "starknet_call", "{record}");
        assert_eq!(
            seen,
            [
                "starknet_chainId",
                "starknet_blockHashAndNumber",
                "starknet_getClassHashAt",
                "starknet_blockHashAndNumber",
                "starknet_getClassHashAt",
                "starknet_call",
            ],
            "{record}"
        );
        assert_eq!(plan.signatures_made(), 0);
    }
}

#[test]
fn a_third_block_miss_fails_closed_without_another_pin() {
    let (_dir, core, id) = account(AccountFamily::Braavos, "braavos 1.0.0");
    let plan = transfer(&core, &id);
    let step = plan.advance(StepReply::Start).unwrap();
    let missed = miss(Some(24), "Block not found");
    let (step, seen) = play(
        &plan,
        step,
        vec![
            ("starknet_blockHashAndNumber", block()),
            ("starknet_getClassHashAt", missed.clone()),
            ("starknet_blockHashAndNumber", block()),
            ("starknet_getClassHashAt", missed.clone()),
            ("starknet_blockHashAndNumber", block()),
            ("starknet_getClassHashAt", missed),
        ],
    );
    assert!(matches!(step, SendStep::Review), "{step:?}");
    assert!(!plan.current_review().unwrap().can_confirm);
    assert_eq!(
        seen.iter()
            .filter(|method| *method == "starknet_blockHashAndNumber")
            .count(),
        3
    );
    assert_eq!(plan.signatures_made(), 0);
}
