//! Fiat and amount presentation (`wallet_core::portfolio::fiat`, the side panel's
//! `shared/fiat.ts`, `token-row.ts`, `home-view.ts` and `sparkline.ts`): the UniFFI shapes and
//! exports. Pure: the host renders the strings it gets back.

use wallet_core::portfolio::fiat as port;
pub use wallet_core::portfolio::fiat::{
    ChangeBadge, FiatDelta, PortfolioHero, Sparkline, SparklinePoint, SparklineTrend, TokenRowFiat,
};

use super::model::{DisplayCurrency, TokenBalance};
use super::prices::PriceView;

/// `formatFiat`: glyph, grouped thousands, two decimals; `<0.01` for dust; `0.00` for zero,
/// negative or non-finite input.
#[uniffi::export]
pub fn format_fiat(amount: f64, currency: DisplayCurrency) -> String {
    port::format_fiat(amount, currency)
}

/// `compactAmount(formatted, PORTFOLIO_FRACTION_PLACES)`: the Home list's amount column.
#[uniffi::export]
pub fn portfolio_amount(formatted: String) -> String {
    port::portfolio_amount(formatted)
}

/// `compactAmount(formatted, places)`: THE display policy for token amounts.
#[uniffi::export]
pub fn compact_amount(formatted: String, places: Option<u32>) -> String {
    port::compact_amount(formatted, places)
}

/// The hero's 24h line (`heroDelta`): the arrow and magnitude in the up/down hue, then the
/// muted `Portfolio price · <percent>% · 24h` window (`heroChange`), which says the figure is a
/// price move rather than a change in holdings.
#[uniffi::remote(Record)]
pub struct FiatDelta {
    pub down: bool,
    pub amount_text: String,
    pub window_text: String,
}

/// The Home hero: the total when it can be shown (else the host prints "—") and the delta.
#[uniffi::remote(Record)]
pub struct PortfolioHero {
    pub total_text: Option<String>,
    pub total_value: Option<f64>,
    pub delta: Option<FiatDelta>,
}

/// Home's hero (`homeScreen`): shown only with an account, loaded balances (`visible` is the
/// Home list, STRK first) and a non-empty price map; the delta line only when it is non-null.
#[uniffi::export]
pub fn portfolio_hero(
    visible: Option<Vec<TokenBalance>>,
    prices: PriceView,
    has_account: bool,
) -> PortfolioHero {
    port::portfolio_hero(visible, prices, has_account)
}

/// `changeBadge`: `↑|↓ <|change|.toFixed(2)>% · 24h`, `up` when the change is ≥ 0. `spoken` is
/// the screen-reader name, where the extension swaps the window tag for "24h price change".
#[uniffi::remote(Record)]
pub struct ChangeBadge {
    pub up: bool,
    pub text: String,
    pub spoken: String,
}

/// The right-hand side of a token row: fiat value (`None` renders "—") and the change badge.
#[uniffi::remote(Record)]
pub struct TokenRowFiat {
    pub value_text: Option<String>,
    pub change: Option<ChangeBadge>,
}

/// `balanceRow`'s fiat column and badge for one balance.
#[uniffi::export]
pub fn token_row_fiat(balance: TokenBalance, prices: PriceView) -> TokenRowFiat {
    port::token_row_fiat(balance, prices)
}

/// `tokenFiatValue` then `formatFiat`, for the Tokens list and detail (`None` when unpriced).
#[uniffi::export]
pub fn fiat_value_text(
    formatted: String,
    price: Option<f64>,
    currency: DisplayCurrency,
) -> Option<String> {
    port::fiat_value_text(formatted, price, currency)
}

/// Direction of a 7-day series (`sparklineTrend`).
#[uniffi::remote(Enum)]
pub enum SparklineTrend {
    Up,
    Down,
    Flat,
}

/// One sparkline vertex in the 100×32 view box.
#[uniffi::remote(Record)]
pub struct SparklinePoint {
    pub x: f64,
    pub y: f64,
}

/// A drawable sparkline: vertices, the SVG `points` text, and the trend hue.
#[uniffi::remote(Record)]
pub struct Sparkline {
    pub points: Vec<SparklinePoint>,
    pub path: String,
    pub trend: SparklineTrend,
}

/// `sparklinePath(points, 100, 32)` and `sparklineTrend`; `None` under two finite samples
/// ("Price history unavailable.").
#[uniffi::export]
pub fn token_sparkline(values: Vec<f64>) -> Option<Sparkline> {
    port::token_sparkline(values)
}
