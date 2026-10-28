//! Ready (Argent) sends must put on the wire exactly what the extension's real send path puts
//! there for the same account. `tests/fixtures/extension-transactions-argent*.json` records that
//! path (`scripts/mobile-transactions-argent.ts`: `estimateInvokeFee`,
//! `estimateAccountDeploymentFee`, `submitErc20Transfer`, `submitAccountDeployment`) for Ready
//! accounts derived from the published E2E phrase, one per Argent deployment class; this test
//! drives `TransferPlan::advance` with the same replies and requires JSON-equal request bodies in
//! the same order, the same signature arrays, and the same transaction hashes. The extension's
//! refusals (an un-upgraded 0.3.x class, a foreign owner, a guardian, …) must be refused here too,
//! before anything is signed. Written by `bun run mobile:parity`; `bun run check` fails on drift.

mod send_support;

use std::sync::Arc;

use bramble_core::{
    AccountFamily, NetworkId, RecoverySelection, SendFailureCode, SendStep, StepReply,
    TransferPlan, TransferRequest, TxStatus, WalletCore,
};
use send_support::*;
use serde_json::{json, Value};

/// The published E2E phrase's Ready account at index 0 under the scenario's deployment class, in
/// a wallet that holds nothing else.
fn ready_wallet(scenario: &Value) -> (tempfile::TempDir, Arc<WalletCore>, String) {
    let (dir, _clock, core) = common_pending();
    let network = network(scenario["networkId"].as_str().unwrap());
    let label = scenario["recordClass"].as_str().unwrap();
    let class_hash = bramble_core::account_classes()
        .into_iter()
        .find(|class| class.label == label)
        .unwrap()
        .class_hash;
    let record = core
        .restore_recovered_accounts(
            network,
            vec![RecoverySelection {
                family: AccountFamily::Argent,
                account_index: 0,
                // The capture signs as `deriveAccount` derives by default: this wallet's ladder.
                ladder: Some(bramble_core::Ladder::Account),
                class_hash: Some(class_hash),
            }],
        )
        .unwrap()
        .remove(0);
    if let Some(account) = scenario.get("account") {
        // The mobile record is the account the extension signed for.
        assert_eq!(record.address, account["address"].as_str().unwrap());
        assert_eq!(record.public_key, account["publicKey"].as_str().unwrap());
        assert_eq!(
            record.deployment_salt.as_deref(),
            account["deploymentSalt"].as_str()
        );
    }
    // The record's shape is its deployment class's; what it runs now is read before signing.
    let shape = if label == "argent 0.4.0" {
        "argent-signer-array"
    } else {
        "stark-pair"
    };
    assert_eq!(record.authorization_shape, shape);
    (dir, core, record.id)
}

/// starknet.js sends `starknet_chainId` and `starknet_blockHashAndNumber` without params; the
/// core sends `[]`.
fn same_params(method: &str, mobile: &Value, extension: &Value) -> bool {
    let bare = ["starknet_chainId", "starknet_blockHashAndNumber"].contains(&method);
    mobile == extension || (bare && extension.is_null() && *mobile == json!([]))
}

/// Drives one phase: every RPC the plan emits must be the next recorded exchange. The review may
/// insert its opening `starknet_chainId` (the extension's review does not prove the chain).
fn drive(plan: &TransferPlan, mut step: SendStep, expected: &[Value], node: &mut Node) -> SendStep {
    let mut next = 0;
    loop {
        match &step {
            SendStep::Rpc { .. } => {
                let (id, method, params, _) = rpc_parts(&step);
                let reply = match expected.get(next) {
                    Some(exchange) if exchange["method"] == method.as_str() => {
                        assert!(
                            same_params(&method, &params, &exchange["params"]),
                            "{method} params differ:\nmobile    {params}\nextension {}",
                            exchange["params"]
                        );
                        next += 1;
                        exchange["reply"].clone()
                    }
                    _ if method == "starknet_chainId" => node.reply(&method, &params, None),
                    other => panic!(
                        "mobile sent {method} but the extension sent {:?}",
                        other.map(|e| e["method"].clone())
                    ),
                };
                step = plan.advance(rpc_reply(id, &reply)).unwrap();
            }
            SendStep::Wait { .. } => step = plan.advance(StepReply::WaitElapsed).unwrap(),
            _ => {
                assert_eq!(
                    next,
                    expected.len(),
                    "mobile stopped before the extension did"
                );
                return step;
            }
        }
    }
}

/// The review's recorded traffic, without the chain reads starknet.js makes inside estimates.
fn review_calls(scenario: &Value) -> Vec<Value> {
    ["reviewInvoke", "reviewDeployment"]
        .iter()
        .flat_map(|phase| scenario[phase].as_array().unwrap().clone())
        .filter(|exchange| exchange["method"] != "starknet_chainId")
        .collect()
}

