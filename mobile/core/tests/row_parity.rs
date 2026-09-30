//! Activity rows, day groups, header freshness copy, timestamps, sparklines and explorer links
//! against the side panel's own renderers (`fixtures/portfolio-parity.jsonl`).

mod common;

use bramble_core::portfolio_testing::{self as t, JsValue};
use bramble_core::*;
use common::portfolio::*;

fn loose_entry(v: &JsValue) -> ActivityEntry {
    ActivityEntry {
        account_id: text(v, "accountId"),
        amount: opt_text(v, "amount"),
        counterparty: opt_text(v, "counterparty"),
        failure_notice: None,
        finalized_on_l1: None,
        hash: text(v, "hash"),
        kind: match text(v, "kind").as_str() {
            "transfer" => ActivityKind::Transfer,
            "deploy" => ActivityKind::Deploy,
            "declare" => ActivityKind::Declare,
            _ => ActivityKind::Invoke,
        },
        network: network(&text(v, "networkId")),
        not_found_count: None,
        status: match text(v, "status").as_str() {
            "pending" => TxStatus::Pending,
            "preconfirmed" => TxStatus::Preconfirmed,
            "rejected" => TxStatus::Rejected,
            "reverted" => TxStatus::Reverted,
            _ => TxStatus::Accepted,
        },
        submitted_at: num(v, "submittedAt") as u64,
        summary: text(v, "summary"),
        token: opt_text(v, "token"),
    }
}

/// `activityRowModel`, less the fiat figure no row renders any more.
fn assert_model(model: &t::ActivityRowModel, expected: &JsValue, ctx: &str) {
    assert_eq!(model.title, text(expected, "title"), "{ctx}");
    assert_eq!(model.icon, text(expected, "icon"), "{ctx}");
    assert_eq!(model.label, text(expected, "label"), "{ctx}");
    assert_eq!(model.kind, text(expected, "type"), "{ctx}");
    let direction = model.direction.map(|d| match d {
        ActivityDirection::In => "in",
        ActivityDirection::Out => "out",
        ActivityDirection::Internal => "internal",
    });
    assert_eq!(
        direction.map(str::to_string),
        opt_text(expected, "direction"),
        "{ctx}"
    );
    assert_eq!(model.amount, opt_text(expected, "amount"), "{ctx}");
    assert_eq!(model.detail, opt_text(expected, "detail"), "{ctx}");
    let counterparty = expected
        .get("counterparty")
        .filter(|c| **c != JsValue::Null)
        .map(|c| (text(c, "address"), text(c, "role")));
    assert_eq!(
        model
            .counterparty
            .as_ref()
            .map(|(address, role)| (address.clone(), role.to_string())),
        counterparty,
        "{ctx}"
    );
    assert_eq!(
        model.token_symbol,
        opt_text(expected, "tokenSymbol"),
        "{ctx}"
    );
    assert_eq!(
        model.token_address,
        opt_text(expected, "tokenAddress"),
        "{ctx}"
    );
}

/// `transactionRow` as rendered: the disclosure's summary, then its expansion.
fn assert_row(row: &ActivityRow, html: &JsValue, ctx: &str) {
    assert_eq!(Some(row.heading.clone()), opt_text(html, "title"), "{ctx}");
    assert_eq!(
        Some(row.accessibility_label.clone()),
        opt_text(html, "accessible"),
        "{ctx}"
    );
    assert_eq!(
        Some(row.glyph_title.clone()),
        opt_text(html, "glyphTitle"),
        "{ctx}"
    );
    assert_eq!(
        Some(row.hash_label.clone()),
        opt_text(html, "hash"),
        "{ctx}"
    );
    assert_eq!(
        Some(row.hash_copy_label.clone()),
        opt_text(html, "hashCopyLabel"),
        "{ctx}"
    );
    assert_eq!(
        Some(row.hash.clone()),
        opt_text(html, "hashCopyValue"),
        "{ctx}"
    );
    assert_eq!(row.explorer_url, opt_text(html, "href"), "{ctx}");
    assert_eq!(row.status_word, opt_text(html, "meta"), "{ctx}");
    assert_eq!(Some(row.timing.clone()), opt_text(html, "timing"), "{ctx}");
    let expected = at(html, "counterparty");
    match &row.counterparty {
        None => assert_eq!(expected, &JsValue::Null, "{ctx}"),
        Some(c) => {
            assert_eq!(c.role, text(expected, "role"), "{ctx}");
            assert_eq!(c.address, text(expected, "address"), "{ctx}");
            assert_eq!(c.address_label, text(expected, "label"), "{ctx}");
            assert_eq!(c.copy_label, text(expected, "copyLabel"), "{ctx}");
            assert_eq!(c.address, text(expected, "copyValue"), "{ctx}");
        }
    }
    assert_eq!(row.detail, opt_text(html, "detail"), "{ctx}");
    assert_eq!(row.submitted, opt_text(html, "submitted"), "{ctx}");
    assert_eq!(row.status_hint, opt_text(html, "statusHint"), "{ctx}");
    let avatar = at(html, "avatar");
    assert_eq!(
        row.avatar.logo_address.is_some(),
        at(avatar, "logo") == &JsValue::Bool(true),
        "{ctx}"
    );
    if row.avatar.logo_address.is_none() {
        assert_eq!(
            Some(row.avatar.letters.clone()),
            opt_text(avatar, "letters"),
            "{ctx}"
        );
        assert_eq!(
            Some(row.avatar.tone.to_string()),
            opt_text(avatar, "tone"),
            "{ctx}"
        );
    }
}

