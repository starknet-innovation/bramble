//! Shared helpers for the privacy integration tests: a wallet on the published parity phrase,
//! the committed privacy fixture, and a scripted service that answers a read plan. Nothing here
//! touches a network; every key is derived from the public parity phrase.
#![allow(dead_code)]

use std::collections::VecDeque;
use std::sync::Arc;

use bramble_core::{
    NetworkId, PrivacyFailure, PrivacyPurpose, PrivacyReadPlan, PrivacyReply, PrivacyState,
    PrivacyStep, WalletCore,
};
use serde_json::{json, Value};

pub const PHRASE: &str =
    "habit hope tip crystal because grunt nation idea electric witness alert like";
pub const PASSWORD: &str = "parity password";
pub const NOW: u64 = 1_790_000_000_000;
pub const MAINNET_CHAIN: &str = "0x534e5f4d41494e";
const SENDER: &str = "0x3fa78c2861131190760b151f3ee110f473940eca3fec8cc423ecc307b5241a3";
const ETH: &str = "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const STRK: &str = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

fn decode_rows(value: &mut Value, keys: &[&str]) {
    for key in keys {
        let rows: Vec<Value> = value[*key]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| serde_json::from_str(row.as_str().unwrap()).unwrap())
            .collect();
        value[*key] = Value::Array(rows);
    }
}

/// `extension-privacy-wire.json` with its row strings decoded.
pub fn wire() -> Value {
    let mut value: Value =
        serde_json::from_str(include_str!("../fixtures/extension-privacy-wire.json")).unwrap();
    decode_rows(&mut value, &["capture", "cases"]);
    value
}

/// `extension-privacy-rules.json` with its row strings decoded.
pub fn rules() -> Value {
    let mut value: Value =
        serde_json::from_str(include_str!("../fixtures/extension-privacy-rules.json")).unwrap();
    decode_rows(
        &mut value,
        &["compactAmounts", "journeys", "static", "unified"],
    );
    value
}

/// An unlocked wallet on the parity phrase.
pub fn wallet() -> (tempfile::TempDir, Arc<WalletCore>) {
    let dir = tempfile::tempdir().unwrap();
    let core = WalletCore::new(dir.path().to_string_lossy().into()).unwrap();
    core.import_wallet(PASSWORD.into(), PHRASE.into(), None)
        .unwrap();
    (dir, core)
}

/// `synthPages` from `scripts/mobile-privacy-cases.ts`, expanded identically.
pub fn synth_pages(spec: &Value) -> Vec<Value> {
    let tokens = spec["tokens"].as_u64().unwrap();
    let per = spec["notesPerToken"].as_u64().unwrap();
    let amount = spec["amount"].as_str().unwrap();
    let mut notes = Vec::new();
    for t in 0..tokens {
        let token = match t {
            0 => ETH.to_string(),
            1 => STRK.to_string(),
            n => format!("0x{:x}", 0x1000 + n),
        };
        for n in 0..per {
            notes.push(json!({
                "amount": amount, "block_number": 7, "index": n,
                "note_id": format!("0x{:x}", n + 1), "salt": "12345",
                "sender_addr": SENDER, "token": token,
            }));
        }
    }
    let body = json!({
        "block_ref": "0x5a1f00d",
        "channels": [{ "channel_key": "0x77", "sender_addr": SENDER }],
        "cursor": { "channel_discovery_complete": true },
        "notes": notes,
        "subchannels": [],
    });
    vec![json!({ "status": 200, "body": body.to_string() })]
}

/// Scripted replies for one plan, in the fixture's shape.
#[derive(Default)]
pub struct Script {
    pub preflight: VecDeque<(u16, Vec<u8>)>,
    pub pages: VecDeque<(u16, Vec<u8>)>,
    pub fee: VecDeque<String>,
}

