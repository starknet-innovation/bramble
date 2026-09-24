//! Nostr coordination identity and NIP-59 application data, mirroring the extension's
//! `vault/service/nostr.ts`, `wallet-model/nostr` and the Krusty adapter (`kms-krusty/adapter.ts`).
//!
//! The coordination key is `m/44'/1237'/0'/0/0` of the recovery phrase **without** the BIP-39
//! passphrase, exactly as the extension derives it, so co-signers reach the same identity from
//! either wallet. The private key is derived per call into a `Zeroizing` buffer, only borrowed by
//! Krusty, and never cached, persisted, logged, or returned. Inputs are validated before they reach
//! Krusty and outputs are re-validated before they leave, as the adapter does.

use serde::Serialize;
use serde_json::Value;
use zeroize::Zeroizing;

use crate::multisig_constants;
use crate::CoreError;

/// NIP-59 gift-wrap kind.
pub const GIFT_WRAP_KIND: u64 = 1_059;
/// JavaScript's `Number.MAX_SAFE_INTEGER`.
const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

/// A bounded signed event that passed `isNostrEvent`; authenticity is still unknown.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NostrEvent {
    pub content: String,
    pub created_at: u64,
    pub id: String,
    pub kind: u64,
    pub pubkey: String,
    pub sig: String,
    pub tags: Vec<Vec<String>>,
}

/// Authenticated application data opened from a gift wrap addressed to this wallet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApplicationData {
    pub content: String,
    pub identifier: String,
    pub sender_public_key: String,
}

fn kms_error(operation: &str) -> CoreError {
    CoreError::Kms {
        operation: operation.into(),
    }
}

/// Length in UTF-16 code units, the unit JavaScript's `String.length` counts.
pub fn utf16_length(value: &str) -> usize {
    value.encode_utf16().count()
}

fn is_lower_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// `isNostrPublicKey`: 64 lowercase hex digits (also `isNostrEventId`).
pub fn is_public_key(value: &str) -> bool {
    is_lower_hex(value, 64)
}

/// The adapter's application identifier grammar: 1–128 printable ASCII characters.
pub fn is_identifier(value: &str) -> bool {
    !value.is_empty() && value.len() <= 128 && value.bytes().all(|b| (b' '..=b'~').contains(&b))
}

/// `isNostrApplicationData`: 1..=32,768 UTF-8 bytes (UTF-8 is never shorter than UTF-16).
pub fn is_application_data(value: &str) -> bool {
    !value.is_empty() && value.len() <= multisig_constants::get().nostr.max_application_data_bytes
}

/// `Number.isSafeInteger(value) && value >= 0`, including JSON spellings such as `1.0` or `1e3`.
pub fn safe_non_negative_integer(value: &Value) -> Option<u64> {
    if let Some(n) = value.as_u64() {
        return (n <= MAX_SAFE_INTEGER).then_some(n);
    }
    if value.as_i64().is_some() {
        return None; // negative
    }
    let float = value.as_f64()?;
    let valid = float.is_finite()
        && float.fract() == 0.0
        && (0.0..=MAX_SAFE_INTEGER as f64).contains(&float);
    // The range check above makes the cast exact.
    valid.then_some(float as u64)
}

fn tag(value: &Value) -> Option<Vec<String>> {
    let parts = value.as_array()?;
    if parts.len() > 8 {
        return None;
    }
    parts
        .iter()
        .map(|part| {
            part.as_str()
                .filter(|text| utf16_length(text) <= 512)
                .map(str::to_string)
        })
        .collect()
}

