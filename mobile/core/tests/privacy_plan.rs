//! Mobile's `PrivacyReadPlan`: the FFI object's delegation to the shared core's plan, and the
//! wallet's own checks over a real `WalletCore` (a lock between steps, even one followed by a new
//! unlock; an unknown account or a locked wallet at prepare). The plan's rules (reply ordering,
//! budgets, the page cap, retries, the pinned `block_ref`, size bounds) are wallet-core's
//! `crates/bramble-core/tests/privacy_plan.rs`.

mod privacy_support;

use bramble_core::testing::strk20_viewing_key;
use bramble_core::{
    NetworkId, PrivacyError, PrivacyFailure, PrivacyPurpose, PrivacyReply, PrivacyStep,
};
use privacy_support::{account_id, mainnet_plan, wallet, wire, MAINNET_CHAIN, NOW, PHRASE};
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
            .prepare_privacy_read(account_id(&core, NetworkId::Sepolia))
            .err(),
        Some(PrivacyError::NotConfigured)
    );
    assert_eq!(
        core.clone()
            .prepare_privacy_read("SN_MAIN:0x5".into())
            .err(),
        Some(PrivacyError::UnknownAccount)
    );
    let mainnet = account_id(&core, NetworkId::Mainnet);
    core.lock();
    assert_eq!(
        core.clone().prepare_privacy_read(mainnet).err(),
        Some(PrivacyError::Locked)
    );
}

#[test]
fn the_ffi_plan_delegates_and_redacts_the_key_in_debug() {
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
    let preflight = plan.advance(chain_reply(id_of(&chain), NOW)).unwrap();
    let PrivacyStep::Post {
        url,
        body,
        purpose: PrivacyPurpose::PreflightCheck,
        ..
    } = &preflight
    else {
        panic!("expected the preflight post");
    };
    let discovery = bramble_core::privacy_discovery_url(NetworkId::Mainnet).unwrap();
    assert_eq!(url, &format!("{discovery}/v1/sync/preflight_check"));
    let keys = &wire()["viewingKeys"];
    let key = strk20_viewing_key(
        PHRASE,
        0,
        keys["chainId"].as_str().unwrap(),
        keys["pool"].as_str().unwrap(),
    )
    .unwrap();
    assert!(std::str::from_utf8(body).unwrap().contains(&key));
    let debug = format!("{preflight:?}");
    assert!(debug.contains("[redacted"));
    assert!(!debug.contains(key.trim_start_matches("0x")));
    // An out-of-order reply is the core's refusal, mapped, and closes the plan; so does `cancel`.
    assert_eq!(
        plan.advance(PrivacyReply::Start { now_ms: NOW }),
        Err(PrivacyError::OutOfOrder)
    );
    assert_eq!(
        plan.advance(PrivacyReply::Start { now_ms: NOW }),
        Err(PrivacyError::PlanClosed)
    );
    let plan = mainnet_plan(&core);
    plan.close();
    assert_eq!(
        plan.advance(PrivacyReply::Start { now_ms: NOW }),
        Err(PrivacyError::PlanClosed)
    );
}
