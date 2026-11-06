//! Nostr relay protocol as sans-IO judges, mirroring `nostr-relay-socket.ts` and `nostr-relay.ts`.
//! The host owns the WebSockets and the timers; the core builds every frame it sends and judges
//! every frame it receives.
//!
//! The sync judge follows the extension as implemented: an oversized, non-JSON, non-array, or
//! over-long frame is ignored and the subscription stays open; every EVENT frame for the
//! subscription counts toward the 50-frame close, accepted or not; and a relay that ends early
//! (CLOSED, timeout, socket error, close) keeps the events it already delivered.

use std::sync::Mutex;

use serde_json::{json, Value};

use crate::contact_card::js_trim;
use crate::nostr::{self, NostrEvent, GIFT_WRAP_KIND};
use crate::{multisig_constants, CoreError};

/// What the host does after handing the core a frame.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum RelayStep {
    /// Keep reading.
    Continue,
    /// Send `close_frame` if present, then close the socket.
    Finish { close_frame: Option<String> },
}

/// The subscription id the extension uses for the first sync on a fresh connection.
const SUBSCRIPTION_ID: &str = "mcw-1";

fn invalid_relay() -> CoreError {
    CoreError::InvalidInput {
        reason: "invalid nostr relay endpoint".into(),
    }
}

fn is_host_label(label: &str) -> bool {
    !label.is_empty()
        && label
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn is_dotted_quad(host: &str) -> bool {
    let parts: Vec<&str> = host.split('.').collect();
    parts.len() == 4
        && parts.iter().all(|part| {
            !part.is_empty()
                && part.len() <= 3
                && part.bytes().all(|b| b.is_ascii_digit())
                && (part.len() == 1 || !part.starts_with('0'))
                && part.parse::<u16>().is_ok_and(|n| n <= 255)
        })
}

// The host as the extension's WHATWG parser would print it back: lowercase names, an IPv4 address
// in plain dotted-quad form, an IPv6 literal in its compressed RFC 5952 form. Any other spelling
// the parser would rewrite is refused, so mobile accepts a subset of the extension's canonical
// relay URLs.
fn is_host(host: &str) -> bool {
    if let Some(inner) = host.strip_prefix('[').and_then(|h| h.strip_suffix(']')) {
        // An embedded IPv4 tail prints differently in the two serializers; refuse it.
        return !inner.contains('.')
            && inner
                .parse::<std::net::Ipv6Addr>()
                .is_ok_and(|address| address.to_string() == inner);
    }
    if host.bytes().any(|b| b.is_ascii_uppercase()) {
        return false;
    }
    let name = host.strip_suffix('.').unwrap_or(host);
    let labels: Vec<&str> = name.split('.').collect();
    let numeric_tail = labels
        .last()
        .is_some_and(|label| label.bytes().all(|b| b.is_ascii_digit()));
    if numeric_tail {
        return is_dotted_quad(name);
    }
    labels.iter().all(|label| is_host_label(label))
}

// Whether the path and query are already in the parser's canonical form: a query follows a path
// (it prints `host/?q`, never `host?q`), no `.` or `..` segment (it resolves them, `%2e` spellings
// included) and no `'` in the query (it percent-encodes it).
fn is_canonical_tail(tail: &str) -> bool {
    if tail.starts_with('?') {
        return false;
    }
    let (path, query) = tail.split_once('?').unwrap_or((tail, ""));
    let dot_segment = path.split('/').any(|segment| {
        let lowered = segment.to_ascii_lowercase().replace("%2e", ".");
        lowered == "." || lowered == ".."
    });
    !dot_segment && !query.contains('\'')
}

/// Whether `value` is a relay URL mobile can connect to: `wss://host[:port][/path][?query]` in
/// plain ASCII, with no credentials or fragment, spelled exactly as the extension's WHATWG parser
/// prints it. This is a strict subset of the extension's `isNostrRelayUrl`, which accepts only a
/// URL already in canonical form (`wss:` anywhere, `ws:` on loopback). Mobile refuses `ws:`
/// because App Transport Security and `usesCleartextTraffic=false` would block it, and refuses the
/// exotic spellings WHATWG repairs (IDN hosts, `@`, an empty `#`); the parity vectors list both.
pub fn is_relay_url(value: &str) -> bool {
    if value.is_empty() || value.len() > 2048 || !value.is_ascii() {
        return false;
    }
    let Some(rest) = value.strip_prefix("wss://") else {
        return false;
    };
    let split = rest.find(['/', '?']).unwrap_or(rest.len());
    let (authority, tail) = rest.split_at(split);
    let (host, port) = match authority.rfind(':').filter(|_| !authority.ends_with(']')) {
        Some(index) => (&authority[..index], Some(&authority[index + 1..])),
        None => (authority, None),
    };
    // The parser drops the default port and leading zeros.
    let port_ok = port.is_none_or(|port| {
        !port.is_empty()
            && port.len() <= 5
            && port.bytes().all(|b| b.is_ascii_digit())
            && (port == "0" || !port.starts_with('0'))
            && port.parse::<u32>().is_ok_and(|n| n <= 65_535 && n != 443)
    });
    let tail_ok = tail
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b"-._~!$&'()*+,;=:@/?%".contains(&b));
    is_host(host) && port_ok && tail_ok && is_canonical_tail(tail)
}

