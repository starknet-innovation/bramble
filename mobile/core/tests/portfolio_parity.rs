//! The core's prices, fiat, token and balance rules against what the extension's TypeScript
//! produced for the same inputs (`fixtures/portfolio-parity.jsonl`, `bun run mobile:parity`).

mod common;

use bramble_core::portfolio_testing::{self as t, JsValue};
use bramble_core::*;
use common::*;

fn is_true(value: &JsValue) -> bool {
    value == &JsValue::Bool(true)
}

#[test]
fn limits_match_the_extension() {
    let limits = at(&fixture(), "limits").clone();
    assert_eq!(num(&limits, "price") as u64, t::PRICE_BODY_LIMIT);
    assert_eq!(num(&limits, "starkscan") as u64, t::STARKSCAN_BODY_LIMIT);
    assert_eq!(num(&limits, "rpcBody") as u64, t::RPC_BODY_LIMIT);
    assert_eq!(num(&limits, "httpTimeout") as u64, t::HTTP_DEADLINE_MS);
    assert_eq!(num(&limits, "rpcTimeout") as u64, t::RPC_DEADLINE_MS);
    assert_eq!(
        num(&limits, "chartPoints") as usize,
        t::PRICE_CHART_POINT_LIMIT
    );
    assert_eq!(rpc_limits().max_body_bytes, t::RPC_BODY_LIMIT);
}

#[test]
fn javascript_number_semantics() {
    let numbers = at(&fixture(), "numbers").clone();
    for c in list(&numbers, "fixed") {
        assert_eq!(
            t::to_fixed(num(c, "value"), 2),
            text(c, "out"),
            "toFixed {:?}",
            c
        );
    }
    for c in list(&numbers, "locale") {
        assert_eq!(
            t::locale_grouped_2(num(c, "value")),
            text(c, "out"),
            "locale {:?}",
            c
        );
    }
    for c in list(&numbers, "string") {
        assert_eq!(
            t::number_to_string(num(c, "value")),
            text(c, "out"),
            "String {:?}",
            c
        );
    }
    for c in list(&numbers, "number") {
        assert_eq!(
            t::number_to_string(t::string_to_number(&text(c, "input"))),
            text(c, "out"),
            "Number {:?}",
            c
        );
    }
}

#[test]
fn fiat_amounts_hero_and_rows() {
    let fiat = at(&fixture(), "fiat").clone();
    for c in list(&fiat, "format") {
        assert_eq!(
            format_fiat(num(c, "value"), currency(&text(c, "currency"))),
            text(c, "out"),
            "{:?}",
            c
        );
    }
    for c in list(&fiat, "compact") {
        let places = opt_num(c, "places").map(|p| p as u32);
        assert_eq!(
            compact_amount(text(c, "value"), places),
            text(c, "out"),
            "{:?}",
            c
        );
    }
    for c in list(&fiat, "value") {
        let price = opt_num(c, "price");
        assert_eq!(
            t::token_fiat_value(&text(c, "formatted"), price),
            opt_num(c, "out"),
            "{:?}",
            c
        );
    }
    let prefs = TokenPreferences::new(None);
    for c in list(&fiat, "hero") {
        let balances: Vec<TokenBalance> = list(c, "balances")
            .iter()
            .map(|b| TokenBalance {
                token: TokenConfig {
                    id: text(b, "id"),
                    network: NetworkId::Mainnet,
                    address: text(b, "address"),
                    symbol: text(b, "symbol"),
                    name: text(b, "symbol"),
                    decimals: 18,
                },
                balance: "1".into(),
                formatted: text(b, "formatted"),
            })
            .collect();
        let view = price_view(&text(c, "currency"), at(c, "prices"), at(c, "changes"));
        let hero = portfolio_hero(Some(prefs.home_rows(balances).visible), view, true);
        let out = at(c, "out");
        assert_eq!(
            hero.total_text.unwrap_or_else(|| "—".into()),
            text(out, "total"),
            "{:?}",
            c
        );
        assert_eq!(
            hero.delta.as_ref().map(|d| d.amount_text.clone()),
            opt_text(out, "amount"),
            "{:?}",
            c
        );
        assert_eq!(
            hero.delta.as_ref().map(|d| d.window_text.clone()),
            opt_text(out, "window"),
            "{:?}",
            c
        );
        assert_eq!(
            hero.delta.is_some_and(|d| d.down),
            is_true(at(out, "down")),
            "{:?}",
            c
        );
    }
    let strk = prefs
        .tracked(NetworkId::Mainnet)
        .into_iter()
        .find(|t| t.token.symbol == "STRK")
        .unwrap()
        .token;
    for c in list(&fiat, "rows") {
        let mut prices = Vec::new();
        let mut changes = Vec::new();
        if let Some(p) = opt_num(c, "price") {
            prices.push(PricePoint {
                address: strk.address.clone(),
                value: p,
            });
        }
        if let Some(ch) = opt_num(c, "change") {
            changes.push(PricePoint {
                address: strk.address.clone(),
                value: ch,
            });
        }
        let view = PriceView {
            currency: DisplayCurrency::Usd,
            prices,
            changes,
            as_of_ms: None,
            stale: false,
        };
        let row = token_row_fiat(
            TokenBalance {
                token: strk.clone(),
                balance: "1".into(),
                formatted: "1234.5".into(),
            },
            view,
        );
        assert_eq!(
            row.value_text.unwrap_or_else(|| "—".into()),
            text(c, "value"),
            "{:?}",
            c
        );
        assert_eq!(
            row.change.as_ref().map(|b| b.text.clone()),
            opt_text(c, "badge"),
            "{:?}",
            c
        );
        assert_eq!(
            row.change.is_some_and(|b| b.up),
            is_true(at(c, "up")),
            "{:?}",
            c
        );
    }
}

