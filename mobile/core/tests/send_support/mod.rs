//! Shared helpers for the send-plan integration tests: a wallet on the published E2E phrase and
//! a canned node. Nothing here touches a network.
#![allow(dead_code)]

use std::sync::Arc;

use bramble_core::{
    NetworkId, SendFailure, SendStep, StepReply, TransferPlan, TransferRequest, WalletCore,
};
use serde_json::{json, Value};

pub const PHRASE: &str =
    "habit hope tip crystal because grunt nation idea electric witness alert like";
pub const PASSWORD: &str = "parity password";
pub const STRK: &str = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
pub const ACCOUNT_0: &str = "0x208361e3911b1d93a704400b88e7e53a89171fce64dbb48f8479e4f44b398d9";
pub const ACCOUNT_1: &str = "0x3fa78c2861131190760b151f3ee110f473940eca3fec8cc423ecc307b5241a3";
pub const CLASS_HASH: &str = "0x1d1777db36cdd06dd62cfde77b1b6ae06412af95d57a13dc40ac77b8a702381";
pub const NOW: u64 = 1_790_000_000_000;

/// The transaction fixture, reassembled from its five files; wire exchanges are stored as one
/// JSON string each and decoded here.
pub fn fixture() -> Value {
    let mut whole = serde_json::Map::new();
    for text in [
        include_str!("../fixtures/extension-transactions-wire.json"),
        include_str!("../fixtures/extension-transactions-rules.json"),
        include_str!("../fixtures/extension-transactions-presentation.json"),
        include_str!("../fixtures/extension-transactions-status.json"),
        include_str!("../fixtures/extension-transactions-copy.json"),
    ] {
        let part: Value = serde_json::from_str(text).unwrap();
        whole.extend(part.as_object().unwrap().clone());
    }
    for scenario in whole["scenarios"].as_array_mut().unwrap() {
        for phase in ["reviewInvoke", "reviewDeployment", "submit"] {
            let decoded: Vec<Value> = scenario[phase]
                .as_array()
                .unwrap()
                .iter()
                .map(|line| serde_json::from_str(line.as_str().unwrap()).unwrap())
                .collect();
            scenario[phase] = Value::Array(decoded);
        }
    }
    Value::Object(whole)
}

pub fn network(id: &str) -> NetworkId {
    match id {
        "SN_MAIN" => NetworkId::Mainnet,
        "SN_SEPOLIA" => NetworkId::Sepolia,
        other => panic!("unexpected network {other}"),
    }
}

pub fn chain_id(network: NetworkId) -> &'static str {
    match network {
        NetworkId::Mainnet => "0x534e5f4d41494e",
        NetworkId::Sepolia => "0x534e5f5345504f4c4941",
    }
}

/// An unlocked wallet on the published phrase with two accounts.
pub fn wallet() -> (tempfile::TempDir, Arc<WalletCore>) {
    let dir = tempfile::tempdir().unwrap();
    let core = WalletCore::new(dir.path().to_string_lossy().into()).unwrap();
    core.import_wallet(PASSWORD.into(), PHRASE.into(), None)
        .unwrap();
    core.add_account(NetworkId::Sepolia).unwrap();
    (dir, core)
}

/// A JSON-RPC reply body for `id` carrying `{result}` or `{error}`.
pub fn reply_body(id: u64, reply: &Value) -> String {
    let mut body = json!({ "jsonrpc": "2.0", "id": id });
    for (key, value) in reply.as_object().unwrap() {
        body[key] = value.clone();
    }
    body.to_string()
}

pub fn rpc_reply(id: u64, reply: &Value) -> StepReply {
    StepReply::Rpc {
        id,
        body: reply_body(id, reply),
        now_ms: NOW,
    }
}

/// (id, method, params, is_write) of an RPC step.
pub fn rpc_parts(step: &SendStep) -> (u64, String, Value, bool) {
    match step {
        SendStep::Rpc {
            id, body, is_write, ..
        } => {
            let value: Value = serde_json::from_str(body).unwrap();
            assert_eq!(value["id"], json!(id));
            assert_eq!(value["jsonrpc"], "2.0");
            (
                *id,
                value["method"].as_str().unwrap().to_string(),
                value["params"].clone(),
                *is_write,
            )
        }
        other => panic!("expected an RPC step, got {other:?}"),
    }
}

/// A canned node: deployment state, nonce, and the estimate entry it returns per transaction.
pub struct Node {
    pub network: NetworkId,
    pub deployed: bool,
    pub nonce: String,
    pub invoke_estimate: Value,
    pub deploy_estimate: Value,
    pub status: Value,
}