/// Brings a relay URL an earlier build stored to the current rule, as the extension's
/// `normalizeStoredWebSocketServiceUrl` does: earlier builds accepted any case in the scheme and
/// host and the default port. Lowercasing those and dropping `:443` (or a zero-padded port) makes
/// the same connection; `None` when even that spelling is refused, so the caller falls back.
pub fn stored_relay_url(value: &str) -> Option<String> {
    if is_relay_url(value) {
        return Some(value.to_string());
    }
    let rest = value
        .get(6..)
        .filter(|_| value[..6].eq_ignore_ascii_case("wss://"))?;
    let split = rest.find(['/', '?']).unwrap_or(rest.len());
    let (authority, tail) = rest.split_at(split);
    let authority = authority.to_ascii_lowercase();
    let authority = match authority
        .rsplit_once(':')
        .filter(|_| !authority.ends_with(']'))
    {
        Some((host, port)) if port.bytes().all(|b| b.is_ascii_digit()) && !port.is_empty() => {
            match port.parse::<u32>().ok()? {
                443 => host.to_string(),
                number => format!("{host}:{number}"),
            }
        }
        _ => authority,
    };
    let slash = if tail.starts_with('?') { "/" } else { "" };
    let candidate = format!("wss://{authority}{slash}{tail}");
    is_relay_url(&candidate).then_some(candidate)
}