fn transfer(core: &Arc<WalletCore>, scenario: &Value, account_id: &str) -> Arc<TransferPlan> {
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
fn ready_send_plan_matches_the_extension_wire_capture() {
    let (scenarios, _) = argent_fixture();
    assert_eq!(scenarios.len(), 7);
    for scenario in &scenarios {
        let name = scenario["name"].as_str().unwrap();
        let (_dir, core, id) = ready_wallet(scenario);
        let network = network(scenario["networkId"].as_str().unwrap());
        assert_eq!(scenario["recipient"], ACCOUNT_1);
        assert_eq!(scenario["token"], STRK);
        let is_transfer = scenario["flow"] == "transfer";
        let plan = if is_transfer {
            transfer(&core, scenario, &id)
        } else {
            core.clone().prepare_deployment(id.clone()).unwrap()
        };
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
        assert_eq!(
            plan.signatures_made() as usize,
            scenario["signatures"].as_array().unwrap().len(),
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
fn ready_signature_arrays_are_the_extensions_bit_for_bit() {
    let (scenarios, _) = argent_fixture();
    for scenario in &scenarios {
        let (_dir, core, id) = ready_wallet(scenario);
        let public_key = scenario["account"]["publicKey"].as_str().unwrap();
        let writes: Vec<&Value> = scenario["submit"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|e| e["method"].as_str().unwrap().starts_with("starknet_add"))
            .collect();
        let signatures = scenario["signatures"].as_array().unwrap();
        assert_eq!(signatures.len(), writes.len());
        for (signature, write) in signatures.iter().zip(writes) {
            // Argent 0.4's signer array: one signer, `Signer::Starknet`, its key, then (r, s).
            let expected = json!(["0x1", "0x0", public_key, signature["r"], signature["s"]]);
            assert_eq!(signature["array"], expected);
            let tx = write["params"]
                .as_object()
                .unwrap()
                .values()
                .next()
                .unwrap();
            assert_eq!(tx["signature"], expected);
            assert_eq!(
                write["reply"]["result"]["transaction_hash"],
                signature["hash"]
            );
            // The same record signs the same hash to the same (r, s) through the one gate.
            let signed = core
                .sign_hash_for_account(id.clone(), signature["hash"].as_str().unwrap().into())
                .unwrap();
            assert_eq!(
                (
                    signed.public_key.as_str(),
                    signed.r.as_str(),
                    signed.s.as_str()
                ),
                (
                    public_key,
                    signature["r"].as_str().unwrap(),
                    signature["s"].as_str().unwrap()
                )
            );
        }
    }
}

fn failure_code(code: &str) -> SendFailureCode {
    match code {
        "accountClassUnsupported" => SendFailureCode::AccountClassUnsupported,
        "accountClassUnrecognised" => SendFailureCode::AccountClassUnrecognised,
        "accountNotDeployable" => SendFailureCode::AccountNotDeployable,
        "accountOwnerMismatch" => SendFailureCode::AccountOwnerMismatch,
        "accountOwnerTypeUnsupported" => SendFailureCode::AccountOwnerTypeUnsupported,
        "accountGuardianUnsupported" => SendFailureCode::AccountGuardianUnsupported,
        other => panic!("unmapped refusal {other}"),
    }
}

#[test]
fn ready_accounts_the_extension_refuses_are_refused_before_signing() {
    let (_, refusals) = argent_fixture();
    let copy = fixture()["copy"]["failures"].clone();
    assert_eq!(refusals.len(), 9);
    for refusal in &refusals {
        let name = refusal["name"].as_str().unwrap();
        let (_dir, core, id) = ready_wallet(refusal);
        let plan = transfer(&core, refusal, &id);
        let mut node = Node::new(NetworkId::Mainnet, false);
        let step = plan.advance(StepReply::Start).unwrap();
        let step = drive(&plan, step, &review_calls(refusal), &mut node);
        assert_eq!(step, SendStep::Review, "{name}");
        let review = plan.current_review().unwrap();
        let code = refusal["code"].as_str().unwrap();
        let message = copy[code].as_str().unwrap();
        if refusal["reviewMessage"].is_string() {
            // The extension's review turns the refusal into a failed fee estimate.
            assert!(review.fee_estimate_failed && !review.can_confirm, "{name}");
            assert_eq!(
                refusal["reviewMessage"].as_str().unwrap(),
                message.replace("{label}", refusal["recordClass"].as_str().unwrap())
            );
            assert_eq!(
                plan.advance(StepReply::Confirm).err(),
                Some(bramble_core::SendError::OutOfOrder)
            );
        } else {
            assert!(review.can_confirm, "{name}: {review:?}");
            let step = plan.advance(StepReply::Confirm).unwrap();
            let submit = refusal["submit"].as_array().unwrap().clone();
            let SendStep::Failed { failure } = drive(&plan, step, &submit, &mut node) else {
                panic!("{name}: not refused");
            };
            assert_eq!(failure.code, failure_code(code), "{name}");
            let rendered = match &failure.detail {
                Some(label) => message.replace("{label}", label),
                None => message.to_string(),
            };
            assert_eq!(
                rendered,
                refusal["submitMessage"].as_str().unwrap(),
                "{name}"
            );
        }
        assert_eq!(plan.signatures_made(), 0, "{name}");
        assert!(core.activity(id).unwrap().is_empty(), "{name}");
    }
}
