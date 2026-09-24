//! Stateful behaviour of the portfolio and activity objects that the parity fixture cannot pin on
//! its own: persistence and schema guards, the balance-snapshot and history-read cadences, the
//! Starkscan lane's authority, and the key boundary (nothing here touches key material).

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
    for doc in [
        "not json",
        r#"{"schema":"bramble.mobile.portfolio.v9","prices":{"fetchedAt":1,"prices":{}}}"#,
        r#"{"schema":"bramble.mobile.portfolio.v1","prices":{"fetchedAt":1,"prices":{"x":{"usd":1}}}}"#,
        r#"{"schema":"bramble.mobile.portfolio.v1","prices":{"fetchedAt":1,"prices":{},"evil":1}}"#,
    ] {
        let book = PriceBook::new(Some(doc.into()));
        match book.plan(
            NetworkId::Mainnet,
            vec![STRK.into()],
            DisplayCurrency::Usd,
            10.0,
            true,
        ) {
            PricePlan::Serve { view } => {
                assert!(view.prices.is_empty() && view.as_of_ms.is_none(), "{doc}")
            }
            PricePlan::Fetch { .. } => panic!("cached-only never fetches"),
        }
    }
    let snapshots = BalanceSnapshots::new(Some(r#"{"schema":"bramble.mobile.portfolio.v1","snapshots":[{"accountId":"SN_MAIN:0x0ab","balances":[],"fetchedAt":1,"networkId":"SN_MAIN"}]}"#.into()));
    assert_eq!(
        snapshots.plan("SN_MAIN:0x0ab".into(), NetworkId::Mainnet, 2.0, true, false),
        BalancePlan::Empty
    );
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
fn preferences_default_on_corruption_but_protect_newer_files() {
    let corrupt = TokenPreferences::new(Some(
        r#"{"schema":"bramble.mobile.portfolio.v1","tokens":"nope"}"#.into(),
    ));
    assert!(!corrupt.read_only());
    assert_eq!(corrupt.tracked(NetworkId::Mainnet).len(), 2);
    let newer = TokenPreferences::new(Some(
        r#"{"schema":"bramble.mobile.portfolio.v2","tokens":[]}"#.into(),
    ));
    assert!(newer.read_only() && newer.persisted().is_none());
    let prefs = TokenPreferences::new(None);
    prefs.set_display_currency(DisplayCurrency::Gbp);
    let id = prefs.tracked(NetworkId::Mainnet)[0].token.id.clone();
    prefs.set_hidden(id.clone(), true).unwrap();
    prefs.set_hidden(id.clone(), true).unwrap();
    let again = TokenPreferences::new(prefs.persisted());
    assert_eq!(again.display_currency(), DisplayCurrency::Gbp);
    assert!(again.tracked(NetworkId::Mainnet)[0].hidden_from_home);
    assert!(again.set_hidden(String::new(), true).is_err());
    assert!(again.explorer_fallback_allowed(NetworkId::Sepolia));
    assert!(again.discovery_candidates(NetworkId::Sepolia).is_empty());
    assert!(again
        .discovery_candidates(NetworkId::Mainnet)
        .iter()
        .all(|t| t.symbol != "STRK"));
}

#[test]
fn balance_snapshots_follow_cached_balances() {
    let snapshots = BalanceSnapshots::new(None);
    let id = account_id();
    assert_eq!(
        snapshots.plan(id.clone(), NetworkId::Mainnet, 1_000.0, false, false),
        BalancePlan::Load
    );
    assert_eq!(snapshots.failed(id.clone(), NetworkId::Mainnet), None);
    let token = tracked()[0].clone();
    let row = TokenBalance {
        token,
        balance: "5".into(),
        formatted: "0.000000000000000005".into(),
    };
    let view = snapshots.loaded(id.clone(), NetworkId::Mainnet, vec![row.clone()], 1_000.0);
    assert!(!view.stale);
    match snapshots.plan(id.clone(), NetworkId::Mainnet, 30_000.0, false, false) {
        BalancePlan::Serve { view } => assert!(!view.stale && view.balances == vec![row.clone()]),
        other => panic!("fresh snapshot is served, got {other:?}"),
    }
    assert_eq!(
        snapshots.plan(id.clone(), NetworkId::Mainnet, 30_000.0, false, true),
        BalancePlan::Load
    );
    assert_eq!(
        snapshots.plan(id.clone(), NetworkId::Mainnet, 61_000.0, false, false),
        BalancePlan::Load
    );
    let failed = snapshots.failed(id.clone(), NetworkId::Mainnet).unwrap();
    assert!(failed.stale && failed.balances == vec![row]);
    let restored = BalanceSnapshots::new(Some(snapshots.persisted()));
    assert!(
        matches!(restored.plan(id, NetworkId::Mainnet, 90_000.0, true, false), BalancePlan::Serve { view } if view.stale)
    );
    let issue = network_data_issue(
        BalanceHealth::Loaded {
            stale: true,
            as_of_ms: Some(1_000.0),
        },
        None,
    );
    assert_eq!(
        issue.as_deref(),
        Some("Using saved balances (01 Jan, 00:00 UTC).")
    );
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
fn formatted_fiat_never_leaks_exponents_or_nan() {
    let mut value = 1e-9;
    while value < 1e30 {
        for currency in [
            DisplayCurrency::Usd,
            DisplayCurrency::Eur,
            DisplayCurrency::Gbp,
        ] {
            let text = format_fiat(value, currency);
            assert!(
                !text.contains('e') && !text.contains("NaN") && !text.contains("inf"),
                "{value} → {text}"
            );
        }
        value *= 3.7;
    }
    assert_eq!(format_fiat(f64::NAN, DisplayCurrency::Usd), "$0.00");
    assert_eq!(format_fiat(f64::INFINITY, DisplayCurrency::Usd), "$0.00");
}

#[test]
fn portfolio_and_history_never_touch_key_material() {
    let sources = [
        include_str!("../src/portfolio/fiat.rs"),
        include_str!("../src/portfolio/prices.rs"),
        include_str!("../src/portfolio/price_cache.rs"),
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
