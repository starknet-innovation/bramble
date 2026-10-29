//! Braavos sends and deployments must put on the wire exactly what the extension's real send
//! path puts there for the same account. `tests/fixtures/extension-transactions-braavos*.json`
//! records that path (`scripts/mobile-transactions-braavos.ts`) for the Braavos account at index
//! 0 of the published E2E phrase; this test drives `TransferPlan::advance` with the same replies
//! and requires JSON-equal request bodies in the same order (signature arrays included), the same
//! number of signed hashes, and the same transaction hash. The extension's refusals (an
//! undeployed account asked to send, the base class, a foreign signer, an active 2FA signer, an
//! unknown live class) must be refused here too, before anything is signed. Written by
//! `bun run mobile:parity`; `bun run check` fails on drift.

mod send_support;

use std::sync::Arc;

use bramble_core::{
    AccountFamily, NetworkId, RecoverySelection, SendFailureCode, SendStep, StepReply,
    TransferPlan, TransferRequest, TxStatus, WalletCore,
};
use send_support::*;
use serde_json::Value;

/// The published E2E phrase's Braavos account at index 0 under the scenario's class, in a
/// wallet that holds nothing else.
fn braavos_wallet(scenario: &Value) -> (tempfile::TempDir, Arc<WalletCore>, String) {
    let (dir, _clock, core) = common_pending();
    let network = network(scenario["networkId"].as_str().unwrap());
    let record = core
        .restore_recovered_accounts(
            network,
            vec![RecoverySelection {
                family: AccountFamily::Braavos,
                account_index: 0,
                ladder: None,
                class_hash: Some(scenario["recordClass"].as_str().unwrap().into()),
            }],
        )
        .unwrap()
        .remove(0);
    if let Some(account) = scenario.get("account") {
        // The mobile record is the account the extension signed for.
        assert_eq!(record.address, account["address"].as_str().unwrap());
        assert_eq!(record.public_key, account["publicKey"].as_str().unwrap());
    }
    (dir, core, record.id)
}

fn plan_for(core: &Arc<WalletCore>, scenario: &Value, account_id: &str) -> Arc<TransferPlan> {
    if scenario["flow"] == "deployment" {
        return core.clone().prepare_deployment(account_id.into()).unwrap();
    }
    core.clone()
        .prepare_transfer(TransferRequest {
            network: network(scenario["networkId"].as_str().unwrap()),
            account_id: account_id.into(),
            token_address: STRK.into(),
            recipient: ACCOUNT_1.into(),
            amount: "1.5".into(),
            fee_balance: None,
        })
        .unwrap()
}

#[test]
fn braavos_plans_match_the_extension_wire_capture() {
    let (scenarios, _) = braavos_fixture();
    assert_eq!(scenarios.len(), 6);
    for scenario in &scenarios {
        let name = scenario["name"].as_str().unwrap();
        let (_dir, core, id) = braavos_wallet(scenario);
        let network = network(scenario["networkId"].as_str().unwrap());
        assert_eq!(scenario["recipient"], ACCOUNT_1);
        assert_eq!(scenario["token"], STRK);
        let plan = plan_for(&core, scenario, &id);
        let mut node = Node::new(network, false);
        let step = plan.advance(StepReply::Start).unwrap();
        let step = drive(&plan, step, &review_calls(scenario), &mut node);
        assert_eq!(step, SendStep::Review, "{name}");
        let review = plan.current_review().unwrap();
        assert!(review.can_confirm, "{name}: {review:?}");
        for (fee, expected) in [
            (&review.fee, &scenario["reviewedFee"]),
            (&review.deployment_fee, &scenario["reviewedDeploymentFee"]),
        ] {
            assert_eq!(
                fee.as_ref().map(|fee| fee.max_spend.clone()),
                expected["overallFee"].as_str().map(String::from),
                "{name}"
            );
        }

        let step = plan.advance(StepReply::Confirm).unwrap();
        let submit = scenario["submit"].as_array().unwrap().clone();
        let step = drive(&plan, step, &submit, &mut node);
        let hash = scenario["transactionHash"].as_str().unwrap();
        assert_eq!(step, SendStep::Broadcast { hash: hash.into() }, "{name}");
        // Estimates and deployment parameters included: a deployment signs six hashes.
        assert_eq!(
            plan.signatures_made() as usize,
            scenario["signed"].as_array().unwrap().len(),
            "{name}"
        );
        let record = core
            .activity(id.clone())
            .unwrap()
            .into_iter()
            .find(|record| record.hash == hash)
            .expect("pending record");
        assert_eq!(record.status, TxStatus::Pending);
    }
}

#[test]
fn braavos_deployment_signs_parameters_before_the_transaction_hash() {
    let (scenarios, _) = braavos_fixture();
    let deployment = scenarios
        .iter()
        .find(|scenario| scenario["flow"] == "deployment")
        .unwrap();
    let signed = deployment["signed"].as_array().unwrap();
    let array = deployment["writeSignatures"][0].as_array().unwrap();
    // [r, s] over the deploy hash, the 11 parameters, then (aux_r, aux_s) over their hash.
    assert_eq!(array.len(), 15);
    let (params_hash, tx_hash) = (&signed[signed.len() - 2], &signed[signed.len() - 1]);
    assert_eq!(tx_hash["hash"], deployment["transactionHash"]);
    assert_eq!((&array[0], &array[1]), (&tx_hash["r"], &tx_hash["s"]));
    assert_eq!(
        (&array[13], &array[14]),
        (&params_hash["r"], &params_hash["s"])
    );
}