/// Trims a relay URL typed in settings. `Ok(None)` restores the reviewed defaults.
pub fn normalize_relay_url(raw: &str) -> Result<Option<String>, CoreError> {
    let trimmed = js_trim(raw);
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.len() >= 5 && trimmed[..5].eq_ignore_ascii_case("ws://") {
        return Err(CoreError::InvalidInput {
            reason: "mobile relays must use wss".into(),
        });
    }
    if !is_relay_url(trimmed) {
        return Err(invalid_relay());
    }
    Ok(Some(trimmed.to_string()))
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum RelayState {
    Open,
    Finished,
    Failed,
}

#[derive(Debug, Clone)]
struct RelaySync {
    state: RelayState,
    frames: usize,
    events: Vec<NostrEvent>,
}

/// One gift-wrap sync across the selected relays, judged frame by frame.
pub struct SyncJudge {
    recipient: String,
    since: u64,
    relays: Vec<String>,
    syncs: Mutex<Vec<RelaySync>>,
}

/// `parseFrame`: a JSON array of at most four elements, no more than 140,000 bytes.
fn parse_frame(frame: &str) -> Option<Vec<Value>> {
    if frame.len() > multisig_constants::get().relays.max_frame_bytes {
        return None;
    }
    let value: Value = serde_json::from_str(frame).ok()?;
    let parts = value.as_array()?;
    (parts.len() <= 4).then(|| parts.clone())
}

fn close_frame() -> String {
    json!(["CLOSE", SUBSCRIPTION_ID]).to_string()
}

impl SyncJudge {
    /// A judge for `recipient`'s gift wraps since `since` on `relays` (1–2 validated URLs).
    pub fn new(recipient: &str, since: u64, relays: Vec<String>) -> Result<Self, CoreError> {
        let unique = relays
            .iter()
            .enumerate()
            .all(|(i, url)| !relays[..i].contains(url));
        if !nostr::is_public_key(recipient)
            || relays.is_empty()
            || relays.len() > multisig_constants::get().relays.defaults.len()
            || !unique
            || !relays.iter().all(|url| is_relay_url(url))
        {
            return Err(invalid_relay());
        }
        let syncs = vec![
            RelaySync {
                state: RelayState::Open,
                frames: 0,
                events: Vec::new(),
            };
            relays.len()
        ];
        Ok(Self {
            recipient: recipient.to_string(),
            since,
            relays,
            syncs: Mutex::new(syncs),
        })
    }

    fn syncs(&self) -> std::sync::MutexGuard<'_, Vec<RelaySync>> {
        self.syncs
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// The selected relays, in order.
    pub fn relay_urls(&self) -> Vec<String> {
        self.relays.clone()
    }

    /// The REQ frame for one relay.
    pub fn open_frame(&self) -> String {
        let limit = multisig_constants::get().nostr.max_batch_items;
        json!(["REQ", SUBSCRIPTION_ID, { "#p": [self.recipient], "kinds": [GIFT_WRAP_KIND], "limit": limit, "since": self.since }])
            .to_string()
    }

    /// Judges one frame from relay `relay`.
    pub fn accept_frame(&self, relay: usize, frame: &str) -> RelayStep {
        let mut syncs = self.syncs();
        let Some(sync) = syncs.get_mut(relay) else {
            return RelayStep::Finish { close_frame: None };
        };
        if sync.state != RelayState::Open {
            return RelayStep::Finish { close_frame: None };
        }
        let Some(parts) = parse_frame(frame) else {
            return RelayStep::Continue;
        };
        if parts.get(1).and_then(Value::as_str) != Some(SUBSCRIPTION_ID) {
            return RelayStep::Continue;
        }
        match parts.first().and_then(Value::as_str) {
            Some("EOSE") => {
                sync.state = RelayState::Finished;
                RelayStep::Finish {
                    close_frame: Some(close_frame()),
                }
            }
            Some("CLOSED") => {
                Self::end(sync);
                RelayStep::Finish { close_frame: None }
            }
            Some("EVENT") => {
                sync.frames += 1;
                if let Some(event) = parts.get(2).and_then(nostr::event_from_value) {
                    if event.kind == GIFT_WRAP_KIND
                        && nostr::has_recipient_tag(&event, &self.recipient)
                    {
                        sync.events.push(event);
                    }
                }
                if sync.frames >= multisig_constants::get().nostr.max_batch_items {
                    sync.state = RelayState::Finished;
                    return RelayStep::Finish {
                        close_frame: Some(close_frame()),
                    };
                }
                RelayStep::Continue
            }
            _ => RelayStep::Continue,
        }
    }

    fn end(sync: &mut RelaySync) {
        if sync.state == RelayState::Open {
            sync.state = if sync.events.is_empty() {
                RelayState::Failed
            } else {
                RelayState::Finished
            };
        }
    }

    /// The relay timed out, errored, or closed: it keeps its events if it has any.
    pub fn relay_ended(&self, relay: usize) {
        if let Some(sync) = self.syncs().get_mut(relay) {
            Self::end(sync);
        }
    }

    /// Candidates across relays: round-robin up to 50, newest first then by id. Fails only when
    /// every relay failed ("Nostr relays are unavailable").
    pub fn candidates(&self) -> Result<Vec<NostrEvent>, CoreError> {
        let mut syncs = self.syncs();
        syncs.iter_mut().for_each(Self::end);
        let successful: Vec<&Vec<NostrEvent>> = syncs
            .iter()
            .filter(|sync| sync.state == RelayState::Finished)
            .map(|sync| &sync.events)
            .collect();
        if successful.is_empty() {
            return Err(CoreError::Coordination {
                reason: "nostr relays are unavailable".into(),
            });
        }
        let max = multisig_constants::get().nostr.max_batch_items;
        let mut candidates = Vec::new();
        'rounds: for index in 0.. {
            let mut added = false;
            for events in &successful {
                if let Some(event) = events.get(index) {
                    candidates.push(event.clone());
                    added = true;
                    if candidates.len() == max {
                        break 'rounds;
                    }
                }
            }
            if !added {
                break;
            }
        }
        candidates.sort_by(|left, right| {
            right
                .created_at
                .cmp(&left.created_at)
                .then_with(|| left.id.cmp(&right.id))
        });
        Ok(candidates)
    }
}

