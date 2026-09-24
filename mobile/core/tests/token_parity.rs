//! The core's token identity, registry, spam, Home rows, glyphs, add-token and balance judges
//! against what the extension's TypeScript produced (`fixtures/portfolio-parity.jsonl`).

mod common;

use bramble_core::portfolio_testing::{self as t, JsValue};
use bramble_core::*;
use common::*;

fn is_true(value: &JsValue) -> bool {
    value == &JsValue::Bool(true)
}

#[test]
fn tokens_ids_registry_spam_home_and_glyphs() {
    let tokens = at(&fixture(), "tokens").clone();
    for c in list(&tokens, "ids") {
        assert_eq!(
            token_config_id(
                network(&text(c, "networkId")),
                text(c, "symbol"),
                text(c, "address")
            ),
            text(c, "out")
        );
    }
    for c in list(&tokens, "configs") {
        // Mobile supports mainnet and Sepolia only, so a devnet record is refused where the
        // extension accepts it: a deliberate narrowing (the app can never store one).
        let devnet = text(at(c, "value"), "networkId") == "SN_DEVNET";
        let expected = is_true(at(c, "out")) && !devnet;
        assert_eq!(
            t::token_config_from_json(at(c, "value")).is_some(),
            expected,
            "{:?}",
            c
        );
    }
    for c in list(&tokens, "addAddress") {
        assert_eq!(
            token_add_address(text(c, "input")),
            opt_text(c, "out"),
            "{:?}",
            c
        );
    }
    let prefs = TokenPreferences::new(None);
    let defaults: Vec<TokenConfig> = [NetworkId::Mainnet, NetworkId::Sepolia]
        .iter()
        .flat_map(|n| prefs.tracked(*n))
        .map(|t| t.token)
        .collect();
    assert_eq!(
        defaults,
        list(&tokens, "defaults")
            .iter()
            .map(token)
            .collect::<Vec<_>>()
    );
    for (code, known) in at(&tokens, "registry").as_object().unwrap() {
        assert_eq!(
            t::known_tokens(network(code)),
            known
                .as_array()
                .unwrap()
                .iter()
                .map(token)
                .collect::<Vec<_>>(),
            "{code}"
        );
    }
    for c in list(&tokens, "spam") {
        let cand = at(c, "candidate");
        let reasons: Vec<&str> = t::spam_reasons(
            network(&text(cand, "networkId")),
            &text(cand, "address"),
            &text(cand, "symbol"),
            &text(cand, "name"),
            num(cand, "decimals") as u8,
        )
        .into_iter()
        .map(|r| match r {
            SpamReason::EmptyName => "empty-name",
            SpamReason::AbsurdDecimals => "absurd-decimals",
            SpamReason::SymbolSpoof => "symbol-spoof",
        })
        .collect();
        let want: Vec<&str> = list(c, "out").iter().map(|r| r.as_str().unwrap()).collect();
        assert_eq!(reasons, want, "{:?}", cand);
    }
    for c in list(&tokens, "glyphs") {
        let glyph = token_glyph(text(c, "address"), text(c, "symbol"));
        let out = at(c, "out");
        assert_eq!(
            glyph.logo_address.is_some(),
            is_true(at(out, "logo")),
            "{:?}",
            c
        );
        if glyph.logo_address.is_none() {
            assert_eq!(Some(glyph.letters), opt_text(out, "letters"), "{:?}", c);
            assert_eq!(
                Some(glyph.tone.to_string()),
                opt_text(out, "tone"),
                "{:?}",
                c
            );
        }
    }
    let home = at(&tokens, "home");
    let mobile_tracked: Vec<JsValue> = list(home, "tracked")
        .iter()
        .filter(|t| text(t, "networkId") != "SN_DEVNET")
        .cloned()
        .collect();
    let doc = format!(
        r#"{{"schema":"bramble.mobile.portfolio.v1","tokens":{},"hiddenTokens":{},"displayCurrency":"usd","explorerFallback":{{}}}}"#,
        JsValue::Array(mobile_tracked).to_json(),
        at(home, "hidden").to_json()
    );
    let prefs = TokenPreferences::new(Some(doc));
    assert!(!prefs.read_only());
    let balances: Vec<TokenBalance> = list(home, "balances")
        .iter()
        .map(|b| t::balance_from_json(b).expect("balance"))
        .collect();
    let rows = prefs.home_rows(balances);
    let visible: Vec<String> = rows.visible.iter().map(|b| b.token.id.clone()).collect();
    let want: Vec<String> = list(home, "visible")
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect();
    assert_eq!(visible, want);
    assert_eq!(f64::from(rows.not_shown), num(home, "notShown"));
}

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
fn add_token_matches_the_handler() {
    for c in list(&fixture(), "tokenMeta") {
        let address = text(c, "address");
        let replies = ["name", "symbol", "decimals"]
            .iter()
            .enumerate()
            .map(|(i, k)| scripted_reply(i as u64 + 1, at(c, k)))
            .collect();
        let out = at(c, "out");
        match token_metadata_judge(NetworkId::Mainnet, address, 1, replies) {
            TokenMetaOutcome::Token { token } => {
                let added = TokenPreferences::new(None).add(token).unwrap();
                assert_eq!(added.token, common::token(at(out, "token")), "{:?}", c);
                assert_eq!(added.hidden_as_spam, is_true(at(out, "hidden")), "{:?}", c);
            }
            TokenMetaOutcome::Failed { message } => {
                assert_eq!(Some(message), opt_text(out, "error"), "{:?}", c)
            }
            TokenMetaOutcome::Transport => assert_eq!(
                Some(token_network_error()),
                opt_text(out, "error"),
                "{:?}",
                c
            ),
        }
    }
}

#[test]
fn balances_match_get_token_balances() {
    let block = at(&fixture(), "balances").clone();
    let tokens: Vec<TokenConfig> = list(&block, "tokens").iter().map(token).collect();
    for c in list(&block, "cases") {
        let replies = list(c, "replies")
            .iter()
            .enumerate()
            .map(|(i, r)| scripted_reply(i as u64 + 1, r))
            .collect();
        let out = at(c, "out");
        match balance_judge(1, tokens.clone(), replies) {
            BalanceOutcome::Balances { rows } => {
                let want = list(out, "balances");
                assert_eq!(rows.len(), want.len());
                for (row, want) in rows.iter().zip(want) {
                    assert_eq!(
                        (
                            row.token.id.clone(),
                            row.balance.clone(),
                            row.formatted.clone()
                        ),
                        (
                            text(want, "id"),
                            text(want, "balance"),
                            text(want, "formatted")
                        )
                    );
                }
            }
            BalanceOutcome::Failed => {
                assert_eq!(opt_text(out, "error").as_deref(), Some("failed"), "{:?}", c)
            }
            BalanceOutcome::Transport => assert_eq!(
                opt_text(out, "error").as_deref(),
                Some("transport"),
                "{:?}",
                c
            ),
        }
    }
}
