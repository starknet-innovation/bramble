//! Private totals from discovery pages: the SDK's `discoverNotes` accumulation
//! (`convertIncomingNotes`, `apiCursorToNotesCursor`) folded into the extension's `balancesFrom`
//! rules, so no note is ever held, only per-token totals.
//!
//! Rules, as the extension applies them to the whole note map: at most `balances` distinct tokens
//! and `discovered_notes` notes; every token in `(0, P)`; every amount in `[0, P)`; every per-token
//! total below `P`. A note's sender must have a channel key, either in this page's `channels`
//! (matched on the exact `sender_addr` text, as the SDK's `Map<string, bigint>` does) or in an
//! earlier page's cursor (matched numerically). Any violation is `None`: the caller fails
//! `InvalidResponse` and nothing partial is shown.

use std::collections::{BTreeMap, BTreeSet};

use super::config::Limits;
use super::json::{js_bigint, Ordered, FIELD_PRIME};
use crate::send::u256::U256;

/// Totals gathered so far in one discovery attempt.
#[derive(Debug, Default)]
pub struct Totals {
    totals: BTreeMap<U256, U256>,
    notes: usize,
    /// Senders whose channel key an earlier page's cursor carried.
    known_senders: BTreeSet<U256>,
}

fn array(value: Option<&Ordered>) -> Option<&[Ordered]> {
    match value? {
        Ordered::Array(items) => Some(items),
        _ => None,
    }
}

fn text(value: Option<&Ordered>) -> Option<&str> {
    match value? {
        Ordered::Str(text) => Some(text),
        _ => None,
    }
}

impl Totals {
    /// Folds one `incoming_state` reply's `channels` and `notes`, then records its cursor's
    /// channels for later pages. `None` on any rule violation.
    pub fn fold_page(&mut self, reply: &Ordered, limits: &Limits) -> Option<()> {
        let mut page_senders: Vec<&str> = Vec::new();
        for channel in array(reply.get("channels"))? {
            let sender = text(channel.get("sender_addr"))?;
            // `BigInt(ch.channel_key)` must parse, or the SDK throws.
            js_bigint(channel.get("channel_key")?)?;
            page_senders.push(sender);
        }
        // `subchannels` is not read by the SDK's incoming discovery, so it is not judged here.
        for note in array(reply.get("notes"))? {
            let token = js_bigint(note.get("token")?)?;
            let sender_text = text(note.get("sender_addr"))?;
            let sender = js_bigint(note.get("sender_addr")?)?;
            js_bigint(note.get("salt")?)?;
            let amount = js_bigint(note.get("amount")?)?;
            if !page_senders.contains(&sender_text) && !self.known_senders.contains(&sender) {
                return None;
            }
            self.add(token, amount, limits)?;
        }
        self.record_cursor(reply.get("cursor")?)
    }

    fn add(&mut self, token: U256, amount: U256, limits: &Limits) -> Option<()> {
        self.notes += 1;
        if self.notes > limits.discovered_notes
            || token == U256::ZERO
            || token >= FIELD_PRIME
            || amount >= FIELD_PRIME
        {
            return None;
        }
        if !self.totals.contains_key(&token) && self.totals.len() >= limits.balances {
            return None;
        }
        let total = self.totals.entry(token).or_insert(U256::ZERO);
        let next = total.checked_add(amount)?;
        if next >= FIELD_PRIME {
            return None;
        }
        *total = next;
        Some(())
    }

    /// `apiCursorToNotesCursor`: every sender and subchannel token key must be a big integer;
    /// a missing `channel_key` reads as `0n`, which the SDK still accepts as a key.
    fn record_cursor(&mut self, cursor: &Ordered) -> Option<()> {
        let Ordered::Object(_) = cursor else {
            return None;
        };
        let Some(channels) = cursor.get("channels") else {
            return Some(());
        };
        let members = match channels {
            Ordered::Object(members) => members,
            Ordered::Null => return Some(()),
            _ => return None,
        };
        let mut senders = Vec::with_capacity(members.len());
        for (sender, channel) in members {
            let sender = js_bigint(&Ordered::Str(sender.clone()))?;
            match channel.get("channel_key") {
                None | Some(Ordered::Null) => {}
                Some(key) => {
                    js_bigint(key)?;
                }
            }
            match channel.get("subchannels") {
                None | Some(Ordered::Null) => {}
                Some(Ordered::Object(tokens)) => {
                    for (token, _) in tokens {
                        js_bigint(&Ordered::Str(token.clone()))?;
                    }
                }
                Some(_) => return None,
            }
            senders.push(sender);
        }
        self.known_senders.extend(senders);
        Some(())
    }

