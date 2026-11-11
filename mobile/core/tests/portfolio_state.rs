//! The portfolio and history FFI objects' delegation to `wallet_core::{portfolio, history}` (the
//! activity book over the wallet directory's log), and the key boundary (nothing here touches key
//! material). The stateful cases themselves (price and snapshot caches, preferences, the
//! `format_fiat` property, the activity log's schema guards, the history-read cadence, the
//! Starkscan lane's authority and cooldown) are wallet-core's
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
        include_str!("../src/history/events.rs"),
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
fn history_objects_wrap_the_cores_log_and_scan() {
    let dir = tempfile::tempdir().unwrap();
    let book = t::activity_book(dir.path());
    let id = account_id();
    assert!(book.history_due(id.clone(), NetworkId::Mainnet, false, 0.0));
    let view = book.mark_unavailable(id.clone(), NetworkId::Mainnet, 1_000.0);
    assert!(view.history_unavailable && view.entries.is_empty());
    assert!(
        dir.path().join("activity.v1.json").exists(),
        "the book writes the wallet's log"
    );
    let restored = t::activity_book(dir.path());
    assert!(
        restored
            .cached(id.clone(), NetworkId::Mainnet)
            .history_unavailable
    );
    let view = book
        .starkscan_apply(id.clone(), NetworkId::Mainnet, tracked(), page(""), 2_000.0)
        .expect("an answering page is authoritative");
    assert!(!view.history_unavailable);
    assert!(!book.history_due(id.clone(), NetworkId::Mainnet, false, 2_000.0));
    let limited = HttpOutcome {
        status: 429,
        retry_after: Some("60".into()),
        body: None,
        timed_out: false,
    };
    assert!(book
        .starkscan_apply(id.clone(), NetworkId::Mainnet, tracked(), limited, 3_000.0)
        .is_none());
    assert!(
        book.starkscan_request(id.clone(), NetworkId::Mainnet, tracked(), true, 4_000.0)
            .is_none(),
        "the cooldown is kept in the object"
    );
    assert!(restored
        .starkscan_request(id.clone(), NetworkId::Mainnet, tracked(), true, 4_000.0)
        .is_some());
    let rows = book.scan_apply(id.clone(), NetworkId::Mainnet, Vec::new(), 5_000.0);
    assert_eq!(rows, book.cached(id.clone(), NetworkId::Mainnet));

    assert!(matches!(
        HistoryScan::new(id.clone(), NetworkId::Sepolia, tracked()),
        Err(CoreError::InvalidInput { .. })
    ));
    let idle = HistoryScan::new(id.clone(), NetworkId::Mainnet, Vec::new()).unwrap();
    assert!(idle.next_calls().is_empty());
    assert_eq!(idle.finish().unwrap(), Vec::new());
    let scan = HistoryScan::new(id, NetworkId::Mainnet, tracked()).unwrap();
    let calls = scan.next_calls();
    assert_eq!(calls.len(), 1);
    assert!(matches!(scan.finish(), Err(CoreError::Rpc { .. })));
    let failed = RpcReply {
        id: calls[0].id,
        status: 503,
        body: None,
    };
    assert_eq!(scan.accept(failed), ScanStep::Transport);
    scan.restart();
    assert_eq!(scan.next_calls().len(), 1);
}