fn failure_code(code: &str) -> SendFailureCode {
    match code {
        "braavosDeployFirst" => SendFailureCode::BraavosDeployFirst,
        "braavosNotDeployable" => SendFailureCode::BraavosNotDeployable,
        "braavosClassUnrecognised" => SendFailureCode::BraavosClassUnrecognised,
        "braavosOwnerMismatch" => SendFailureCode::BraavosOwnerMismatch,
        "braavosSignerListMalformed" => SendFailureCode::BraavosSignerListMalformed,
        "braavosStrongSigner" => SendFailureCode::BraavosStrongSigner,
        other => panic!("unmapped refusal {other}"),
    }
}

#[test]
fn braavos_accounts_the_extension_refuses_are_refused_before_signing() {
    let (_, refusals) = braavos_fixture();
    let copy = fixture()["copy"]["failures"].clone();
    assert_eq!(refusals.len(), 9);
    for refusal in &refusals {
        let name = refusal["name"].as_str().unwrap();
        let code = refusal["code"].as_str().unwrap();
        let message = copy[code].as_str().unwrap();
        let (_dir, core, id) = braavos_wallet(refusal);
        let plan = plan_for(&core, refusal, &id);
        let mut node = Node::new(NetworkId::Mainnet, false);
        let step = plan.advance(StepReply::Start).unwrap();
        let step = drive(&plan, step, &review_calls(refusal), &mut node);
        if let Some(text) = refusal["reviewMessage"].as_str() {
            assert_eq!(text, message, "{name}");
            // The review step itself carries the extension's sentence. A fee-failed review
            // would leave the code unreachable: Confirm is `OutOfOrder` while `can_confirm` is false.
            let SendStep::Failed { failure } = step else {
                panic!("{name}: not refused, {step:?}");
            };
            assert_eq!(failure.code, failure_code(code), "{name}");
        } else {
            assert_eq!(step, SendStep::Review, "{name}");
            let step = plan.advance(StepReply::Confirm).unwrap();
            let submit = refusal["submit"].as_array().unwrap().clone();
            let SendStep::Failed { failure } = drive(&plan, step, &submit, &mut node) else {
                panic!("{name}: not refused");
            };
            assert_eq!(failure.code, failure_code(code), "{name}");
            assert_eq!(
                refusal["submitMessage"].as_str().unwrap(),
                message,
                "{name}"
            );
        }
        assert_eq!(plan.signatures_made(), 0, "{name}");
        assert!(core.activity(id).unwrap().is_empty(), "{name}");
    }
}

/// A `get_signers` array whose length overruns the result. The extension throws
/// "Braavos account returned a malformed signer list" (`parseBraavosSigners`); the
/// `braavosSignerListMalformed` fixture records that traffic, and this drives the same reads
/// without depending on the capture file.
#[test]
fn a_malformed_signer_list_fails_the_review_before_signing() {
    let classes = bramble_core::account_classes();
    let class_hash = |label: &str| {
        classes
            .iter()
            .find(|class| class.label == label)
            .unwrap_or_else(|| panic!("{label}"))
            .class_hash
            .clone()
    };
    // The record is the deployment class; the live class is an implementation this wallet signs for.
    let scenario = serde_json::json!({
        "recordClass": class_hash("braavos 1.0.0"),
        "networkId": "SN_MAIN",
        "flow": "transfer",
    });
    let (_dir, core, id) = braavos_wallet(&scenario);
    let plan = plan_for(&core, &scenario, &id);
    let mut step = plan.advance(StepReply::Start).unwrap();
    let scripted = [
        (
            "starknet_blockHashAndNumber",
            serde_json::json!({"result": {"block_hash": "0xb7aa05", "block_number": 1}}),
        ),
        (
            "starknet_getClassHashAt",
            serde_json::json!({"result": class_hash("braavos current")}),
        ),
        (
            "starknet_call",
            serde_json::json!({"result": ["0x2", "0x1"]}),
        ),
    ];
    let mut next = 0;
    loop {
        match &step {
            SendStep::Rpc { .. } => {
                let (rpc_id, method, _, _) = rpc_parts(&step);
                if method == "starknet_chainId" {
                    let reply = serde_json::json!({"result": chain_id(NetworkId::Mainnet)});
                    step = plan.advance(rpc_reply(rpc_id, &reply)).unwrap();
                    continue;
                }
                let (expected, reply) = &scripted[next];
                assert_eq!(&method, expected);
                next += 1;
                step = plan.advance(rpc_reply(rpc_id, reply)).unwrap();
            }
            SendStep::Failed { failure } => {
                assert_eq!(next, scripted.len());
                assert_eq!(failure.code, SendFailureCode::BraavosSignerListMalformed);
                assert_eq!(plan.signatures_made(), 0);
                assert!(core.activity(id).unwrap().is_empty());
                break;
            }
            other => panic!("unexpected step {other:?}"),
        }
    }
}
