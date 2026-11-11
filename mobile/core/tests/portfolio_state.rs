//! Stateful behaviour of the activity objects that the parity fixture cannot pin on its own:
//! persistence and schema guards, the history-read cadence, the Starkscan lane's authority, the
//! portfolio FFI objects' delegation to `wallet_core::portfolio`, and the key boundary (nothing
//! here touches key material). The portfolio's own stateful cases (price and snapshot caches,
//! preferences, the `format_fiat` property) are wallet-core's
//! (`crates/bramble-core/tests/portfolio_state.rs`).

use bramble_core::portfolio_testing as t;
use bramble_core::*;

const ACCOUNT: &str = "0x208361e3911b1d93a704400b88e7e53a89171fce64dbb48f8479e4f44b398d9";
const STRK: &str = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

fn account_id() -> String {
    activity_account_id(NetworkId::Mainnet, ACCOUNT.into()).unwrap()
}

fn tracked() -> Vec<TokenConfig> {
    TokenPreferences::new(None)
        .tracked(NetworkId::Mainnet)
        .into_iter()
        .map(|t| t.token)
        .collect()
}

#[test]
fn caches_reject_unknown_or_tampered_documents() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join("activity.v1.json"),
        r#"{"version":1,"scopes":{"SN_MAIN:0xab":[{"accountId":"SN_MAIN:0xab","hash":"0xZZ"}]}}"#,
    )
    .unwrap();
    let activity = t::activity_book(dir.path());
    assert!(activity
        .cached("SN_MAIN:0xab".into(), NetworkId::Mainnet)
        .entries
        .is_empty());
}

#[test]
fn ffi_objects_wrap_the_cores_stores() {
    let book = PriceBook::new(None);
    assert!(matches!(
        book.chart_plan(NetworkId::Mainnet, "0x0".into(), DisplayCurrency::Usd, 0.0),
        Err(CoreError::InvalidInput { .. })
    ));
    assert_eq!(
        book.plan(
            NetworkId::Sepolia,
            vec![STRK.into()],
            DisplayCurrency::Usd,
            0.0,
            false
        ),
        PricePlan::Serve {
            view: PriceView {
                currency: DisplayCurrency::Usd,
                prices: Vec::new(),
                changes: Vec::new(),
                as_of_ms: None,
                stale: false,
            }
        }
    );
    let snapshots = BalanceSnapshots::new(None);
    let row = TokenBalance {
        token: tracked()[0].clone(),
        balance: "5".into(),
        formatted: "0.000000000000000005".into(),
    };
    snapshots.loaded(account_id(), NetworkId::Mainnet, vec![row.clone()], 1_000.0);
    let restored = BalanceSnapshots::new(Some(snapshots.persisted()));
    assert_eq!(
        restored
            .failed(account_id(), NetworkId::Mainnet)
            .map(|v| v.balances),
        Some(vec![row])
    );
    let prefs = TokenPreferences::new(None);
    assert!(matches!(
        prefs.set_hidden(String::new(), true),
        Err(CoreError::InvalidInput { .. })
    ));
    prefs.set_display_currency(DisplayCurrency::Gbp);
    let again = TokenPreferences::new(prefs.persisted());
    assert_eq!(again.display_currency(), DisplayCurrency::Gbp);
    assert_eq!(again.tracked(NetworkId::Mainnet).len(), 2);
}

