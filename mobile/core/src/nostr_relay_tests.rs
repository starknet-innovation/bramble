//! Mobile's relay rules over the core's judges. The judges' own tests (frame parsing, the frame
//! budget, early ends, ordering, publishing and the URL grammar) live with them in wallet-core's
//! `nostr/{relay_tests, sync_tests, relay_url}.rs`; what stays here is what mobile adds: one page
//! per relay, the `wss:`-only rule, the settings normaliser and the stored-relay reader.

use super::*;
use serde_json::{json, Value};

const RECIPIENT: &str = "4444444444444444444444444444444444444444444444444444444444444444";

fn event(id: &str) -> Value {
    json!({"content":"ciphertext","created_at":1,"id":id,"kind":1059,
           "pubkey":"22".repeat(32),"sig":"33".repeat(64),"tags":[["p",RECIPIENT]]})
}

fn judge(relays: &[&str]) -> Result<SyncJudge, CoreError> {
    let relays = relays.iter().map(|r| r.to_string()).collect();
    SyncJudge::new(RECIPIENT, 1, relays, HashSet::new())
}

// "closes a subscription at the accepted frame budget". With one page per relay, a full page
// finishes the relay with its CLOSE instead of asking for the next page.
#[test]
fn closes_a_subscription_at_the_frame_budget() {
    let sync = judge(&["wss://relay.team.example"]).unwrap();
    let frame = |id: String| json!(["EVENT", "mcw-1", event(&id)]).to_string();
    for index in 0..49u64 {
        assert_eq!(
            sync.accept_frame(0, &frame(format!("{index:064x}"))),
            RelayStep::Continue
        );
    }
    assert_eq!(
        sync.accept_frame(0, &frame("ff".repeat(32))),
        RelayStep::Finish {
            close_frame: Some(json!(["CLOSE", "mcw-1"]).to_string()),
        }
    );
    assert_eq!(sync.candidates().unwrap().len(), 50);
}

// The paging fixture's "seen wraps are skipped before the batch bound" needs a second page; on
// one page the same rule shows across relays: relay 0's seen wraps no longer take batch slots
// from relay 1's unseen ones.
#[test]
fn seen_wraps_are_skipped_before_the_batch_bound() {
    let id = |n: u64| format!("{n:064x}");
    let seen: HashSet<String> = (0..25).map(id).collect();
    let urls = vec!["wss://relay.one.example".into(), "wss://relay.two".into()];
    let sync = SyncJudge::new(RECIPIENT, 1, urls, seen).unwrap();
    for (relay, ids) in [(0, 0..50u64), (1, 100..130)] {
        for n in ids {
            sync.accept_frame(relay, &json!(["EVENT", "mcw-1", event(&id(n))]).to_string());
        }
        sync.accept_frame(relay, &json!(["EOSE", "mcw-1"]).to_string());
    }
    let candidates = sync.candidates().unwrap();
    assert_eq!(candidates.len(), 50);
    assert!(candidates.iter().all(|event| event.id >= id(25)));
}

// The paging fixture's "a loopback relay" and the rules fixture's `ws://localhost:7000`: the core
// and the extension accept `ws:` on loopback; mobile refuses it with the core's message.
#[test]
fn a_loopback_ws_relay_is_refused() {
    for url in ["ws://localhost:7000", "ws://127.0.0.1:7000"] {
        assert!(is_nostr_relay_url(url) && !is_relay_url(url), "{url}");
        assert!(matches!(
            judge(&[url]),
            Err(CoreError::InvalidInput { reason }) if reason == "Invalid Nostr relay configuration"
        ));
    }
    assert!(judge(&["wss://relay.team.example"]).is_ok());
}

#[test]
fn relay_urls_are_secure_and_trimmed() {
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
    assert!(normalize_relay_url("WSS://relay.example").is_err());
}

// `normalizeStoredWebSocketServiceUrl`: an earlier build's spelling reads back as the same
// connection, and one with no current spelling reads back as nothing.
#[test]
fn stored_relay_urls_are_brought_to_the_current_rule() {
    for (stored, current) in [
        ("wss://relay.example", Some("wss://relay.example")),
        ("WSS://Relay.Example", Some("wss://relay.example")),
        (
            "wss://relay.example:443/nostr",
            Some("wss://relay.example/nostr"),
        ),
        (
            "Wss://Relay.Example:0443?Q=1",
            Some("wss://relay.example/?Q=1"),
        ),
        (
            "wss://relay.example:07447",
            Some("wss://relay.example:7447"),
        ),
        ("wss://relay.example/a/../b", None),
        ("ws://relay.example", None),
        ("ws://localhost:7000", None),
        ("not a url", None),
    ] {
        assert_eq!(stored_relay_url(stored).as_deref(), current, "{stored}");
    }
}