// One `getPrices` step on a book: plan, and when it fetches, answer and apply.
fn price_step(book: &PriceBook, step: &JsValue, pad: usize) -> (PriceView, Vec<String>) {
    let addresses: Vec<String> = list(step, "addresses")
        .iter()
        .map(|a| a.as_str().unwrap().to_string())
        .collect();
    let (net, cur, now) = (
        network(&text(step, "networkId")),
        currency(&text(step, "currency")),
        num(step, "now"),
    );
    let cached = step.get("cached").is_some_and(is_true);
    match book.plan(net, addresses.clone(), cur, now, cached) {
        PricePlan::Serve { view } => (view, Vec::new()),
        PricePlan::Fetch { requests } => {
            let answers = at(step, "answers");
            let outcomes = requests
                .iter()
                .map(|r| PriceOutcome {
                    address: r.address.clone(),
                    outcome: outcome(
                        answers.get(&r.address).unwrap_or(&JsValue::Null),
                        pad,
                        r.request.max_body_bytes,
                    ),
                })
                .collect();
            let urls = requests.iter().map(|r| r.request.url.clone()).collect();
            (book.apply(net, addresses, cur, outcomes, now), urls)
        }
    }
}

fn urls(expected: &JsValue) -> Vec<String> {
    list(expected, "urls")
        .iter()
        .map(|u| u.as_str().unwrap().to_string())
        .collect()
}

#[test]
fn price_bodies_are_judged_like_the_extension() {
    let prices = at(&fixture(), "prices").clone();
    for c in list(&prices, "bodies") {
        let book = PriceBook::new(None);
        let name = text(c, "name");
        let pad = opt_num(c, "pad").unwrap_or(0.0) as usize;
        for code in ["usd", "eur", "gbp"] {
            let mut step = vec![
                (
                    "addresses".to_string(),
                    JsValue::Array(vec![at(c, "address").clone()]),
                ),
                ("currency".to_string(), JsValue::String(code.into())),
                ("networkId".to_string(), JsValue::String("SN_MAIN".into())),
                ("now".to_string(), JsValue::Number(1000.0)),
            ];
            step.push((
                "answers".into(),
                JsValue::Object(vec![(text(c, "address"), at(c, "answer").clone())]),
            ));
            let (view, requested) = price_step(&book, &JsValue::Object(step), pad);
            let expected = at(at(c, "out"), code);
            assert_view(&view, expected, &format!("{name} {code}"));
            assert_eq!(requested, urls(expected), "{name} {code}: urls");
        }
    }
}

#[test]
fn price_timelines_follow_get_prices() {
    let plans = at(at(&fixture(), "prices"), "plans").clone();
    for (name, steps) in plans.as_object().unwrap() {
        let mut book = PriceBook::new(None);
        for (i, step) in steps.as_array().unwrap().iter().enumerate() {
            let (view, requested) = price_step(&book, step, 0);
            let expected = at(step, "out");
            assert_view(&view, expected, &format!("{name} step {i}"));
            assert_eq!(requested, urls(expected), "{name} step {i}: urls");
            book = PriceBook::new(Some(book.persisted()));
        }
    }
}

#[test]
fn chart_timeline_follows_get_token_chart() {
    let book = PriceBook::new(None);
    for (i, step) in list(&fixture(), "charts").iter().enumerate() {
        let (net, cur, now) = (
            network(&text(step, "networkId")),
            currency(&text(step, "currency")),
            num(step, "now"),
        );
        let address = text(step, "address");
        let (points, requested) = match book.chart_plan(net, address.clone(), cur, now).unwrap() {
            ChartPlan::Serve { points } => (points, Vec::new()),
            ChartPlan::Fetch { request } => {
                let answer = outcome(at(step, "answer"), 0, request.max_body_bytes);
                (
                    book.chart_apply(address, cur, answer, now),
                    vec![request.url],
                )
            }
        };
        let expected = at(step, "out");
        let want: Vec<f64> = list(expected, "points")
            .iter()
            .map(|p| p.as_f64().unwrap())
            .collect();
        assert_eq!(points, want, "chart step {i}");
        assert_eq!(requested, urls(expected), "chart step {i}: urls");
    }
}
