//! Nostr relay protocol over `wallet_core::nostr::{relay_url, relay, sync}`, which mirror the
//! extension's `nostr-relay-socket.ts`, `nostr-relay.ts` and `isNostrRelayUrl`. The host owns the
//! WebSockets and the timers; the core builds every frame it sends and judges every frame it
//! receives. Mobile adds two things here: its UniFFI `RelayStep`, and the `wss:`-only platform
//! rule.
//!
//! The sync reads one page per relay until the FFI can page (wallet-core plan, 2.7): the core's
//! judge runs with a page cap of 1, so mobile already has its unseen-first bound (seen wraps are
//! skipped before the 50-wrap batch bound) and its error messages, but not the `until` cursor or
//! later pages.

use std::collections::HashSet;
use std::sync::{Mutex, MutexGuard, PoisonError};

use wallet_core::nostr::relay::{self, RelayError, RelayLimits};
use wallet_core::nostr::relay_url::is_nostr_relay_url;
use wallet_core::nostr::sync;

use crate::contact_card::js_trim;
use crate::nostr::NostrEvent;
use crate::{multisig_constants, CoreError};

/// What the host does after handing the core a frame.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum RelayStep {
    /// Keep reading.
    Continue,
    /// Send `close_frame` if present, then close the socket.
    Finish { close_frame: Option<String> },
}

impl From<relay::RelayStep> for RelayStep {
    fn from(step: relay::RelayStep) -> Self {
        match step {
            relay::RelayStep::Continue => Self::Continue,
            relay::RelayStep::Finish { close_frame } => Self::Finish { close_frame },
            // Unreachable at mobile's page cap of 1; stopping is the fail-safe. It goes at 2.7,
            // when the FFI's `RelayStep` gains the next page.
            relay::RelayStep::NextPage { close_frame, .. } => Self::Finish {
                close_frame: Some(close_frame),
            },
        }
    }
}

impl From<RelayError> for CoreError {
    fn from(error: RelayError) -> Self {
        let reason = error.to_string();
        match error {
            RelayError::RelaysUnavailable => Self::Coordination { reason },
            _ => Self::InvalidInput { reason },
        }
    }
}

fn invalid_relay() -> CoreError {
    CoreError::InvalidInput {
        reason: "invalid nostr relay endpoint".into(),
    }
}

/// Whether `value` is a relay URL mobile can connect to: the core's `is_nostr_relay_url` (the
/// extension's canonical-spelling grammar) over `wss:` only. The core and the extension also
/// accept `ws:` on `127.0.0.1` and `localhost`; mobile refuses it as a platform rule, because App
/// Transport Security and `usesCleartextTraffic=false` block cleartext sockets, loopback included.
pub fn is_relay_url(value: &str) -> bool {
    value.starts_with("wss://") && is_nostr_relay_url(value)
}

/// Mobile's relay numbers: as many relays as the reviewed defaults, and one page (see the module
/// comment).
fn limits() -> RelayLimits {
    RelayLimits {
        max_relays: multisig_constants::get().relays.defaults.len(),
        max_sync_pages: 1,
    }
}

// The core checked the selection; mobile additionally refuses `ws:` with the same error.
fn secure(relay_urls: &[String]) -> Result<(), CoreError> {
    if relay_urls.iter().all(|url| is_relay_url(url)) {
        Ok(())
    } else {
        Err(RelayError::InvalidRelayConfiguration.into())
    }
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

/// Trims a relay URL typed in settings, as bramble-core's `with_nostr_relay_url` over the core's
/// grammar, plus the `wss:` rule with its own message. `Ok(None)` restores the reviewed defaults.
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

/// One gift-wrap sync across the selected relays: the core's judge behind a lock, so the UniFFI
/// plan can drive it through `&self`.
pub struct SyncJudge(Mutex<sync::SyncJudge>);

impl SyncJudge {
    /// A judge for `recipient`'s gift wraps since `since` on `relays`, skipping `seen` wraps
    /// before the batch bound. The core's checks and messages, then mobile's `wss:` rule.
    pub fn new(
        recipient: &str,
        since: i64,
        relays: Vec<String>,
        seen: HashSet<String>,
    ) -> Result<Self, CoreError> {
        let judge = sync::sync_nostr_gift_wraps(recipient, since, relays, seen, limits())?;
        secure(judge.relay_urls())?;
        Ok(Self(Mutex::new(judge)))
    }

    fn judge(&self) -> MutexGuard<'_, sync::SyncJudge> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The selected relays, in order.
    pub fn relay_urls(&self) -> Vec<String> {
        self.judge().relay_urls().to_vec()
    }

    /// The REQ frame for one relay.
    pub fn open_frame(&self) -> String {
        self.judge().open_frame()
    }

    /// Judges one frame from relay `relay`.
    pub fn accept_frame(&self, relay: usize, frame: &str) -> RelayStep {
        self.judge().accept_frame(relay, frame).into()
    }

    /// The relay timed out, errored, or closed: it keeps its events if it has any.
    pub fn relay_ended(&self, relay: usize) {
        self.judge().relay_ended(relay);
    }

    /// Unseen candidates across relays: round-robin up to 50, newest first then by id. Fails only
    /// when every relay failed ("Nostr relays are unavailable").
    pub fn candidates(&self) -> Result<Vec<NostrEvent>, CoreError> {
        Ok(self.judge().candidates()?)
    }
}

/// Starts a publish of gift wraps (`publishManyNostrGiftWraps`): the core's batch validation,
/// relay selection and acknowledgement counting, then mobile's `wss:` rule. Built for the parity
/// suite; nothing calls it until intent sharing lands (docs/nostr-multisig.md §1).
#[cfg(feature = "testing")]
pub fn publish_many(
    gift_wraps: &[relay::NostrGiftWrapDelivery],
    relay_urls: &[String],
) -> Result<relay::PublishMany, CoreError> {
    let publish = relay::publish_many_nostr_gift_wraps(gift_wraps, relay_urls, limits())?;
    secure(relay_urls)?;
    Ok(publish)
}

#[cfg(test)]
#[path = "nostr_relay_tests.rs"]
mod tests;
