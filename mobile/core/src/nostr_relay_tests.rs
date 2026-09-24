//! Relay judge tests. Each mirrors a case in the extension's
//! `tests/background/multisig/nostr-relay.test.ts` (named in the comment above it), plus the
//! ignore-and-continue cases that pin `parseFrame` and the early-end rules.

use super::*;
use serde_json::json;

const RECIPIENT: &str = "4444444444444444444444444444444444444444444444444444444444444444";
const DEFAULTS: [&str; 2] = ["wss://relay.primal.net", "wss://nos.lol"];

fn event(id: &str, recipient: &str) -> Value {
    json!({"content":"ciphertext","created_at":1,"id":id,"kind":1059,
           "pubkey":"22".repeat(32),"sig":"33".repeat(64),"tags":[["p",recipient]]})
}

fn frame(kind: &str, payload: Option<Value>) -> String {
    match payload {
        Some(payload) => json!([kind, SUBSCRIPTION_ID, payload]).to_string(),
        None => json!([kind, SUBSCRIPTION_ID]).to_string(),
    }
}

fn judge(relays: &[&str]) -> SyncJudge {
    SyncJudge::new(RECIPIENT, 1, relays.iter().map(|r| r.to_string()).collect()).unwrap()
}

fn close() -> RelayStep {
    RelayStep::Finish {
        close_frame: Some(json!(["CLOSE", SUBSCRIPTION_ID]).to_string()),
    }
}