/// `isNostrEvent`: exactly the seven NIP-01 keys, each bounded as the extension bounds it.
pub fn event_from_value(value: &Value) -> Option<NostrEvent> {
    let object = value.as_object()?;
    const KEYS: [&str; 7] = [
        "content",
        "created_at",
        "id",
        "kind",
        "pubkey",
        "sig",
        "tags",
    ];
    if !object.keys().all(|key| KEYS.contains(&key.as_str())) {
        return None;
    }
    let max = multisig_constants::get().nostr.max_event_json_bytes;
    let content = object.get("content")?.as_str()?;
    if content.is_empty() || content.len() > max {
        return None;
    }
    let created_at = safe_non_negative_integer(object.get("created_at")?)?;
    let id = object.get("id")?.as_str().filter(|id| is_public_key(id))?;
    let kind = safe_non_negative_integer(object.get("kind")?).filter(|kind| *kind <= 65_535)?;
    let pubkey = object
        .get("pubkey")?
        .as_str()
        .filter(|key| is_public_key(key))?;
    let sig = object
        .get("sig")?
        .as_str()
        .filter(|sig| is_lower_hex(sig, 128))?;
    let tags = object.get("tags")?.as_array()?;
    if tags.len() > 32 {
        return None;
    }
    Some(NostrEvent {
        content: content.to_string(),
        created_at,
        id: id.to_string(),
        kind,
        pubkey: pubkey.to_string(),
        sig: sig.to_string(),
        tags: tags.iter().map(tag).collect::<Option<_>>()?,
    })
}

/// `parseNostrEventJson`: a bounded JSON event, or `None`.
pub fn parse_event_json(text: &str) -> Option<NostrEvent> {
    if text.is_empty() || text.len() > multisig_constants::get().nostr.max_event_json_bytes {
        return None;
    }
    event_from_value(&serde_json::from_str(text).ok()?)
}

/// `hasNostrRecipientTag`: some tag is `["p", recipient, …]`.
pub fn has_recipient_tag(event: &NostrEvent, recipient: &str) -> bool {
    event
        .tags
        .iter()
        .any(|tag| tag.len() >= 2 && tag[0] == "p" && tag[1] == recipient)
}

/// The coordination private key at Nostr address `index` (the wallet uses 0; tests use 1 as a
/// second identity). Passphrase fixed at `None`, as in the extension.
fn private_key(mnemonic: &str, index: u32) -> Result<Zeroizing<[u8; 32]>, CoreError> {
    krusty_kms::derive_nostr_private_key(mnemonic, index, 0, None)
        .map(Zeroizing::new)
        .map_err(|_| kms_error("nostr key"))
}

/// The wallet's coordination public key: BIP-340 x-only, 64 lowercase hex digits.
pub fn public_key(mnemonic: &str) -> Result<String, CoreError> {
    public_key_at(mnemonic, 0)
}

/// [`public_key`] at Nostr address `index`.
pub fn public_key_at(mnemonic: &str, index: u32) -> Result<String, CoreError> {
    let key = private_key(mnemonic, index)?;
    let public = krusty_kms::nostr_public_key(&key).map_err(|_| kms_error("nostr public key"))?;
    let hex: String = public.iter().map(|b| format!("{b:02x}")).collect();
    if !is_public_key(&hex) {
        return Err(kms_error("nostr public key"));
    }
    Ok(hex)
}

/// Opens one gift wrap addressed to this wallet. Any failure, from the event grammar to Krusty's
/// signature and rumor checks to the output bounds, yields `None`: a relay event is untrusted.
pub fn open(mnemonic: &str, event: &NostrEvent) -> Option<ApplicationData> {
    open_at(mnemonic, 0, event)
}

/// [`open`] with the coordination key at Nostr address `index`.
pub fn open_at(mnemonic: &str, index: u32, event: &NostrEvent) -> Option<ApplicationData> {
    if event.kind != GIFT_WRAP_KIND {
        return None;
    }
    // Re-serialised from the validated fields, as the extension passes `JSON.stringify(event)`.
    let json = serde_json::to_string(event).ok()?;
    if json.len() > multisig_constants::get().nostr.max_event_json_bytes {
        return None;
    }
    let key = private_key(mnemonic, index).ok()?;
    let opened = krusty_kms::open_nostr_application_data(&key, &json).ok()?;
    let valid = is_application_data(&opened.content)
        && is_identifier(&opened.identifier)
        && is_public_key(&opened.sender_public_key);
    valid.then_some(ApplicationData {
        content: opened.content,
        identifier: opened.identifier,
        sender_public_key: opened.sender_public_key,
    })
}

