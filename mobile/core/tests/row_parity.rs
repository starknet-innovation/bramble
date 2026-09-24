//! Activity rows, day groups, header freshness copy, timestamps, sparklines and explorer links
//! against the side panel's own renderers (`fixtures/portfolio-parity.jsonl`).

mod common;

use bramble_core::portfolio_testing::{self as t, JsValue};
use bramble_core::*;
use common::*;

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
            "pending" => ActivityStatus::Pending,
            "preconfirmed" => ActivityStatus::Preconfirmed,
            "rejected" => ActivityStatus::Rejected,
            "reverted" => ActivityStatus::Reverted,
            _ => ActivityStatus::Accepted,
        },
        submitted_at: num(v, "submittedAt") as u64,
        summary: text(v, "summary"),
        token: opt_text(v, "token"),
    }
}

#[test]
fn activity_rows_match_the_side_panel() {
    let fixture = fixture();
    let now = num(&fixture, "activityNow");
    for block in list(&fixture, "appearance") {
        let entries: Vec<ActivityEntry> = list(block, "entries").iter().map(loose_entry).collect();
        let tokens: Vec<TokenConfig> = list(block, "tokens").iter().map(token).collect();
        let view = price_view(
            &text(block, "currency"),
            at(block, "prices"),
            &JsValue::Object(Vec::new()),
        );
        let groups = activity_groups(entries, tokens, view, Some(now));
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
        for ((row, model), html) in rows
            .iter()
            .zip(list(block, "models"))
            .zip(list(block, "rows"))
        {
            let ctx = format!("{} {}", text(block, "currency"), row.hash);
            assert_eq!(row.title, text(model, "title"), "{ctx}");
            assert_eq!(row.icon, text(model, "icon"), "{ctx}");
            assert_eq!(row.kind_label, text(model, "label"), "{ctx}");
            let direction = row.direction.map(|d| match d {
                ActivityDirection::In => "in",
                ActivityDirection::Out => "out",
                ActivityDirection::Internal => "internal",
            });
            assert_eq!(
                direction.map(str::to_string),
                opt_text(model, "direction"),
                "{ctx}"
            );
            assert_eq!(row.amount_text, opt_text(model, "amount"), "{ctx}");
            assert_eq!(row.fiat_text, opt_text(model, "fiat"), "{ctx}");
            assert_eq!(row.detail, opt_text(model, "detail"), "{ctx}");
            assert_eq!(
                row.counterparty,
                model
                    .get("counterparty")
                    .and_then(|c| opt_text(c, "address")),
                "{ctx}"
            );
            assert_eq!(row.token_symbol, opt_text(model, "tokenSymbol"), "{ctx}");
            assert_eq!(row.token_address, opt_text(model, "tokenAddress"), "{ctx}");
            assert_eq!(
                Some(row.accessibility_label.clone()),
                opt_text(html, "accessible"),
                "{ctx}"
            );
            assert_eq!(
                row.amount_text.clone().unwrap_or_else(|| "—".into()),
                text(html, "amount"),
                "{ctx}"
            );
            assert_eq!(
                row.fiat_text.clone().unwrap_or_else(|| "—".into()),
                text(html, "fiat"),
                "{ctx}"
            );
            assert_eq!(row.copy_label, opt_text(html, "copyLabel"), "{ctx}");
            assert_eq!(row.counterparty, opt_text(html, "copyValue"), "{ctx}");
            assert_eq!(
                Some(row.glyph_label.clone()),
                opt_text(html, "glyphLabel"),
                "{ctx}"
            );
            assert_eq!(
                Some(
                    row.status_hint
                        .clone()
                        .unwrap_or_else(|| row.glyph_label.clone())
                ),
                opt_text(html, "glyphTitle"),
                "{ctx}"
            );
            assert_eq!(row.explorer_url, opt_text(html, "href"), "{ctx}");
            assert_eq!(row.status_word, opt_text(html, "meta"), "{ctx}");
            assert_eq!(Some(row.timing.clone()), opt_text(html, "timing"), "{ctx}");
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
