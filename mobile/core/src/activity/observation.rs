//! How long, and how often, the wallet keeps watching a recorded transaction, and the notice it
//! owes when it gives up: the extension's `tx-observation.ts`, as pure functions of the stored
//! entry and an injected `now_ms` (no timers, files, or ambient time).
//!
//! Observation runs until `ACCEPTED_ON_L1`, in two cadences: pending and pre-confirmed entries
//! (the fast tier) for up to an hour, and L2-accepted entries still waiting on L1 proof (the slow
//! tier) for up to seven days. An unresolved entry that outlives its hour is retired: it keeps the
//! status it has and carries one pending notice (`retiredOutcome`).

use crate::send::types::TxStatus;

/// `UNRESOLVED_WINDOW_MS`: how long a pending or pre-confirmed entry stays under observation.
pub(crate) const UNRESOLVED_WINDOW_MS: u64 = 60 * 60 * 1_000;
/// `L1_FINALITY_WINDOW_MS`: how long an L2-accepted entry stays under observation while it waits
/// for L1 proof.
pub(crate) const L1_FINALITY_WINDOW_MS: u64 = 7 * 24 * 60 * 60 * 1_000;
/// `FAST_OBSERVATION_PERIOD_MINUTES`, in milliseconds: the least time between two status reads
/// of one unresolved entry.
pub(crate) const FAST_OBSERVATION_PERIOD_MS: u64 = 60 * 1_000;
/// `SLOW_OBSERVATION_PERIOD_MINUTES`, in milliseconds: the least time between two status reads
/// of one accepted entry still awaiting L1.
pub(crate) const SLOW_OBSERVATION_PERIOD_MS: u64 = 15 * 60 * 1_000;
/// `MAX_TRANSACTION_ALERTS_PER_DRAIN`: notices handed out per drain, per scope.
pub(crate) const MAX_ALERTS_PER_DRAIN: usize = 5;

/// `ObservationTier`: which cadence an entry belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Tier {
    Fast,
    Slow,
}

/// `tierFor`: terminal states (`rejected`, `reverted`, and L1-final `accepted`) have none.
pub(crate) fn tier(status: TxStatus, finalized_on_l1: bool) -> Option<Tier> {
    match status {
        TxStatus::Pending | TxStatus::Preconfirmed => Some(Tier::Fast),
        TxStatus::Accepted if !finalized_on_l1 => Some(Tier::Slow),
        _ => None,
    }
}

fn window(tier: Tier) -> u64 {
    match tier {
        Tier::Fast => UNRESOLVED_WINDOW_MS,
        Tier::Slow => L1_FINALITY_WINDOW_MS,
    }
}

/// The least time between two reads of one entry on `tier`.
pub(crate) fn period_ms(tier: Tier) -> u64 {
    match tier {
        Tier::Fast => FAST_OBSERVATION_PERIOD_MS,
        Tier::Slow => SLOW_OBSERVATION_PERIOD_MS,
    }
}

/// `isObservedAt(entry, tier, now)`.
pub(crate) fn is_observed_at(
    status: TxStatus,
    finalized_on_l1: bool,
    submitted_at_ms: u64,
    at: Tier,
    now_ms: u64,
) -> bool {
    tier(status, finalized_on_l1) == Some(at) && now_ms.saturating_sub(submitted_at_ms) < window(at)
}

/// `isObserved`: due a read on either cadence. Past its window an entry keeps the status it has
/// rather than the wallet claiming an outcome it never observed.
pub(crate) fn is_observed(
    status: TxStatus,
    finalized_on_l1: bool,
    submitted_at_ms: u64,
    now_ms: u64,
) -> bool {
    [Tier::Fast, Tier::Slow]
        .into_iter()
        .any(|at| is_observed_at(status, finalized_on_l1, submitted_at_ms, at, now_ms))
}

/// The `expiredObservations` predicate: an unresolved entry past its hour that owes no notice
/// yet. Retiring it records one pending notice and leaves its status untouched.
pub(crate) fn is_expired(
    status: TxStatus,
    has_notice: bool,
    submitted_at_ms: u64,
    now_ms: u64,
) -> bool {
    !has_notice
        && tier(status, false) == Some(Tier::Fast)
        && now_ms.saturating_sub(submitted_at_ms) >= UNRESOLVED_WINDOW_MS
}

/// `failureNoticeMessage`: the copy for one owed notice. A retired entry keeps its unresolved
/// status, so it reads as "could not confirm".
pub(crate) fn failure_notice_message(status: TxStatus, summary: &str) -> String {
    match status {
        TxStatus::Reverted => format!(
            "Starknet reverted \"{summary}\" after confirming it. Check its activity details before retrying."
        ),
        TxStatus::Rejected => format!(
            "Starknet dropped \"{summary}\" after confirming it. The transaction did not happen."
        ),
        _ => format!(
            "Bramble could not confirm \"{summary}\". Check it on an explorer before retrying."
        ),
    }
}

#[cfg(test)]
#[path = "observation_tests.rs"]
mod tests;