fn page(items: &str) -> HttpOutcome {
    HttpOutcome {
        status: 200,
        retry_after: None,
        body: Some(format!(r#"{{"items":[{items}],"nextCursor":null}}"#).into_bytes()),
        timed_out: false,
    }
}

#[test]
fn history_cadence_and_lane_authority() {
    let dir = tempfile::tempdir().unwrap();
    let book = t::activity_book(dir.path());
    let id = account_id();
    assert!(
        book.history_due(id.clone(), NetworkId::Mainnet, false, 0.0),
        "never synced"
    );
    assert!(
        book.starkscan_request(id.clone(), NetworkId::Mainnet, tracked(), false, 0.0)
            .is_none(),
        "lane not permitted"
    );
    assert!(
        book.starkscan_request(id.clone(), NetworkId::Mainnet, Vec::new(), true, 0.0)
            .is_none(),
        "no tracked tokens"
    );
    let request = book
        .starkscan_request(id.clone(), NetworkId::Mainnet, tracked(), true, 1_000.0)
        .unwrap();
    assert!(
        request.url.starts_with("https://")
            && request
                .headers
                .iter()
                .all(|h| !h.name.to_lowercase().contains("key"))
    );
    let view = book
        .starkscan_apply(id.clone(), NetworkId::Mainnet, tracked(), page(""), 1_000.0)
        .expect("an answering page is authoritative");
    assert!(view.entries.is_empty() && !view.history_unavailable);
    assert!(!book.history_due(id.clone(), NetworkId::Mainnet, false, 1_000.0 + 299_000.0));
    assert!(book.history_due(id.clone(), NetworkId::Mainnet, false, 1_000.0 + 300_000.0));
    assert!(
        book.history_due(id.clone(), NetworkId::Mainnet, true, 2_000.0),
        "refresh forces"
    );
    assert!(
        book.history_due(id.clone(), NetworkId::Mainnet, false, 500.0),
        "sync in the future"
    );
    let local = ActivityEntry {
        account_id: id.clone(),
        amount: None,
        counterparty: None,
        direction: None,
        failure_notice: None,
        finalized_on_l1: None,
        hash: "0x0abc".into(),
        kind: ActivityKind::Invoke,
        network: NetworkId::Mainnet,
        not_found_count: None,
        status: TxStatus::Pending,
        submitted_at: 5_000,
        summary: "Send 1 STRK to 0x1234…abcd".into(),
        token: None,
        token_address: None,
    };
    assert!(t::record_activity(dir.path(), &local));
    assert!(
        book.history_due(id.clone(), NetworkId::Mainnet, false, 6_000.0),
        "a local row newer than the sync"
    );
    assert!(!t::record_activity(
        dir.path(),
        &ActivityEntry {
            summary: String::new(),
            ..local.clone()
        }
    ));
    let view = book.mark_unavailable(id.clone(), NetworkId::Mainnet, 7_000.0);
    assert!(view.history_unavailable && view.entries == vec![local.clone()]);
    assert!(!book.history_due(id.clone(), NetworkId::Mainnet, false, 66_000.0));
    assert!(book.history_due(id.clone(), NetworkId::Mainnet, false, 67_000.0));
    let restored = t::activity_book(dir.path());
    let cached = restored.cached(id, NetworkId::Mainnet);
    assert!(cached.history_unavailable && cached.entries == vec![local]);
}

#[test]
fn portfolio_and_history_never_touch_key_material() {
    let sources = [
        include_str!("../src/portfolio/fiat.rs"),
        include_str!("../src/portfolio/prices.rs"),
        include_str!("../src/portfolio/registry.rs"),
        include_str!("../src/portfolio/snapshots.rs"),
        include_str!("../src/portfolio/token_meta.rs"),
        include_str!("../src/portfolio/tokens.rs"),
        include_str!("../src/portfolio/wire.rs"),
        include_str!("../src/history/activity.rs"),
        include_str!("../src/history/activity_book.rs"),
        include_str!("../src/history/appearance.rs"),
        include_str!("../src/history/classify.rs"),
        include_str!("../src/history/events.rs"),
        include_str!("../src/history/starkscan.rs"),
    ];
    for source in sources {
        for forbidden in [
            "WalletCore",
            "crate::vault",
            "crate::kms",
            "crate::wallet",
            "Zeroizing",
            "mnemonic",
            "private_key",
            "viewing_key",
        ] {
            assert!(
                !source.contains(forbidden),
                "portfolio/history code must not reference {forbidden}"
            );
        }
    }
}

#[test]
fn starkscan_cooldown_is_in_memory_only() {
    let dir = tempfile::tempdir().unwrap();
    let book = t::activity_book(dir.path());
    let id = account_id();
    let limited = HttpOutcome {
        status: 429,
        retry_after: Some("60".into()),
        body: None,
        timed_out: false,
    };
    assert!(book
        .starkscan_apply(id.clone(), NetworkId::Mainnet, tracked(), limited, 1_000.0)
        .is_none());
    assert!(
        book.starkscan_request(id.clone(), NetworkId::Mainnet, tracked(), true, 2_000.0)
            .is_none(),
        "cooling down"
    );
    let saved = t::activity_file(dir.path()).unwrap_or_default();
    assert!(!saved.contains("RetryAt"), "the cooldown is never written");
    let restored = t::activity_book(dir.path());
    assert!(
        restored
            .starkscan_request(id, NetworkId::Mainnet, tracked(), true, 2_000.0)
            .is_some(),
        "a restart clears it, like createStarkscanClient"
    );
}