/// Publish judging for one relay (`RelayConnection.publish`): EVENT frames out, OK frames in. A
/// false OK whose message starts with `duplicate:` counts as accepted. Built and tested now; it is
/// not exported until intent sharing lands (docs/nostr-multisig.md §1).
#[allow(dead_code)]
pub struct PublishJudge {
    events: Vec<NostrEvent>,
    acks: Mutex<Vec<Option<bool>>>,
}

#[allow(dead_code)]
impl PublishJudge {
    /// A judge for validated, distinct gift wraps.
    pub fn new(events: Vec<NostrEvent>) -> Self {
        let acks = Mutex::new(vec![None; events.len()]);
        Self { events, acks }
    }

    /// The EVENT frames to send.
    pub fn event_frames(&self) -> Vec<String> {
        self.events
            .iter()
            .map(|event| json!(["EVENT", event]).to_string())
            .collect()
    }

    /// Judges one frame; `Finish` once every event is acknowledged.
    pub fn accept_frame(&self, frame: &str) -> RelayStep {
        let mut acks = self
            .acks
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(parts) = parse_frame(frame) {
            let accepted = parts.get(2).and_then(Value::as_bool);
            let duplicate = parts
                .get(3)
                .and_then(Value::as_str)
                .is_some_and(|message| message.to_lowercase().starts_with("duplicate:"));
            if let (Some("OK"), Some(id), Some(accepted)) = (
                parts.first().and_then(Value::as_str),
                parts.get(1).and_then(Value::as_str),
                accepted,
            ) {
                if let Some(index) = self.events.iter().position(|event| event.id == id) {
                    acks[index].get_or_insert(accepted || duplicate);
                }
            }
        }
        if acks.iter().all(Option::is_some) {
            RelayStep::Finish { close_frame: None }
        } else {
            RelayStep::Continue
        }
    }

    /// The relay ended: anything unacknowledged was not accepted.
    pub fn accepted(&self) -> Vec<bool> {
        let acks = self
            .acks
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        acks.iter().map(|ack| ack.unwrap_or(false)).collect()
    }
}

/// Acknowledgement counts across relays; "Nostr relays are unavailable" when no relay accepted
/// anything, as `publishWithPool`.
#[allow(dead_code)]
pub fn publish_counts(per_relay: &[Vec<bool>]) -> Result<Vec<u32>, CoreError> {
    let count = per_relay.first().map_or(0, Vec::len);
    let counts: Vec<u32> = (0..count)
        .map(|index| {
            per_relay
                .iter()
                .filter(|acks| acks.get(index) == Some(&true))
                .count() as u32
        })
        .collect();
    if counts.iter().all(|count| *count == 0) {
        return Err(CoreError::Coordination {
            reason: "nostr relays are unavailable".into(),
        });
    }
    Ok(counts)
}

#[cfg(test)]
#[path = "nostr_relay_tests.rs"]
mod tests;
