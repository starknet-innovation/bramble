//! Unit tests for the activity store (kept apart to hold `store.rs` under 500 lines).

use super::*;

const SCOPE: &str = "SN_SEPOLIA:0x208361e3911b1d93a704400b88e7e53a89171fce64dbb48f8479e4f44b398d9";

fn entry(hash: &str, at: u64) -> Entry {
    Entry {
        account_id: SCOPE.into(),
        amount: Some("1.5".into()),
        counterparty: Some("0x1".into()),
        direction: None,
        failure_notice: None,
        finalized_on_l1: None,
        hash: hash.into(),
        kind: "transfer".into(),
        network_id: "SN_SEPOLIA".into(),
        not_found_count: None,
        status: "pending".into(),
        submitted_at: at,
        summary: "Send 1.5 STRK to 0x1…0x1".into(),
        token: Some("STRK".into()),
        token_address: None,
    }
}

fn found(status: TxStatus) -> Observation {
    Observation::Found {
        status,
        accepted_finality: false,
        finalized_on_l1: false,
    }
}

#[test]
fn round_trip_dedup_and_cap() {
    let dir = tempfile::tempdir().unwrap();
    assert!(record(dir.path(), entry("0xab", 1)));
    assert!(
        record(dir.path(), entry("0x0ab", 2)),
        "same felt is kept once"
    );
    assert_eq!(list(dir.path(), SCOPE).len(), 1);
    for n in 0..MAX_ENTRIES_PER_SCOPE as u64 + 5 {
        record(dir.path(), entry(&format!("{:#x}", n + 0x1000), n + 10));
    }
    let listed = list(dir.path(), SCOPE);
    assert_eq!(listed.len(), MAX_ENTRIES_PER_SCOPE);
    assert!(listed
        .windows(2)
        .all(|w| w[0].submitted_at >= w[1].submitted_at));
    assert!(listed.iter().all(|e| e.hash != "0xab"), "oldest dropped");
}

#[test]
fn status_moves_forward_and_not_found_rejects() {
    let dir = tempfile::tempdir().unwrap();
    let hash = Felt::from(0xabu8);
    record(dir.path(), entry("0xab", 1));
    assert_eq!(
        observe(dir.path(), SCOPE, &hash, found(TxStatus::Accepted)),
        Some(TxStatus::Accepted)
    );
    assert_eq!(
        observe(dir.path(), SCOPE, &hash, found(TxStatus::Pending)),
        Some(TxStatus::Accepted)
    );
    record(dir.path(), entry("0xcd", 2));
    let other = Felt::from(0xcdu8);
    assert_eq!(
        observe(dir.path(), SCOPE, &other, Observation::NotFound),
        Some(TxStatus::Pending)
    );
    assert_eq!(
        observe(dir.path(), SCOPE, &other, found(TxStatus::Pending)),
        Some(TxStatus::Pending)
    );
    for expected in [TxStatus::Pending, TxStatus::Pending, TxStatus::Rejected] {
        assert_eq!(
            observe(dir.path(), SCOPE, &other, Observation::NotFound),
            Some(expected)
        );
    }
    assert_eq!(
        observe(dir.path(), SCOPE, &other, found(TxStatus::Accepted)),
        Some(TxStatus::Rejected)
    );
    assert_eq!(
        observe(
            dir.path(),
            SCOPE,
            &Felt::from(9u8),
            found(TxStatus::Accepted)
        ),
        None
    );
}

