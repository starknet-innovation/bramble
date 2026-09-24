//! Activity rows as the side panel renders them: `activity-format.ts` (`activityRowModel`) and
//! `home-tabs.ts` (`transactionRow`, `transactionGroups`, `activityEmptyCopy`), over the
//! classification in `classify.rs`.

use super::activity::{ActivityEntry, ActivityStatus};
pub use super::classify::ActivityDirection;
use super::classify::{appearance, capitalise, compact_activity_amount, compact_summary, detail};
use super::explorer::explorer_transaction_url;
use super::time::{format_utc_clock, format_utc_date, utc_day_key};
use crate::js::num::{js_trim, utf16_len, utf16_slice};
use crate::portfolio::fiat::{format_fiat, token_fiat_value};
use crate::portfolio::model::TokenConfig;
use crate::portfolio::prices::PriceView;
use crate::portfolio::tokens::{starknet_glyph, token_glyph, TokenGlyph};

const HISTORY_UNAVAILABLE_NOTICE: &str = "Couldn't load on-chain history. Showing transactions recorded on this device only — check your connection or RPC endpoint and refresh.";
const PENDING_HINT: &str = "Broadcast accepted. Starknet normally confirms quickly, and this wallet checks immediately. A pending transaction can't be fee-bumped, replaced, or cancelled.";
const PRECONFIRMED_HINT: &str = "Pre-confirmed by the block proposer, so the result is known but not yet final. Bramble keeps checking in the background and will tell you if it does not settle.";

/// The status hue of a row's glyph and status word.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum ActivityTone {
    /// Accepted: the neutral secondary tone, no status word.
    Settled,
    Pending,
    /// Positive hue at 0.68 opacity on the glyph.
    Preconfirmed,
    Failed,
}

/// Everything one Activity row displays.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct ActivityRow {
    pub hash: String,
    pub title: String,
    /// A `BrambleIconName` case name (checked against the generated set in the tests).
    pub icon: String,
    pub kind_label: String,
    pub direction: Option<ActivityDirection>,
    pub amount_text: Option<String>,
    pub fiat_text: Option<String>,
    pub detail: Option<String>,
    /// The full recorded counterparty, copied by the inline control.
    pub counterparty: Option<String>,
    pub copy_label: Option<String>,
    pub status: ActivityStatus,
    pub tone: ActivityTone,
    pub status_word: Option<String>,
    pub status_hint: Option<String>,
    pub glyph_label: String,
    pub timing: String,
    pub accessibility_label: String,
    pub explorer_url: Option<String>,
    pub token_symbol: Option<String>,
    pub token_address: Option<String>,
    pub avatar: TokenGlyph,
}

/// Rows of one UTC day under their heading.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct ActivityDayGroup {
    pub heading: String,
    pub rows: Vec<ActivityRow>,
}

fn status_label(status: ActivityStatus) -> &'static str {
    match status {
        ActivityStatus::Preconfirmed => "pre-confirmed",
        other => other.code(),
    }
}

