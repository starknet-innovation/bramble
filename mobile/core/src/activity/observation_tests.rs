//! The observation policy's own invariants. Its exact constants, tier decisions and copy are
//! pinned against the extension in `send/fixture_tests.rs`.

use super::*;

const DAY: u64 = 24 * 60 * 60 * 1_000;

#[test]
fn unresolved_entries_are_observed_fast_for_an_hour() {
    let hour = UNRESOLVED_WINDOW_MS;
    for status in [TxStatus::Pending, TxStatus::Preconfirmed] {
        assert!(is_observed_at(
            status,
            false,
            1_000,
            Tier::Fast,
            1_000 + hour - 1
        ));
        assert!(!is_observed_at(
            status,
            false,
            1_000,
            Tier::Fast,
            1_000 + hour
        ));
        assert!(!is_observed_at(status, false, 1_000, Tier::Slow, 1_000));
        assert!(!is_observed(status, false, 1_000, 1_000 + hour));
    }
}

#[test]
fn accepted_entries_await_l1_on_the_slow_tier_for_seven_days() {
    assert_eq!(L1_FINALITY_WINDOW_MS, 7 * DAY);
    assert!(is_observed_at(
        TxStatus::Accepted,
        false,
        5,
        Tier::Slow,
        5 + 7 * DAY - 1
    ));
    assert!(!is_observed_at(
        TxStatus::Accepted,
        false,
        5,
        Tier::Slow,
        5 + 7 * DAY
    ));
    assert!(!is_observed_at(TxStatus::Accepted, false, 5, Tier::Fast, 5));
    assert!(is_observed(
        TxStatus::Accepted,
        false,
        5,
        5 + UNRESOLVED_WINDOW_MS
    ));
    assert!(
        !is_observed(TxStatus::Accepted, true, 5, 5),
        "L1-final is terminal"
    );
    assert_eq!(period_ms(Tier::Slow), 15 * 60 * 1_000);
    assert_eq!(period_ms(Tier::Fast), 60 * 1_000);
}

#[test]
fn terminal_entries_are_never_observed_or_retired() {
    for status in [TxStatus::Rejected, TxStatus::Reverted] {
        for finalized in [false, true] {
            assert_eq!(tier(status, finalized), None);
            assert!(!is_observed(status, finalized, 5, 5));
        }
        assert!(!is_expired(status, false, 0, u64::MAX));
    }
    assert!(
        !is_expired(TxStatus::Accepted, false, 0, u64::MAX),
        "slow expiry is silent"
    );
}

#[test]
fn only_an_unresolved_entry_past_its_hour_without_a_notice_expires() {
    assert!(!is_expired(
        TxStatus::Pending,
        false,
        10,
        10 + UNRESOLVED_WINDOW_MS - 1
    ));
    assert!(is_expired(
        TxStatus::Pending,
        false,
        10,
        10 + UNRESOLVED_WINDOW_MS
    ));
    assert!(is_expired(
        TxStatus::Preconfirmed,
        false,
        10,
        10 + UNRESOLVED_WINDOW_MS
    ));
    assert!(
        !is_expired(TxStatus::Pending, true, 10, u64::MAX),
        "one notice only"
    );
}