#[test]
fn corrupt_file_is_quarantined_not_overwritten() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(path(dir.path()), b"{not json").unwrap();
    assert!(list(dir.path(), SCOPE).is_empty());
    assert!(dir.path().join("activity.v1.corrupt-0.json").exists());
    fs::write(path(dir.path()), br#"{"version":2,"scopes":{}}"#).unwrap();
    assert!(record(dir.path(), entry("0xab", 1)));
    assert!(dir.path().join("activity.v1.corrupt-1.json").exists());
    assert_eq!(list(dir.path(), SCOPE).len(), 1);
    fs::write(dir.path().join(format!("{ACTIVITY_FILE}.tmp")), b"x").unwrap();
    fs::write(dir.path().join("unrelated.json"), b"{}").unwrap();
    remove(dir.path());
    let left: Vec<String> = fs::read_dir(dir.path())
        .unwrap()
        .flatten()
        .map(|item| item.file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(
        left,
        vec!["unrelated.json".to_string()],
        "every activity file is removed"
    );
}

#[test]
fn invalid_entries_are_dropped() {
    let dir = tempfile::tempdir().unwrap();
    let mut bad = entry("0xab", 1);
    bad.summary = String::new();
    assert!(!record(dir.path(), bad));
    let mut wrong_scope = entry("0xab", 1);
    wrong_scope.network_id = "SN_MAIN".into();
    assert!(!record(dir.path(), wrong_scope));
    remove(dir.path());
    assert!(!path(dir.path()).exists());
}

#[test]
fn an_expired_unresolved_entry_is_retired_once_and_its_notice_delivered_once() {
    use super::observation::UNRESOLVED_WINDOW_MS as HOUR;
    let dir = tempfile::tempdir().unwrap();
    record(dir.path(), entry("0xab", 1_000));
    record(dir.path(), entry("0xcd", 1_000 + HOUR));
    let mut accepted = entry("0xef", 1_000);
    accepted.status = "accepted".into();
    record(dir.path(), accepted);

    assert_eq!(
        retire_expired(dir.path(), SCOPE, 1_000 + HOUR - 1),
        0,
        "inside the hour"
    );
    assert!(take_failure_notices(dir.path(), SCOPE).is_empty());
    assert_eq!(retire_expired(dir.path(), SCOPE, 1_000 + HOUR), 1);
    assert_eq!(
        retire_expired(dir.path(), SCOPE, 1_000 + HOUR),
        0,
        "retired once"
    );

    let retired = list(dir.path(), SCOPE);
    let retired = retired.iter().find(|e| e.hash == "0xab").unwrap();
    assert_eq!(retired.status, "pending", "the status is never invented");
    assert_eq!(retired.failure_notice.as_deref(), Some("pending"));

    let taken = take_failure_notices(dir.path(), SCOPE);
    assert_eq!(taken.len(), 1);
    assert_eq!(taken[0].hash, "0xab");
    assert!(
        take_failure_notices(dir.path(), SCOPE).is_empty(),
        "delivered once"
    );
    assert_eq!(
        retire_expired(dir.path(), SCOPE, u64::MAX),
        1,
        "only 0xcd is left to retire"
    );
    assert!(take_failure_notices(dir.path(), "SN_SEPOLIA:0x1").is_empty());
}

#[test]
fn notices_are_drained_at_most_five_at_a_time() {
    let dir = tempfile::tempdir().unwrap();
    for n in 1..=7u8 {
        record(dir.path(), entry(&format!("0x{n:x}"), 1));
    }
    assert_eq!(retire_expired(dir.path(), SCOPE, u64::MAX), 7);
    assert_eq!(take_failure_notices(dir.path(), SCOPE).len(), 5);
    assert_eq!(take_failure_notices(dir.path(), SCOPE).len(), 2);
    assert!(take_failure_notices(dir.path(), SCOPE).is_empty());
}

#[test]
fn discard_drops_only_an_unobserved_pending_entry() {
    let dir = tempfile::tempdir().unwrap();
    record(dir.path(), entry("0xab", 1));
    record(dir.path(), entry("0xcd", 2));
    let observed = Felt::from(0xcdu8);
    observe(dir.path(), SCOPE, &observed, Observation::NotFound);
    discard(dir.path(), SCOPE, &Felt::from(0xabu8));
    discard(dir.path(), SCOPE, &observed);
    let left: Vec<String> = list(dir.path(), SCOPE)
        .into_iter()
        .map(|e| e.hash)
        .collect();
    assert_eq!(left, vec!["0xcd".to_string()]);
}
