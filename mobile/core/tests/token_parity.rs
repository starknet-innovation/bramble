//! Bramble's copy for the portfolio's transport failures against the extension's text
//! (`fixtures/portfolio-parity.jsonl`). The token rules themselves are `wallet_core::portfolio`'s,
//! checked over the same fixture in wallet-core (`crates/bramble-core/tests/token_parity.rs`); the
//! sentences are Bramble's (`token_network_error`, `balance_failure_copy`), so they are checked
//! here, through the exported wrappers.

mod common;

use bramble_core::portfolio_testing::JsValue;
use bramble_core::*;
use common::portfolio::*;

fn scripted_reply(id: u64, scripted: &JsValue) -> RpcReply {
    let body = match scripted {
        JsValue::String(s) if s == "transport" => None,
        s if s.get("code").is_some() => Some(format!(
            r#"{{"jsonrpc":"2.0","id":{id},"error":{{"code":{},"message":"error"}}}}"#,
            at(s, "code").to_json()
        )),
        s => Some(format!(
            r#"{{"jsonrpc":"2.0","id":{id},"result":{}}}"#,
            at(s, "result").to_json()
        )),
    };
    RpcReply {
        id,
        status: if body.is_some() { 200 } else { 0 },
        body,
    }
}

#[test]
fn transport_copy_matches_the_extension() {
    let fixture = fixture();
    let mut transport = 0;
    for c in list(&fixture, "tokenMeta") {
        let replies = ["name", "symbol", "decimals"]
            .iter()
            .enumerate()
            .map(|(i, k)| scripted_reply(i as u64 + 1, at(c, k)))
            .collect();
        if token_metadata_judge(NetworkId::Mainnet, text(c, "address"), 1, replies)
            == TokenMetaOutcome::Transport
        {
            transport += 1;
            assert_eq!(
                Some(token_network_error()),
                opt_text(at(c, "out"), "error"),
                "{:?}",
                c
            );
        }
    }
    assert!(transport > 0, "the fixture has a transport case");
    let fetch_failed = list(at(&fixture, "status"), "friendly")
        .iter()
        .find(|c| text(c, "raw") == "fetch failed")
        .expect("the fixture words a fetch failure");
    assert_eq!(
        Some(balance_failure_copy(true)),
        opt_text(fetch_failed, "out")
    );
}
