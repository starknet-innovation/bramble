//! The discovery state machine end to end, against a scripted in-memory node: batching, the keep
//! and auto-select rules, pause and retry, manual indices, cache invalidation, lock, and the
//! restore checks (bounds, duplicates, classes, atomicity).

mod common;

use bramble_core::{account_classes, AccountFamily, CoreError, NetworkId, RpcResponse};
use common::{oz, pending, selection, Node, PASSWORD};
use serde_json::json;

fn class_of(label: &str) -> String {
    account_classes()
        .into_iter()
        .find(|class| class.label == label)
        .unwrap()
        .class_hash
}

#[test]
fn a_quiet_wallet_offers_only_the_creatable_index_zero_accounts() {
    let (_dir, _clock, core) = pending();
    let first = core.recovery_scan_next(NetworkId::Sepolia, None).unwrap();
    assert_eq!(
        first.requests.len(),
        4 * 7,
        "four indices, seven shapes each"
    );
    assert_eq!(first.status, "Searching every account type…");
    let step = Node::default().run_scan(&core, NetworkId::Sepolia);
    assert!(step.complete);
    assert_eq!(step.checked, 20);
    assert_eq!(
        step.status,
        "Search complete. Checked 20 indices across every account type."
    );
    let rows: Vec<_> = step
        .candidates
        .iter()
        .map(|c| (c.family, c.account_index))
        .collect();
    assert_eq!(
        rows,
        [(AccountFamily::OpenZeppelin, 0), (AccountFamily::Argent, 0)],
        "OZ and Argent 0.4.0 at index 0 only"
    );
    assert!(step.candidates[0].selectable && !step.candidates[0].auto_select);
    assert!(
        !step.candidates[1].selectable,
        "an unused Ready account is listed, not selectable"
    );
    assert_eq!(step.candidates[1].title, "Account 0");
}

#[test]
fn activity_is_found_and_auto_selected_across_families() {
    let (_dir, _clock, core) = pending();
    // Learn the addresses a scan derives, then replay it with some of them active.
    let (_probe_dir, _clock, probe) = pending();
    let first = probe.recovery_scan_next(NetworkId::Sepolia, None).unwrap();
    let address_of = |position: usize| {
        let body: serde_json::Value = serde_json::from_str(&first.requests[position].body).unwrap();
        body["params"]["contract_address"]
            .as_str()
            .unwrap()
            .to_string()
    };
    // Each index: OZ and argent 0.4.0 on this wallet's ladder, then argent 0.3.1, 0.3.0, 0.4.0 on
    // Ready's, then braavos 1.0.0 and base on Braavos's (issue 505).
    let mut node = Node::default();
    node.deployed.insert(address_of(7 + 2)); // Ready argent 0.3.1 at index 1
    node.funded.insert(address_of(7 * 3 + 6)); // braavos base at index 3
    let step = node.run_scan(&core, NetworkId::Sepolia);
    let argent = step
        .candidates
        .iter()
        .find(|c| c.account_index == 1)
        .expect("deployed Argent 0.3.1 is kept");
    assert_eq!(argent.title, "Account 1 · Argent 0.3.1");
    assert_eq!(argent.hint, "Deployed on Starknet");
    assert!(argent.auto_select && argent.selectable);
    assert_eq!(
        argent.key,
        format!("argent:argentx-bip44:{}:1", class_of("argent 0.3.1"))
    );
    assert_eq!(argent.ladder, bramble_core::Ladder::ArgentX);
    let braavos = step
        .candidates
        .iter()
        .find(|c| c.family == AccountFamily::Braavos)
        .expect("funded Braavos is kept");
    assert_eq!(braavos.hint, "Funded, not deployed · view only for now");
    assert!(braavos.funded && !braavos.deployed && braavos.auto_select);
}

#[test]
fn an_unexpected_error_pauses_and_the_batch_is_retried() {
    let (_dir, _clock, core) = pending();
    let failing = Node {
        failure: Some(json!({ "code": 24, "message": "Block not found" })),
        ..Node::default()
    };
    let step = core.recovery_scan_next(NetworkId::Sepolia, None).unwrap();
    let error = core
        .recovery_scan_submit(failing.answer_all(&step))
        .unwrap_err();
    assert!(matches!(error, CoreError::Rpc { ref reason } if reason == "account search paused"));
    // Nothing advanced: the retry re-issues indices 0-3 with fresh ids.
    let retry = core.recovery_scan_next(NetworkId::Sepolia, None).unwrap();
    assert_eq!(retry.checked, 0);
    assert_eq!(retry.requests.len(), 28);
    assert!(retry.requests[0].id > step.requests.last().unwrap().id);
    let done = Node::default().run_batch(&core, NetworkId::Sepolia, None);
    assert_eq!(done.checked, 4);
}

