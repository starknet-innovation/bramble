//! The send plan must put on the wire exactly what the extension's real send path puts there.
//! `tests/fixtures/extension-transactions-*.json` records that path (`submitErc20Transfer`,
//! `submitAccountDeployment`, and their reviews) against a canned node; this test drives
//! `TransferPlan::advance` with the same replies and requires JSON-equal request bodies in the
//! same order, the same signatures inside the signed bodies, and the same transaction hash.
//! Written by `bun run mobile:parity`; `bun run check` fails when it drifts.

mod send_support;

use bramble_core::{NetworkId, SendStep, StepReply, TransferRequest, TxStatus, WalletCore};
use send_support::*;
use serde_json::Value;

/// Methods mobile reads during review that the extension's review does not (it proves the chain
/// first, and the standalone deploy review reads deployment state to show "already deployed").
const MOBILE_EXTRA_REVIEW_READS: [&str; 2] = ["starknet_chainId", "starknet_getClassHashAt"];

fn same_params(method: &str, mobile: &Value, extension: &Value) -> bool {
    // starknet.js sends `starknet_chainId` without params; the core sends `[]`.
    method == "starknet_chainId" || mobile == extension
}

/// Drives one phase: every RPC the plan emits must be the next recorded exchange (review phases
/// may insert the extra reads above). Returns the first non-RPC, non-wait step.
fn drive(
    plan: &bramble_core::TransferPlan,
    mut step: SendStep,
    expected: &[Value],
    review: bool,
    fallback: &mut Node,
) -> SendStep {
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
                    _ if review && MOBILE_EXTRA_REVIEW_READS.contains(&method.as_str()) => {
                        fallback.reply(&method, &params, None)
                    }
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

fn fee_matches(fee: &Option<bramble_core::FeeAmount>, expected: &Value) {
    match (fee, expected.is_null()) {
        (Some(fee), false) => assert_eq!(fee.max_spend, expected["overallFee"].as_str().unwrap()),
        (None, true) => {}
        other => panic!("fee mismatch {other:?} vs {expected}"),
    }
}

fn run(core: &std::sync::Arc<WalletCore>, scenario: &Value) {
    let name = scenario["name"].as_str().unwrap();
    let network = network(scenario["networkId"].as_str().unwrap());
    let transfer = scenario["flow"] == "transfer";
    let plan = if transfer {
        core.clone()
            .prepare_transfer(TransferRequest {
                network,
                account_index: 0,
                token_address: scenario["token"].as_str().unwrap().into(),
                recipient: scenario["recipient"].as_str().unwrap().into(),
                amount: scenario["amount"].as_str().unwrap().into(),
                fee_balance: None,
            })
            .unwrap()
    } else {
        core.clone().prepare_deployment(network, 0).unwrap()
    };
    let deployed_at_review = scenario["reviewState"]["deployed"].as_bool().unwrap();
    let mut review_node = Node::new(network, deployed_at_review);
    let review_calls: Vec<Value> = ["reviewInvoke", "reviewDeployment"]
        .iter()
        .flat_map(|phase| scenario[phase].as_array().unwrap().clone())
        .filter(|exchange| exchange["method"] != "starknet_chainId")
        .collect();
    let step = plan.advance(StepReply::Start).unwrap();
    let step = drive(&plan, step, &review_calls, true, &mut review_node);
    assert_eq!(step, SendStep::Review, "{name}");
    let review = plan.current_review().unwrap();
    assert!(review.can_confirm, "{name}: {review:?}");
    fee_matches(&review.fee, &scenario["reviewedFee"]);
    fee_matches(&review.deployment_fee, &scenario["reviewedDeploymentFee"]);

    let step = plan.advance(StepReply::Confirm).unwrap();
    let submit: Vec<Value> = scenario["submit"].as_array().unwrap().clone();
    let step = drive(&plan, step, &submit, false, &mut review_node);
    let hash = scenario["transactionHash"].as_str().unwrap();
    assert_eq!(step, SendStep::Broadcast { hash: hash.into() }, "{name}");
    assert_eq!(
        plan.signatures_made() as usize,
        scenario["signatures"].as_array().unwrap().len(),
        "{name}"
    );

    // The pending record was written before the write left the core, keyed by the signed hash.
    let records = core.activity(network, 0).unwrap();
    let record = records
        .iter()
        .find(|r| r.hash == hash)
        .expect("pending record");
    assert_eq!(record.status, TxStatus::Pending);
    assert_eq!(record.submitted_at_ms, NOW);
    if transfer {
        assert_eq!(record.summary, "Send 1.5 STRK to 0x3fa7…41a3");
        assert_eq!(record.amount.as_deref(), Some("1.5"));
        assert_eq!(
            record.counterparty.as_deref(),
            scenario["recipient"].as_str()
        );
        assert_eq!(record.token.as_deref(), Some("STRK"));
    } else {
        assert_eq!(record.summary, "Deploy account contract");
    }
}

#[test]
fn send_plan_matches_the_extension_wire_capture() {
    let fixture = fixture();
    for scenario in fixture["scenarios"].as_array().unwrap() {
        // A fresh wallet per scenario: activity is keyed per account and must not carry over.
        let (_dir, core) = wallet();
        run(&core, scenario);
    }
}

#[test]
fn signed_hashes_and_signatures_match_the_extension() {
    // The add* bodies compared above carry the signature; this pins the hashes themselves.
    let fixture = fixture();
    for scenario in fixture["scenarios"].as_array().unwrap() {
        let signatures = scenario["signatures"].as_array().unwrap();
        let writes: Vec<&Value> = scenario["submit"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|e| e["method"].as_str().unwrap().starts_with("starknet_add"))
            .collect();
        assert_eq!(signatures.len(), writes.len());
        for (signature, write) in signatures.iter().zip(writes) {
            assert_eq!(
                write["reply"]["result"]["transaction_hash"],
                signature["hash"]
            );
            let tx = write["params"]
                .as_object()
                .unwrap()
                .values()
                .next()
                .unwrap();
            assert_eq!(tx["signature"][0], signature["r"]);
            assert_eq!(tx["signature"][1], signature["s"]);
        }
    }
    let _ = NetworkId::Mainnet;
}
