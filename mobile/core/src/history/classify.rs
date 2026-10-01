//! Activity classification, ported from `activity-format.ts`: `activityAppearance` (the verb,
//! glyph and direction a summary implies), `activityDetail`, `compactSummary` and
//! `compactActivityAmount`. The extension's regular expressions are kept verbatim and matched
//! with JavaScript semantics (`crate::js::regex`).

use std::sync::OnceLock;

use super::activity::{ActivityEntry, ActivityKind};
use crate::account_names::short_label;
use crate::js::num::{js_trim, utf16_len};
use crate::js::regex::Regex;
use crate::portfolio::fiat::compact_amount;

const ACTIVITY_FRACTION_PLACES: u32 = 4;

macro_rules! pattern {
    ($name:ident, $source:expr, $icase:expr) => {
        fn $name() -> &'static Regex {
            static CELL: OnceLock<Regex> = OnceLock::new();
            CELL.get_or_init(|| Regex::new($source, $icase))
        }
    };
}

pattern!(decimal_figure, r"(?<![\w.])(\d[\d,]*\.\d+)(?![\w.])", false);
pattern!(swap, r"\bswap(ped|ping)?\b", false);
pattern!(
    unstake,
    r"\bunstak(e|ed|ing)\b|\bundelegat(e|ed|ing)\b",
    false
);
pattern!(
    reward,
    r"\b(claim|claimed|claiming)\b.*\brewards?\b|\brewards?\b.*\b(claim|claimed|claiming)\b",
    false
);
pattern!(stake, r"\bstak(e|ed|ing)\b|\bdelegat(e|ed|ing)\b", false);
pattern!(
    private_word,
    r"\b(un)?shield(ed|ing)?\b|\bprivate(ly)?\b",
    false
);
pattern!(
    approval,
    r"\b(approve|approved|approval|revoke|revoked|allow|allowance)\b",
    false
);
pattern!(received, r"\b(receive|received)\b", false);
pattern!(
    names_other_party,
    r"\b(?:into|to)\s+(?!this account\b)\S",
    false
);
pattern!(unshield_prefix, r"\bunshield", false);
pattern!(shield_prefix, r"\bshield", false);
pattern!(
    private_transfer,
    r"\bprivately\b|\bprivate transfer\b",
    false
);
pattern!(revoke_prefix, r"\brevok", false);
pattern!(
    swap_pair,
    r"\bswap(?:ped|ping)?\s+~?[\d.,]*\s*([a-z0-9.$-]+)\s+for\s+(?:(?:at\s+least|~)\s*)?[\d.,]*\s*([a-z0-9.$-]+)",
    true
);
pattern!(
    leading_verb,
    r"^(?:swap(?:ped|ping)?|unstak(?:e|ed|ing)|undelegat(?:e|ed|ing)|stak(?:e|ed|ing)|delegat(?:e|ed|ing)|claim(?:ed|ing)?(?:\s+(?:staking\s+)?rewards?)?|unshield(?:ed|ing)?|shield(?:ed|ing)?|private(?:ly)?(?:\s+transfer)?|send|sent|receiv(?:e|ed)|approv(?:e|ed)|allow|revok(?:e|ed)(?:\s+approval)?|deploy(?:ed)?|declar(?:e|ed))\b\s*",
    true
);
pattern!(leading_figure, r"^~?\d[\d,]*(?:\.\d+)?\s+\S+\s*", false);
pattern!(trailing_privately, r"\s+privately$", true);

/// Which way value moved. Internal to the row model (it picks the counterparty's role); no row
/// shows it, so it does not cross FFI.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActivityDirection {
    In,
    Out,
    Internal,
}

pub(super) struct Appearance {
    pub(super) direction: Option<ActivityDirection>,
    pub(super) icon: &'static str,
    pub(super) label: &'static str,
    pub(super) title: &'static str,
    pub(super) kind: &'static str,
}

const fn look(
    direction: Option<ActivityDirection>,
    icon: &'static str,
    label: &'static str,
    title: &'static str,
    kind: &'static str,
) -> Appearance {
    Appearance {
        direction,
        icon,
        label,
        title,
        kind,
    }
}

fn private_appearance(summary: &str) -> Appearance {
    use ActivityDirection::{Internal, Out};
    let direction = if names_other_party().is_match(summary) {
        Out
    } else {
        Internal
    };
    if unshield_prefix().is_match(summary) {
        return look(
            Some(direction),
            "shield",
            "Private transaction",
            "Unshielded",
            "private",
        );
    }
    if shield_prefix().is_match(summary) {
        return look(
            Some(direction),
            "shield",
            "Private transaction",
            "Shielded",
            "private",
        );
    }
    if private_transfer().is_match(summary) {
        return look(
            Some(Out),
            "shield",
            "Private transaction",
            "Private transfer",
            "private",
        );
    }
    look(
        None,
        "shield",
        "Private transaction",
        "Private transaction",
        "private",
    )
}

