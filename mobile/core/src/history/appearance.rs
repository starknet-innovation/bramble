//! Activity rows as the side panel renders them (`wallet_core::history::appearance`,
//! `activity-format.ts activityRowModel` and `home-tabs.ts transactionRow` /
//! `transactionGroups`): the UniFFI shapes and the export with Bramble's catalogs, plus Bramble's
//! own sentences (`activityEmptyCopy`, the unavailable notice).
//!
//! A row is a disclosure. Its summary shows the kind glyph, a heading that joins the verb and the
//! amount, the truncated hash (linked to the explorer) with a copy control, a status word for a
//! row that is not accepted, and the token mark. Its body lists the counterparty or a detail line,
//! the submission time, and the provisional-status hint. No fiat figure: a value computed from
//! today's price is not what the transaction was worth.

use wallet_core::history::appearance as port;
pub use wallet_core::history::appearance::{
    ActivityCounterparty, ActivityDayGroup, ActivityDirection, ActivityRow, ActivityTone,
};

use super::activity::{ActivityEntry, TxStatus};
use crate::networks;
use crate::portfolio::model::TokenConfig;
use crate::portfolio::tokens::TokenGlyph;

const HISTORY_UNAVAILABLE_NOTICE: &str = "Couldn't load on-chain history. Showing transactions recorded on this device only — check your connection or RPC endpoint and refresh.";

/// The status hue of a row's glyph and status word.
#[uniffi::remote(Enum)]
pub enum ActivityTone {
    /// Accepted: the neutral secondary tone, no status word.
    Settled,
    Pending,
    /// Positive hue at 0.68 opacity on the glyph.
    Preconfirmed,
    Failed,
}

/// The recorded counterparty, as a row's expansion lists it.
#[uniffi::remote(Record)]
pub struct ActivityCounterparty {
    /// The fact's label: "Sender", "Recipient" or "Counterparty".
    pub role: String,
    /// The full recorded address (trimmed): the value the control copies and the accessibility
    /// value of the shown text.
    pub address: String,
    /// The text shown: the whole address, since the expansion is where it is read (extension
    /// 53acf291). Kept beside `address` so a host never derives one from the other.
    pub address_label: String,
    /// The copy control's accessible name, "Copy {role} address" in lower case.
    pub copy_label: String,
}

/// Everything one Activity row displays: the disclosure's summary, then its expansion.
#[uniffi::remote(Record)]
pub struct ActivityRow {
    /// A `BrambleIconName` case name (checked against the generated set in the tests).
    pub icon: String,
    pub tone: ActivityTone,
    pub status: TxStatus,
    /// The glyph's tooltip: the provisional hint, else "{Kind}, {status}" ("Transfer, accepted").
    /// The glyph itself is hidden from assistive tech.
    pub glyph_title: String,
    /// The verb and the amount ("Received 1.5 STRK"). An entry that records neither an amount
    /// nor a counterparty joins its detail instead ("Revoked For USDC"); else the verb alone.
    pub heading: String,
    /// The recorded hash: the value the hash row's control copies.
    pub hash: String,
    /// `accountLabel(hash)`, the truncated hash shown in the summary.
    pub hash_label: String,
    /// The hash copy control's accessible name.
    pub hash_copy_label: String,
    /// The explorer page the truncated hash links to; `None` shows it as plain text.
    pub explorer_url: Option<String>,
    /// "Pending", "Pre-confirmed", "Rejected" or "Reverted" in the status hue; `None` when
    /// accepted.
    pub status_word: Option<String>,
    /// The trailing token mark (the Starknet mark when the entry records no token).
    pub avatar: TokenGlyph,
    /// The summary's accessible name, "{heading}. {status}, {clock}" (the clock omitted when the
    /// time is unusable).
    pub accessibility_label: String,
    /// The whole row's tooltip, "{Status} · {clock}".
    pub timing: String,
    /// Expansion: the recorded counterparty, when there is one.
    pub counterparty: Option<ActivityCounterparty>,
    /// Expansion: the "Detail" fact, shown only without a counterparty and when the heading does
    /// not already carry it.
    pub detail: Option<String>,
    /// Expansion: the "Submitted" fact, "{DD Mon YYYY}, {HH:MM} UTC"; `None` when undated.
    pub submitted: Option<String>,
    /// Expansion: the "Status" fact, the provisional hint for pending and pre-confirmed rows.
    pub status_hint: Option<String>,
}

/// Rows of one UTC day under their heading.
#[uniffi::remote(Record)]
pub struct ActivityDayGroup {
    pub heading: String,
    pub rows: Vec<ActivityRow>,
}

/// `transactionGroups`: consecutive rows grouped by UTC day under "Today", "Yesterday",
/// `DD Mon YYYY`, or "Undated". `tracked` is every tracked token (`preferences.tokens`), which
/// resolves each row's token mark; `now_ms` enables Today/Yesterday.
#[uniffi::export]
pub fn activity_groups(
    entries: Vec<ActivityEntry>,
    tracked: Vec<TokenConfig>,
    now_ms: Option<f64>,
) -> Vec<ActivityDayGroup> {
    port::activity_groups(
        entries,
        tracked,
        now_ms,
        networks::catalogs(),
        &super::HISTORY_POLICY,
    )
}

/// `activityEmptyCopy`.
#[uniffi::export]
pub fn activity_empty_copy(history_unavailable: bool) -> String {
    if history_unavailable {
        "No transactions recorded on this device yet.".into()
    } else {
        "No activity yet. Transactions for this account appear here.".into()
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