#[test]
fn activity_rows_match_the_side_panel() {
    let fixture = fixture();
    let now = num(&fixture, "activityNow");
    for block in list(&fixture, "appearance") {
        let entries: Vec<ActivityEntry> = list(block, "entries").iter().map(loose_entry).collect();
        let tokens: Vec<TokenConfig> = list(block, "tokens").iter().map(token).collect();
        for (entry, expected) in entries.iter().zip(list(block, "models")) {
            let ctx = format!("{} model {}", text(block, "currency"), entry.hash);
            assert_model(&t::activity_row_model(entry, &tokens), expected, &ctx);
        }
        assert_eq!(entries.len(), list(block, "models").len());
        let groups = activity_groups(entries, tokens, Some(now));
        let headings: Vec<String> = groups.iter().map(|g| g.heading.clone()).collect();
        assert_eq!(
            headings,
            list(block, "headings")
                .iter()
                .map(|h| h.as_str().unwrap().to_string())
                .collect::<Vec<_>>()
        );
        let sizes: Vec<f64> = groups.iter().map(|g| g.rows.len() as f64).collect();
        assert_eq!(
            sizes,
            list(block, "sizes")
                .iter()
                .map(|s| s.as_f64().unwrap())
                .collect::<Vec<_>>()
        );
        let rows: Vec<ActivityRow> = groups.into_iter().flat_map(|g| g.rows).collect();
        for (row, html) in rows.iter().zip(list(block, "rows")) {
            let ctx = format!("{} row {}", text(block, "currency"), row.hash);
            assert_row(row, html, &ctx);
        }
        assert_eq!(rows.len(), list(block, "rows").len());
    }
}

#[test]
fn status_copy_times_sparklines_and_links() {
    let block = at(&fixture(), "status").clone();
    for c in list(&block, "compactSummary") {
        assert_eq!(
            t::compact_summary(&text(c, "value")),
            text(c, "out"),
            "{:?}",
            c
        );
    }
    for c in list(&block, "empty") {
        assert_eq!(
            activity_empty_copy(at(c, "unavailable") == &JsValue::Bool(true)),
            text(c, "out")
        );
    }
    for c in list(&block, "explorer") {
        let net = network(&text(c, "networkId"));
        assert_eq!(
            explorer_transaction_url(net, text(c, "felt")),
            opt_text(c, "tx"),
            "{:?}",
            c
        );
        assert_eq!(
            explorer_account_url(net, text(c, "felt")),
            opt_text(c, "account"),
            "{:?}",
            c
        );
    }
    for c in list(&block, "friendly") {
        assert_eq!(
            friendly_network_error(text(c, "raw")),
            opt_text(c, "out"),
            "{:?}",
            c
        );
    }
    for c in list(&block, "issues") {
        let balances = at(c, "balances");
        let health = if balances.get("error").is_some() {
            BalanceHealth::Failed
        } else {
            BalanceHealth::Loaded {
                stale: balances.get("stale") == Some(&JsValue::Bool(true)),
                as_of_ms: opt_num(balances, "asOf"),
            }
        };
        let has_prices = at(c, "hasPrices") == &JsValue::Bool(true);
        let prices = PriceView {
            currency: DisplayCurrency::Usd,
            prices: if has_prices {
                vec![PricePoint {
                    address: "0x1".into(),
                    value: 1.0,
                }]
            } else {
                Vec::new()
            },
            changes: Vec::new(),
            as_of_ms: opt_num(c, "priceAsOf"),
            stale: at(c, "priceStale") == &JsValue::Bool(true),
        };
        assert_eq!(
            network_data_issue(health, Some(prices)).unwrap_or_default(),
            text(c, "out"),
            "{:?}",
            c
        );
    }
    for c in list(&block, "sparklines") {
        let values: Vec<f64> = list(c, "points")
            .iter()
            .map(|p| p.as_f64().unwrap_or(f64::NAN))
            .collect();
        let line = token_sparkline(values);
        assert_eq!(
            line.as_ref().map(|l| l.path.clone()).unwrap_or_default(),
            text(c, "path"),
            "{:?}",
            c
        );
        if let Some(line) = line {
            let trend = match line.trend {
                SparklineTrend::Up => "up",
                SparklineTrend::Down => "down",
                SparklineTrend::Flat => "flat",
            };
            assert_eq!(trend, text(c, "trend"));
        }
    }
    for c in list(&block, "times") {
        let ms = Some(num(c, "ms"));
        assert_eq!(t::format_utc_day(ms), opt_text(c, "day"), "{:?}", c);
        assert_eq!(t::format_utc_date(ms), opt_text(c, "date"), "{:?}", c);
        assert_eq!(t::format_utc_clock(ms), opt_text(c, "clock"), "{:?}", c);
    }
}