// "syncs only matching gift wraps from each relay"
#[test]
fn syncs_only_matching_gift_wraps_from_each_relay() {
    let sync = judge(&DEFAULTS);
    let request: Value = serde_json::from_str(&sync.open_frame()).unwrap();
    assert_eq!(
        request,
        json!(["REQ", "mcw-1", {"#p":[RECIPIENT],"kinds":[1059],"limit":50,"since":1}])
    );
    assert!(sync.open_frame().contains(r#""kinds":[1059]"#));
    for relay in 0..2 {
        let other = event(&"22".repeat(32), &"55".repeat(32));
        assert_eq!(
            sync.accept_frame(relay, &frame("EVENT", Some(other))),
            RelayStep::Continue
        );
        let wrap = event(&"11".repeat(32), RECIPIENT);
        assert_eq!(
            sync.accept_frame(relay, &frame("EVENT", Some(wrap))),
            RelayStep::Continue
        );
        assert_eq!(sync.accept_frame(relay, &frame("EOSE", None)), close());
    }
    let candidates = sync.candidates().unwrap();
    assert_eq!(candidates.len(), 2);
    assert!(candidates.iter().all(|c| c.id == "11".repeat(32)));
    assert!(SyncJudge::new("0x44", 1, vec![DEFAULTS[0].into()]).is_err());
}

// "preserves same-id relay candidates until Krusty authenticates them"
#[test]
fn preserves_same_id_candidates_across_relays() {
    let sync = judge(&DEFAULTS);
    for (relay, url) in DEFAULTS.iter().enumerate() {
        let mut wrap = event(&"ab".repeat(32), RECIPIENT);
        wrap["content"] = json!(url);
        sync.accept_frame(relay, &frame("EVENT", Some(wrap)));
        sync.accept_frame(relay, &frame("EOSE", None));
    }
    let mut contents: Vec<String> = sync
        .candidates()
        .unwrap()
        .into_iter()
        .map(|c| c.content)
        .collect();
    contents.sort();
    assert_eq!(contents, ["wss://nos.lol", "wss://relay.primal.net"]);
}

// "gives each relay space in the pre-authentication batch"
#[test]
fn gives_each_relay_space_in_the_batch() {
    let sync = judge(&DEFAULTS);
    let mut honest = event(&"fe".repeat(32), RECIPIENT);
    honest["content"] = json!("honest");
    sync.accept_frame(1, &frame("EVENT", Some(honest)));
    sync.accept_frame(1, &frame("EOSE", None));
    for index in 0..49u64 {
        let mut flood = event(&format!("{index:064x}"), RECIPIENT);
        flood["created_at"] = json!(9_007_199_254_740_991u64 - index);
        sync.accept_frame(0, &frame("EVENT", Some(flood)));
    }
    sync.accept_frame(0, &frame("EOSE", None));
    let candidates = sync.candidates().unwrap();
    assert_eq!(candidates.len(), 50);
    assert!(candidates.iter().any(|c| c.content == "honest"));
}

// "closes a subscription at the accepted frame budget"
#[test]
fn closes_a_subscription_at_the_frame_budget() {
    let sync = judge(&["wss://relay.team.example"]);
    for index in 0..49u64 {
        let wrap = event(&format!("{index:064x}"), RECIPIENT);
        assert_eq!(
            sync.accept_frame(0, &frame("EVENT", Some(wrap))),
            RelayStep::Continue
        );
    }
    assert_eq!(
        sync.accept_frame(0, &frame("EVENT", Some(event(&"ff".repeat(32), RECIPIENT)))),
        close()
    );
    assert_eq!(sync.candidates().unwrap().len(), 50);
}

// Every EVENT frame counts toward the budget, accepted or not (`pending.frames`).
#[test]
fn rejected_event_frames_count_toward_the_budget() {
    let sync = judge(&["wss://relay.team.example"]);
    let foreign = event(&"22".repeat(32), &"55".repeat(32));
    for _ in 0..49 {
        assert_eq!(
            sync.accept_frame(0, &frame("EVENT", Some(foreign.clone()))),
            RelayStep::Continue
        );
    }
    assert_eq!(
        sync.accept_frame(0, &frame("EVENT", Some(json!({"not": "an event"})))),
        close()
    );
    // As `#finishSubscription` without an error: the relay succeeded with nothing to offer.
    assert!(sync.candidates().unwrap().is_empty());
}

// "fails a refused subscription without waiting for the relay timeout"
#[test]
fn fails_a_refused_subscription() {
    let sync = judge(&["wss://relay.team.example"]);
    let closed = json!(["CLOSED", SUBSCRIPTION_ID, "restricted: test"]).to_string();
    assert_eq!(
        sync.accept_frame(0, &closed),
        RelayStep::Finish { close_frame: None }
    );
    assert!(matches!(
        sync.candidates(),
        Err(CoreError::Coordination { .. })
    ));
}

// "retains authenticated candidates received before a relay disconnect"
#[test]
fn retains_candidates_received_before_a_disconnect() {
    let sync = judge(&["wss://relay.team.example"]);
    sync.accept_frame(0, &frame("EVENT", Some(event(&"88".repeat(32), RECIPIENT))));
    sync.relay_ended(0);
    assert_eq!(sync.candidates().unwrap().len(), 1);
}

// Must-fix: a timeout after two kept events keeps both.
#[test]
fn a_timeout_after_two_events_keeps_both() {
    let sync = judge(&["wss://relay.team.example"]);
    sync.accept_frame(0, &frame("EVENT", Some(event(&"01".repeat(32), RECIPIENT))));
    sync.accept_frame(0, &frame("EVENT", Some(event(&"02".repeat(32), RECIPIENT))));
    sync.relay_ended(0);
    assert_eq!(sync.candidates().unwrap().len(), 2);
}

// Must-fix: CLOSED after events keeps them.
#[test]
fn closed_after_events_keeps_them() {
    let sync = judge(&["wss://relay.team.example"]);
    sync.accept_frame(0, &frame("EVENT", Some(event(&"01".repeat(32), RECIPIENT))));
    sync.accept_frame(
        0,
        &json!(["CLOSED", SUBSCRIPTION_ID, "error: shutting down"]).to_string(),
    );
    assert_eq!(sync.candidates().unwrap().len(), 1);
}

// Must-fix: oversized, non-JSON, non-array and five-element frames are ignored, not fatal.
#[test]
fn malformed_frames_are_ignored_and_the_subscription_continues() {
    let sync = judge(&["wss://relay.team.example"]);
    let oversized = format!(r#"["NOTICE","{}"]"#, "x".repeat(140_001));
    for ignored in [
        oversized.as_str(),
        "not json",
        r#"{"EVENT":1}"#,
        r#"["EVENT","mcw-1",{},1,2]"#,
        r#"["EVENT","mcw-2",{}]"#,
        r#"["OK","mcw-1",true,""]"#,
    ] {
        assert_eq!(sync.accept_frame(0, ignored), RelayStep::Continue);
    }
    sync.accept_frame(0, &frame("EVENT", Some(event(&"03".repeat(32), RECIPIENT))));
    assert_eq!(sync.accept_frame(0, &frame("EOSE", None)), close());
    assert_eq!(sync.candidates().unwrap().len(), 1);
}

// The frame limit is strictly greater than 140,000 bytes: exactly 140,000 is read.
#[test]
fn a_frame_of_exactly_the_limit_is_read_and_one_byte_more_is_ignored() {
    let sized = |length: usize, id: &str| {
        let mut wrap = event(&id.repeat(32), RECIPIENT);
        let mut tags = vec![json!(["p", RECIPIENT])];
        tags.extend((0..18).map(|_| json!(["x", "y".repeat(500)])));
        wrap["tags"] = json!(tags);
        wrap["content"] = json!("");
        let overhead = frame("EVENT", Some(wrap.clone())).len();
        assert!(length - overhead <= 131_070);
        wrap["content"] = json!("c".repeat(length - overhead));
        let text = frame("EVENT", Some(wrap));
        assert_eq!(text.len(), length);
        text
    };
    let sync = judge(&["wss://relay.team.example"]);
    sync.accept_frame(0, &sized(140_001, "01"));
    sync.accept_frame(0, &sized(140_000, "02"));
    sync.accept_frame(0, &frame("EOSE", None));
    let ids: Vec<String> = sync
        .candidates()
        .unwrap()
        .into_iter()
        .map(|c| c.id)
        .collect();
    assert_eq!(ids, ["02".repeat(32)]);
}

#[test]
fn every_relay_failing_is_unavailable_and_order_is_newest_first() {
    let sync = judge(&DEFAULTS);
    sync.relay_ended(0);
    sync.relay_ended(1);
    assert!(sync.candidates().is_err());

    let sync = judge(&["wss://relay.team.example"]);
    for (id, at) in [("0b", 5), ("0a", 5), ("0c", 9)] {
        let mut wrap = event(&id.repeat(32), RECIPIENT);
        wrap["created_at"] = json!(at);
        sync.accept_frame(0, &frame("EVENT", Some(wrap)));
    }
    sync.accept_frame(0, &frame("EOSE", None));
    let ids: Vec<String> = sync
        .candidates()
        .unwrap()
        .into_iter()
        .map(|c| c.id[..2].to_string())
        .collect();
    assert_eq!(ids, ["0c", "0a", "0b"]);
}

// "rejects insecure, duplicate, or empty relay selections"
#[test]
fn rejects_insecure_duplicate_or_empty_relay_selections() {
    assert!(SyncJudge::new(RECIPIENT, 1, vec!["ws://relay.example".into()]).is_err());
    assert!(SyncJudge::new(RECIPIENT, 1, vec![]).is_err());
    assert!(SyncJudge::new(RECIPIENT, 1, vec![DEFAULTS[0].into(), DEFAULTS[0].into()]).is_err());
}

#[test]
fn relay_urls_are_secure_ascii_and_trimmed() {
    assert_eq!(normalize_relay_url("  ").unwrap(), None);
    assert_eq!(
        normalize_relay_url(" wss://relay.example/path?x=1 ")
            .unwrap()
            .as_deref(),
        Some("wss://relay.example/path?x=1")
    );
    assert!(
        matches!(normalize_relay_url("ws://localhost:7000"), Err(CoreError::InvalidInput { reason }) if reason.contains("wss"))
    );
    for good in [
        "wss://relay.example",
        "WSS://relay.example:443",
        "wss://127.0.0.1:7000",
        "wss://[::1]:7000/nostr",
    ] {
        assert!(is_relay_url(good), "{good}");
    }
    for bad in [
        "https://relay.example",
        "wss://user:pw@relay.example",
        "wss://relay.example/#x",
        "wss://",
        "wss://relay example",
        "wss://999.1.1.1",
        "wss://relay.example:70000",
        "wss://réseau.example",
    ] {
        assert!(!is_relay_url(bad), "{bad}");
    }
}

// "returns after one durable relay copy and accepts idempotent duplicate acks"
#[test]
fn publish_counts_duplicates_as_accepted_and_fails_when_nothing_landed() {
    let wrap = nostr::event_from_value(&event(&"66".repeat(32), RECIPIENT)).unwrap();
    let judge = PublishJudge::new(vec![wrap.clone()]);
    assert!(judge.event_frames()[0].starts_with(r#"["EVENT",{"#));
    let duplicate = json!(["OK", wrap.id, false, "duplicate: already have it"]).to_string();
    assert_eq!(
        judge.accept_frame(&duplicate),
        RelayStep::Finish { close_frame: None }
    );
    assert_eq!(judge.accepted(), [true]);
    let refused = PublishJudge::new(vec![wrap.clone()]);
    refused.accept_frame(&json!(["OK", wrap.id, false, "blocked: no"]).to_string());
    assert_eq!(refused.accepted(), [false]);
    assert_eq!(publish_counts(&[vec![true], vec![false]]).unwrap(), [1]);
    assert!(publish_counts(&[vec![false], vec![false]]).is_err());
}