// `transactionRow` over `activityRowModel`.
fn row(entry: &ActivityEntry, tracked: &[TokenConfig], prices: &PriceView) -> ActivityRow {
    let look = appearance(entry);
    let symbol = entry
        .token
        .as_deref()
        .map(js_trim)
        .filter(|s| !s.is_empty());
    let raw_amount = entry
        .amount
        .as_deref()
        .map(js_trim)
        .filter(|s| !s.is_empty());
    let amount = match (symbol, raw_amount) {
        (Some(symbol), Some(raw)) => Some(format!("{} {symbol}", compact_activity_amount(raw))),
        _ => None,
    };
    let matches: Vec<&TokenConfig> = symbol.map_or(Vec::new(), |symbol| {
        tracked
            .iter()
            .filter(|t| {
                t.network == entry.network && t.symbol.to_lowercase() == symbol.to_lowercase()
            })
            .collect()
    });
    let token = (matches.len() == 1).then(|| matches[0]);
    let price = token.and_then(|t| prices.price(&t.address));
    let value = match (look.direction, raw_amount, price) {
        (Some(_), Some(raw), Some(price)) => token_fiat_value(raw, Some(price)),
        _ => None,
    };
    let sign = match look.direction {
        Some(ActivityDirection::In) => "+",
        Some(ActivityDirection::Out) => "−",
        _ => "",
    };
    let counterparty_address = entry
        .counterparty
        .as_deref()
        .map(js_trim)
        .filter(|a| !a.is_empty());
    let role = match look.direction {
        Some(ActivityDirection::In) => "sender",
        Some(ActivityDirection::Out) => "recipient",
        _ if look.kind == "approval" => "recipient",
        _ => "counterparty",
    };
    let counterparty = counterparty_address.map(|a| (a, role));
    let label = status_label(entry.status);
    let explorer = explorer_transaction_url(entry.network, entry.hash.clone());
    let summary = compact_summary(&entry.summary);
    let name = if summary
        .to_lowercase()
        .starts_with(&look.title.to_lowercase())
    {
        summary.clone()
    } else {
        format!("{}. {summary}", look.title)
    };
    let clock = format_utc_clock(Some(entry.submitted_at as f64));
    let timing = match &clock {
        Some(clock) => format!("{} · {clock}", capitalise(label)),
        None => capitalise(label),
    };
    let spoken = match &clock {
        Some(clock) => format!("{label}, {clock}"),
        None => label.to_string(),
    };
    let accessibility_label = if explorer.is_some() {
        format!("{name}. {spoken}. View transaction on Starkscan")
    } else {
        let title_len = utf16_len(look.title);
        format!(
            "{}{}. {spoken}.",
            look.title,
            utf16_slice(&name, title_len, utf16_len(&name))
        )
    };
    let avatar = match symbol {
        Some(symbol) => token_glyph(
            token.map_or_else(|| "0x0".to_string(), |t| t.address.clone()),
            symbol.to_string(),
        ),
        None => starknet_glyph(),
    };
    ActivityRow {
        hash: entry.hash.clone(),
        title: look.title.into(),
        icon: look.icon.into(),
        kind_label: look.label.into(),
        direction: look.direction,
        fiat_text: value.map(|v| format!("{sign}{}", format_fiat(v, prices.currency))),
        detail: detail(entry, &look, counterparty, amount.is_some()),
        amount_text: amount,
        counterparty: counterparty.map(|(a, _)| a.to_string()),
        copy_label: counterparty.map(|(_, role)| format!("Copy {role} address")),
        status: entry.status,
        tone: match entry.status {
            ActivityStatus::Accepted => ActivityTone::Settled,
            ActivityStatus::Pending => ActivityTone::Pending,
            ActivityStatus::Preconfirmed => ActivityTone::Preconfirmed,
            ActivityStatus::Rejected | ActivityStatus::Reverted => ActivityTone::Failed,
        },
        status_word: (entry.status != ActivityStatus::Accepted).then(|| capitalise(label)),
        status_hint: match entry.status {
            ActivityStatus::Pending => Some(PENDING_HINT.into()),
            ActivityStatus::Preconfirmed => Some(PRECONFIRMED_HINT.into()),
            _ => None,
        },
        glyph_label: format!("{}, {label}", look.label),
        timing,
        accessibility_label,
        explorer_url: explorer,
        token_symbol: symbol.map(str::to_string),
        token_address: token.map(|t| t.address.clone()),
        avatar,
    }
}

/// `transactionGroups`: consecutive rows grouped by UTC day under "Today", "Yesterday",
/// `DD Mon YYYY`, or "Undated". `tracked` is every tracked token (`preferences.tokens`),
/// `prices` the active network's view; `now_ms` enables Today/Yesterday.
#[uniffi::export]
pub fn activity_groups(
    entries: Vec<ActivityEntry>,
    tracked: Vec<TokenConfig>,
    prices: PriceView,
    now_ms: Option<f64>,
) -> Vec<ActivityDayGroup> {
    let today = now_ms.map(utc_day_key);
    let mut groups: Vec<(Option<i64>, ActivityDayGroup)> = Vec::new();
    for entry in &entries {
        let at = Some(entry.submitted_at as f64);
        let date = format_utc_date(at);
        let key = date
            .as_ref()
            .map(|_| utc_day_key(entry.submitted_at as f64));
        let row = row(entry, &tracked, &prices);
        match groups.last_mut() {
            Some((last, group)) if *last == key => group.rows.push(row),
            _ => {
                let heading = match (key, date) {
                    (Some(k), _) if Some(k) == today => "Today".to_string(),
                    (Some(k), _) if today.is_some_and(|t| k == t - 1) => "Yesterday".to_string(),
                    (Some(_), Some(date)) => date,
                    _ => "Undated".to_string(),
                };
                groups.push((
                    key,
                    ActivityDayGroup {
                        heading,
                        rows: vec![row],
                    },
                ));
            }
        }
    }
    groups.into_iter().map(|(_, g)| g).collect()
}

/// `activityEmptyCopy`.
#[uniffi::export]
pub fn activity_empty_copy(history_unavailable: bool) -> String {
    if history_unavailable {
        "No transactions recorded on this device yet.".into()
    } else {
        "No activity yet. On-chain transactions for this account, and transactions you submit from this wallet, appear here.".into()
    }
}

/// The notice above the list when no history source answered.
#[uniffi::export]
pub fn activity_unavailable_notice() -> String {
    HISTORY_UNAVAILABLE_NOTICE.into()
}

#[cfg(test)]
mod tests {
    #[test]
    fn icons_are_generated_names() {
        let swift = include_str!("../../../ios/Bramble/DesignSystem/BrambleTokens.generated.swift");
        for icon in [
            "arrowLeftRight",
            "lockKeyholeOpen",
            "creditCard",
            "lockKeyhole",
            "shield",
            "keyRound",
            "arrowDownLeft",
            "arrowDownRight",
            "rocket",
            "terminal",
            "layoutGrid",
        ] {
            assert!(
                swift.contains(&format!("case {icon} = \"Icons/{icon}\"")),
                "{icon}"
            );
        }
    }
}