fn replies(value: &Value) -> VecDeque<(u16, Vec<u8>)> {
    value
        .as_array()
        .unwrap()
        .iter()
        .map(|r| {
            (
                r["status"].as_u64().unwrap() as u16,
                r["body"].as_str().unwrap().as_bytes().to_vec(),
            )
        })
        .collect()
}

impl Script {
    pub fn from_case(script: &Value) -> Self {
        let pages = match script.get("synth") {
            Some(spec) => Value::Array(synth_pages(spec)),
            None => script["pages"].clone(),
        };
        Self {
            preflight: replies(&script["preflight"]),
            pages: replies(&pages),
            fee: script["fee"]
                .as_array()
                .unwrap()
                .iter()
                .map(|r| r["body"].as_str().unwrap().to_string())
                .collect(),
        }
    }
}

/// Everything a scripted run observed.
#[derive(Debug, Default)]
pub struct Run {
    pub outcome: Option<Result<PrivacyState, PrivacyFailure>>,
    pub posts: Vec<(String, Vec<u8>, PrivacyPurpose)>,
    pub rpcs: Vec<(String, PrivacyPurpose)>,
    pub waits: Vec<u32>,
    pub steps: Vec<PrivacyStep>,
}

impl Run {
    pub fn count(&self, purpose: PrivacyPurpose) -> usize {
        self.posts.iter().filter(|(_, _, p)| *p == purpose).count()
            + self.rpcs.iter().filter(|(_, p)| *p == purpose).count()
    }
}

/// Drives `plan` to a terminal step, answering from `script`; the host clock advances 10 ms per
/// reply unless `clock` says otherwise.
pub fn drive(plan: &PrivacyReadPlan, mut script: Script, clock: &mut dyn FnMut(u64) -> u64) -> Run {
    let mut run = Run::default();
    let mut now = NOW;
    let mut reply = PrivacyReply::Start { now_ms: now };
    loop {
        let step = plan
            .advance(reply)
            .expect("plan accepts the scripted reply");
        run.steps.push(step.clone());
        now = clock(now);
        reply = match step {
            PrivacyStep::Post {
                id,
                url,
                body,
                purpose,
            } => {
                run.posts.push((url, body, purpose));
                let queue = if purpose == PrivacyPurpose::PreflightCheck {
                    &mut script.preflight
                } else {
                    &mut script.pages
                };
                match queue.pop_front() {
                    Some((status, body)) => PrivacyReply::Http {
                        id,
                        status,
                        body,
                        now_ms: now,
                    },
                    None => PrivacyReply::Http {
                        id,
                        status: 599,
                        body: b"exhausted".to_vec(),
                        now_ms: now,
                    },
                }
            }
            PrivacyStep::Rpc { id, body, purpose } => {
                run.rpcs.push((body, purpose));
                let text = match purpose {
                    PrivacyPurpose::ChainId => {
                        format!(r#"{{"jsonrpc":"2.0","id":{id},"result":"{MAINNET_CHAIN}"}}"#)
                    }
                    _ => script
                        .fee
                        .pop_front()
                        .unwrap_or_default()
                        .replace("\"id\":0", &format!("\"id\":{id}")),
                };
                PrivacyReply::Rpc {
                    id,
                    body: text,
                    now_ms: now,
                }
            }
            PrivacyStep::Wait { delay_ms } => {
                run.waits.push(delay_ms);
                PrivacyReply::WaitElapsed { now_ms: now }
            }
            PrivacyStep::Finished { state } => {
                run.outcome = Some(Ok(state));
                return run;
            }
            PrivacyStep::Failed { failure } => {
                run.outcome = Some(Err(failure));
                return run;
            }
        };
    }
}

pub fn steady(now: u64) -> u64 {
    now + 10
}

pub fn mainnet_plan(core: &Arc<WalletCore>) -> Arc<PrivacyReadPlan> {
    core.clone()
        .prepare_privacy_read(NetworkId::Mainnet, 0)
        .unwrap()
}