/// Wraps application data for one recipient at the host's clock (`now`, Unix seconds). The output
/// is re-checked as the adapter does: a bounded kind-1059 event carrying the recipient's `p` tag.
/// `index` is the sender's Nostr address (the wallet uses 0). Today only the test hooks call it;
/// intent sharing, which is deferred (docs/nostr-multisig.md §1), will.
pub fn wrap(
    mnemonic: &str,
    index: u32,
    recipient: &str,
    identifier: &str,
    content: &str,
    now: u64,
) -> Result<String, CoreError> {
    if !is_public_key(recipient) || !is_identifier(identifier) || !is_application_data(content) {
        return Err(CoreError::InvalidInput {
            reason: "invalid nostr application data".into(),
        });
    }
    let key = private_key(mnemonic, index)?;
    let wrapped =
        krusty_kms::wrap_nostr_application_data_at(&key, recipient, identifier, content, now)
            .map_err(|_| kms_error("nostr wrap"))?;
    match parse_event_json(&wrapped) {
        Some(event) if event.kind == GIFT_WRAP_KIND && has_recipient_tag(&event, recipient) => {
            Ok(wrapped)
        }
        _ => Err(kms_error("nostr wrap")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const PHRASE: &str =
        "habit hope tip crystal because grunt nation idea electric witness alert like";

    fn event() -> Value {
        json!({"content":"x","created_at":1,"id":"a".repeat(64),"kind":1059,
               "pubkey":"b".repeat(64),"sig":"c".repeat(128),"tags":[["p","d".repeat(64)]]})
    }

    #[test]
    fn event_grammar_matches_is_nostr_event() {
        assert!(event_from_value(&event()).is_some());
        let mut float = event();
        float["created_at"] = json!(1.0);
        assert_eq!(event_from_value(&float).unwrap().created_at, 1);
        for (key, bad) in [
            ("created_at", json!(-1)),
            ("created_at", json!(1.5)),
            ("created_at", json!(9_007_199_254_740_992_u64)),
            ("kind", json!(65_536)),
            ("id", json!("A".repeat(64))),
            ("sig", json!("c".repeat(127))),
            ("content", json!("")),
            ("tags", json!([vec!["p"; 9]])),
            ("tags", json!(vec![vec!["p"]; 33])),
            ("tags", json!([["x".repeat(513)]])),
        ] {
            let mut value = event();
            value[key] = bad;
            assert!(event_from_value(&value).is_none(), "{key}");
        }
        let mut extra = event();
        extra["extra"] = json!(1);
        assert!(event_from_value(&extra).is_none());
        let mut missing = event();
        missing.as_object_mut().unwrap().remove("tags");
        assert!(event_from_value(&missing).is_none());
        // UTF-16 length, not bytes: 512 two-byte characters is still within a tag part's bound.
        let mut wide = event();
        wide["tags"] = json!([["é".repeat(512)]]);
        assert!(event_from_value(&wide).is_some());
    }

    #[test]
    fn identifiers_are_printable_ascii() {
        assert!(is_identifier("bramble.multisig"));
        assert!(!is_identifier(""));
        assert!(!is_identifier(&"a".repeat(129)));
        assert!(!is_identifier("tab\there"));
        assert!(!is_identifier("é"));
    }

    #[test]
    fn wraps_open_only_for_their_recipient() {
        // The recipient is the same phrase's Nostr address 1: a second identity, no second phrase.
        let recipient = public_key_at(PHRASE, 1).unwrap();
        let sender = public_key(PHRASE).unwrap();
        assert_ne!(recipient, sender);
        let wrapped = wrap(
            PHRASE,
            0,
            &recipient,
            "bramble.multisig",
            "hello",
            1_750_000_000,
        )
        .unwrap();
        let event = parse_event_json(&wrapped).unwrap();
        let opened = open_at(PHRASE, 1, &event).unwrap();
        assert_eq!(opened.content, "hello");
        assert_eq!(opened.identifier, "bramble.multisig");
        assert_eq!(opened.sender_public_key, sender);
        assert!(open(PHRASE, &event).is_none(), "wrong recipient");
        let mut tampered = event.clone();
        tampered.sig = format!("{}0", &tampered.sig[..127]);
        if tampered.sig == event.sig {
            tampered.sig = format!("{}1", &tampered.sig[..127]);
        }
        assert!(open_at(PHRASE, 1, &tampered).is_none(), "bad signature");
        assert!(wrap(PHRASE, 0, "00", "bramble.multisig", "x", 1).is_err());
        assert!(wrap(PHRASE, 0, &recipient, "bramble.multisig", "", 1).is_err());
    }
}