impl Node {
    pub fn new(network: NetworkId, deployed: bool) -> Self {
        Self {
            network,
            deployed,
            nonce: "0x5".into(),
            invoke_estimate: json!({"l1_data_gas_consumed":"0x180","l1_data_gas_price":"0x5a0",
                "l1_gas_consumed":"0x0","l1_gas_price":"0x2d5c6b1e1ef","l2_gas_consumed":"0x1234a0",
                "l2_gas_price":"0xb2d05e00","overall_fee":"0x1","unit":"FRI"}),
            deploy_estimate: json!({"l1_data_gas_consumed":"0x1e0","l1_data_gas_price":"0x5a0",
                "l1_gas_consumed":"0x0","l1_gas_price":"0x2d5c6b1e1ef","l2_gas_consumed":"0xf4240",
                "l2_gas_price":"0xb2d05e00","overall_fee":"0xabc","unit":"FRI"}),
            status: json!({"execution_status":"SUCCEEDED","finality_status":"ACCEPTED_ON_L2"}),
        }
    }

    /// The reply this node gives to a request; writes echo the signed hash computed by the test.
    pub fn reply(&mut self, method: &str, params: &Value, signed: Option<&str>) -> Value {
        let not_found = json!({"error": {"code": 20, "message": "Contract not found"}});
        match method {
            "starknet_chainId" => json!({"result": chain_id(self.network)}),
            "starknet_getClassHashAt" if self.deployed => json!({"result": CLASS_HASH}),
            "starknet_getClassHashAt" => not_found,
            "starknet_getNonce" if self.deployed => json!({"result": self.nonce}),
            "starknet_getNonce" => not_found,
            "starknet_estimateFee" => {
                let entries: Vec<Value> = params["request"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|tx| {
                        if tx["type"] == "DEPLOY_ACCOUNT" {
                            self.deploy_estimate.clone()
                        } else {
                            self.invoke_estimate.clone()
                        }
                    })
                    .collect();
                json!({ "result": entries })
            }
            "starknet_addDeployAccountTransaction" => {
                self.deployed = true;
                self.nonce = "0x1".into();
                json!({"result": {"transaction_hash": signed.unwrap(), "contract_address": ACCOUNT_0}})
            }
            "starknet_addInvokeTransaction" => {
                json!({"result": {"transaction_hash": signed.unwrap()}})
            }
            "starknet_getTransactionStatus" => json!({ "result": self.status }),
            "starknet_getTransactionReceipt" => json!({"result": {"type": "DEPLOY_ACCOUNT"}}),
            other => panic!("unexpected method {other}"),
        }
    }
}

pub fn request(recipient: &str) -> TransferRequest {
    TransferRequest {
        network: bramble_core::NetworkId::Sepolia,
        account_index: 0,
        token_address: STRK.into(),
        recipient: recipient.into(),
        amount: "1.5".into(),
        fee_balance: Some("100000000000000000000".into()),
    }
}

pub fn latest_hash(core: &WalletCore) -> String {
    core.activity(bramble_core::NetworkId::Sepolia, 0).unwrap()[0]
        .hash
        .clone()
}

/// Answers every step from `node` until `stop(method, is_write)` holds or a non-RPC step
/// arrives; returns that step unanswered.
pub fn run_until(
    plan: &TransferPlan,
    core: &WalletCore,
    node: &mut Node,
    mut step: SendStep,
    mut stop: impl FnMut(&str, bool) -> bool,
) -> SendStep {
    loop {
        match &step {
            SendStep::Rpc { .. } => {
                let (id, method, params, is_write) = rpc_parts(&step);
                if stop(&method, is_write) {
                    return step;
                }
                let signed = is_write.then(|| latest_hash(core));
                let reply = node.reply(&method, &params, signed.as_deref());
                step = plan.advance(rpc_reply(id, &reply)).unwrap();
            }
            SendStep::Wait { .. } => step = plan.advance(StepReply::WaitElapsed).unwrap(),
            _ => return step,
        }
    }
}

pub fn never(_: &str, _: bool) -> bool {
    false
}

pub fn reviewed(core: &Arc<WalletCore>, node: &mut Node, recipient: &str) -> Arc<TransferPlan> {
    let plan = core.clone().prepare_transfer(request(recipient)).unwrap();
    let first = plan.advance(StepReply::Start).unwrap();
    assert_eq!(run_until(&plan, core, node, first, never), SendStep::Review);
    plan
}

pub fn failure(step: SendStep) -> SendFailure {
    match step {
        SendStep::Failed { failure } => failure,
        other => panic!("expected a failure, got {other:?}"),
    }
}

pub fn sepolia(deployed: bool) -> Node {
    Node::new(bramble_core::NetworkId::Sepolia, deployed)
}