    /// The total for one token (zero when no note was found).
    pub fn total(&self, token: &U256) -> U256 {
        self.totals.get(token).copied().unwrap_or(U256::ZERO)
    }
}

fn flag(value: Option<&Ordered>) -> Option<bool> {
    match value {
        None | Some(Ordered::Null) => Some(false),
        Some(Ordered::Bool(value)) => Some(*value),
        Some(_) => None,
    }
}

/// `isApiCursorComplete`, over strict booleans; `None` for a malformed cursor.
pub fn cursor_complete(cursor: &Ordered) -> Option<bool> {
    let Ordered::Object(_) = cursor else {
        return None;
    };
    if !flag(cursor.get("channel_discovery_complete"))? {
        return Some(false);
    }
    let channels = match cursor.get("channels") {
        None | Some(Ordered::Null) => return Some(true),
        Some(Ordered::Object(members)) => members,
        Some(_) => return None,
    };
    for (_, channel) in channels {
        if !flag(channel.get("subchannel_discovery_complete"))? {
            return Some(false);
        }
        match channel.get("subchannels") {
            None | Some(Ordered::Null) => {}
            Some(Ordered::Object(tokens)) => {
                for (_, sub) in tokens {
                    if !flag(sub.get("note_discovery_complete"))? {
                        return Some(false);
                    }
                }
            }
            Some(_) => return None,
        }
    }
    Some(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn limits() -> Limits {
        super::super::config::routing().limits.clone()
    }

    fn page(text: &str) -> Ordered {
        serde_json::from_str(text).unwrap()
    }

    const DONE: &str = r#""cursor":{"channel_discovery_complete":true}"#;

    #[test]
    fn sums_per_token_and_requires_a_channel_key() {
        let mut totals = Totals::default();
        let reply = page(&format!(
            r#"{{"block_ref":"0x1","channels":[{{"channel_key":"0x9","sender_addr":"0x5"}}],"subchannels":[],"notes":[
              {{"sender_addr":"0x5","token":"0xa","index":0,"note_id":"0x1","amount":"1000","salt":"7","block_number":1}},
              {{"sender_addr":"0x5","token":"0xa","index":1,"note_id":"0x2","amount":"0x10","salt":"1","block_number":1}}],{DONE}}}"#
        ));
        totals.fold_page(&reply, &limits()).unwrap();
        assert_eq!(totals.total(&U256::from_u128(10)), U256::from_u128(1016));
        let orphan = page(&format!(
            r#"{{"block_ref":"0x1","channels":[],"subchannels":[],"notes":[
              {{"sender_addr":"0x6","token":"0xa","index":0,"note_id":"0x1","amount":"1","salt":"7","block_number":1}}],{DONE}}}"#
        ));
        assert!(Totals::default().fold_page(&orphan, &limits()).is_none());
    }

    #[test]
    fn a_later_page_may_use_an_earlier_cursor_channel() {
        let mut totals = Totals::default();
        let first = page(
            r#"{"block_ref":"0x1","channels":[],"subchannels":[],"notes":[],"cursor":{"channel_discovery_complete":false,"channels":{"0x05":{"channel_key":"0x9"}}}}"#,
        );
        totals.fold_page(&first, &limits()).unwrap();
        let second = page(&format!(
            r#"{{"block_ref":"0x1","channels":[],"subchannels":[],"notes":[
              {{"sender_addr":"0x5","token":"0xa","index":0,"note_id":"0x1","amount":"3","salt":"7","block_number":1}}],{DONE}}}"#
        ));
        totals.fold_page(&second, &limits()).unwrap();
        assert_eq!(totals.total(&U256::from_u128(10)), U256::from_u128(3));
    }

    #[test]
    fn completion_follows_the_sdk() {
        let complete = |t: &str| cursor_complete(&page(t));
        assert_eq!(complete(r#"{}"#), Some(false));
        assert_eq!(
            complete(r#"{"channel_discovery_complete":true}"#),
            Some(true)
        );
        assert_eq!(
            complete(
                r#"{"channel_discovery_complete":true,"channels":{"0x1":{"subchannel_discovery_complete":true,"subchannels":{"0x2":{"note_discovery_complete":false}}}}}"#
            ),
            Some(false)
        );
        assert_eq!(complete(r#"{"channel_discovery_complete":1}"#), None);
        assert_eq!(complete(r#"[]"#), None);
    }
}