#[test]
fn responses_must_answer_exactly_the_outstanding_ids() {
    let (_dir, _clock, core) = pending();
    let node = Node::default();
    let step = core.recovery_scan_next(NetworkId::Sepolia, None).unwrap();
    let mut answers = node.answer_all(&step);
    answers.pop();
    assert!(
        core.recovery_scan_submit(answers).is_err(),
        "a missing answer"
    );

    let step = core.recovery_scan_next(NetworkId::Sepolia, None).unwrap();
    let mut answers = node.answer_all(&step);
    answers[1] = answers[0].clone();
    assert!(
        core.recovery_scan_submit(answers).is_err(),
        "a duplicate id"
    );

    let step = core.recovery_scan_next(NetworkId::Sepolia, None).unwrap();
    let mut answers = node.answer_all(&step);
    answers[0] = RpcResponse {
        id: 999_999,
        body: answers[0].body.clone(),
    };
    assert!(core.recovery_scan_submit(answers).is_err(), "a foreign id");

    let step = core.recovery_scan_next(NetworkId::Sepolia, None).unwrap();
    let mut answers = node.answer_all(&step);
    let (a, b) = (answers[0].id, answers[1].id);
    answers[0].id = b;
    answers[1].id = a;
    assert!(
        core.recovery_scan_submit(answers).is_err(),
        "a body under the wrong id"
    );
}

#[test]
fn a_manual_index_keeps_the_scan_position_and_lists_creatable_accounts() {
    let (_dir, _clock, core) = pending();
    let node = Node::default();
    node.run_batch(&core, NetworkId::Sepolia, None);
    let manual = node.run_batch(&core, NetworkId::Sepolia, Some(57));
    assert_eq!(manual.checked, 4, "the default scan does not move");
    assert!(manual
        .candidates
        .iter()
        .any(|c| c.account_index == 57 && c.family == AccountFamily::OpenZeppelin));
    assert!(matches!(
        core.recovery_scan_next(NetworkId::Sepolia, Some(0x8000_0000)),
        Err(CoreError::InvalidInput { .. })
    ));
}

#[test]
fn the_scan_resets_for_another_network_and_on_lock() {
    let (_dir, _clock, core) = pending();
    let node = Node::default();
    node.run_batch(&core, NetworkId::Sepolia, None);
    let mainnet = core.recovery_scan_next(NetworkId::Mainnet, None).unwrap();
    assert_eq!(mainnet.checked, 0, "a different network starts over");
    core.lock();
    core.unlock(PASSWORD.into()).unwrap();
    assert!(core.recovery_pending().unwrap(), "pending survives lock");
    assert!(
        core.recovery_scan_submit(vec![]).is_err(),
        "the scan was dropped with the session"
    );
    assert_eq!(
        core.recovery_scan_next(NetworkId::Mainnet, None)
            .unwrap()
            .checked,
        0
    );
}

#[test]
fn restore_checks_bounds_duplicates_and_classes() {
    let (_dir, _clock, core) = pending();
    let restore = |selections| core.restore_recovered_accounts(NetworkId::Sepolia, selections);
    assert!(restore(vec![]).is_err(), "at least one");
    assert!(restore((0..41).map(oz).collect()).is_err(), "at most 40");
    assert!(
        restore(vec![oz(2), oz(2)]).is_err(),
        "duplicate coordinates"
    );
    let argent_default = class_of("argent 0.4.0");
    assert!(
        restore(vec![
            selection(AccountFamily::Argent, 0, None),
            selection(AccountFamily::Argent, 0, Some(&argent_default)),
        ])
        .is_err(),
        "an absent Argent class keys as the default release"
    );
    assert!(
        restore(vec![selection(AccountFamily::Braavos, 0, None)]).is_err(),
        "Braavos must name its class"
    );
    let implementation_only = class_of("braavos current");
    assert!(
        restore(vec![selection(
            AccountFamily::Braavos,
            0,
            Some(&implementation_only)
        )])
        .is_err(),
        "an implementation-only class derives nobody's address"
    );
    assert!(
        restore(vec![selection(
            AccountFamily::OpenZeppelin,
            0,
            Some(&argent_default)
        )])
        .is_err(),
        "OZ takes no class"
    );
    assert!(core.recovery_pending().unwrap(), "nothing was written");
    let restored = restore((0..40).map(oz).collect()).unwrap();
    assert_eq!(restored.len(), 40);
    assert!(restored[0].active);
    assert!(!core.recovery_pending().unwrap());
    assert!(restore(vec![oz(41)]).is_err(), "restore runs once");
}

#[cfg(unix)]
#[test]
fn a_failed_restore_write_leaves_the_vault_pending() {
    use std::os::unix::fs::PermissionsExt;
    let (dir, _clock, core) = pending();
    let read_only = std::fs::Permissions::from_mode(0o555);
    std::fs::set_permissions(dir.path(), read_only).unwrap();
    let result = core.restore_recovered_accounts(NetworkId::Sepolia, vec![oz(0)]);
    std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o755)).unwrap();
    assert!(matches!(result, Err(CoreError::Storage { .. })));
    assert!(core.recovery_pending().unwrap());
    assert!(core.account_records(NetworkId::Sepolia).unwrap().is_empty());
    core.lock();
    core.unlock(PASSWORD.into()).unwrap();
    assert!(
        core.recovery_pending().unwrap(),
        "the disk never saw a partial restore"
    );
}