// `activityAppearance`: the summary decides swaps, staking, rewards, privacy and approvals; the
// stored kind decides the rest.
pub(super) fn appearance(entry: &ActivityEntry) -> Appearance {
    use ActivityDirection::{In, Out};
    let summary = entry.summary.to_lowercase();
    if swap().is_match(&summary) {
        return look(Some(Out), "arrowLeftRight", "Swap", "Swapped", "swap");
    }
    if unstake().is_match(&summary) {
        return look(
            Some(In),
            "lockKeyholeOpen",
            "Unstake",
            "Unstaked",
            "unstake",
        );
    }
    if reward().is_match(&summary) {
        return look(
            Some(In),
            "creditCard",
            "Claim rewards",
            "Claimed rewards",
            "reward",
        );
    }
    if stake().is_match(&summary) {
        return look(Some(Out), "lockKeyhole", "Stake", "Staked", "stake");
    }
    if private_word().is_match(&summary) {
        return private_appearance(&summary);
    }
    if approval().is_match(&summary) {
        let title = if revoke_prefix().is_match(&summary) {
            "Revoked"
        } else {
            "Approved"
        };
        return look(None, "keyRound", "Approval", title, "approval");
    }
    match entry.kind {
        ActivityKind::Transfer if received().is_match(&summary) => look(
            Some(In),
            "arrowDownLeft",
            "Transfer",
            "Received",
            "transfer",
        ),
        ActivityKind::Transfer => look(Some(Out), "arrowDownRight", "Transfer", "Sent", "transfer"),
        ActivityKind::Deploy => look(None, "rocket", "Deployment", "Deployed", "deploy"),
        ActivityKind::Declare => look(
            None,
            "terminal",
            "Contract declaration",
            "Declared",
            "declare",
        ),
        ActivityKind::Invoke => look(
            None,
            "layoutGrid",
            "Contract interaction",
            "Interacted",
            "other",
        ),
    }
}

/// `capitalise`: upper-cases the first UTF-16 unit (a non-BMP first character is left alone).
pub(super) fn capitalise(value: &str) -> String {
    let mut chars = value.chars();
    match chars.next() {
        Some(first) if (first as u32) < 0x10000 => {
            format!("{}{}", first.to_uppercase(), chars.as_str())
        }
        _ => value.to_string(),
    }
}

/// `compactSummary`: every decimal figure trimmed to at most four places.
pub fn compact_summary(summary: &str) -> String {
    decimal_figure().replace(summary, true, |figure| {
        let fraction = figure.split('.').nth(1).unwrap_or("");
        if utf16_len(fraction) > ACTIVITY_FRACTION_PLACES as usize {
            compact_amount(figure.replace(',', ""), Some(ACTIVITY_FRACTION_PLACES))
        } else {
            figure.to_string()
        }
    })
}

pub(super) fn compact_activity_amount(amount: &str) -> String {
    let fraction = amount.split('.').nth(1).unwrap_or("");
    if utf16_len(fraction) > ACTIVITY_FRACTION_PLACES as usize {
        compact_amount(amount.into(), Some(ACTIVITY_FRACTION_PLACES))
    } else {
        compact_amount(amount.into(), None)
    }
}

fn non_empty(value: String) -> Option<String> {
    (!value.is_empty()).then_some(value)
}

// `activityDetail`.
pub(super) fn detail(
    entry: &ActivityEntry,
    look: &Appearance,
    counterparty: Option<(&str, &str)>,
    has_amount: bool,
) -> Option<String> {
    if let Some((address, role)) = counterparty {
        let preposition = match role {
            "sender" => "From",
            "recipient" => "To",
            _ => "With",
        };
        return Some(format!("{preposition} {}", short_label(address)));
    }
    let summary = compact_summary(js_trim(&entry.summary));
    if look.kind == "swap" {
        if let Some(caps) = swap_pair().captures(&summary) {
            if let (Some(Some(a)), Some(Some(b))) = (caps.get(1), caps.get(2)) {
                if !a.is_empty() && !b.is_empty() {
                    return Some(format!("{a} to {b}"));
                }
            }
        }
    }
    if look.kind == "other" {
        return non_empty(summary);
    }
    let mut remainder = leading_verb().replace(&summary, false, |_| String::new());
    if remainder == summary {
        return non_empty(summary);
    }
    remainder = trailing_privately().replace(&remainder, false, |_| String::new());
    if has_amount {
        remainder = leading_figure().replace(&remainder, false, |_| String::new());
    }
    non_empty(js_trim(&remainder).to_string()).map(|r| capitalise(&r))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capitalises_the_first_unit() {
        assert_eq!(capitalise("pending"), "Pending");
        assert_eq!(capitalise(""), "");
        assert_eq!(capitalise("ßa"), "SSa");
    }
}
