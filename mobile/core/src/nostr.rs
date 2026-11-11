//! Nostr coordination identity and NIP-59 application data, from `wallet_core::nostr`, which
//! mirrors the extension's `vault/service/nostr.ts`, `wallet-model/nostr` and the Krusty adapter
//! (`kms-krusty/adapter.ts`): the event grammar, the resource bounds, and the checks on both sides
//! of every Krusty call.
//!
//! What stays here is Bramble's choice of key. The coordination key is `m/44'/1237'/0'/0/0` of the
//! recovery phrase **without** the BIP-39 passphrase, exactly as the extension derives it, so
//! co-signers reach the same identity from either wallet. The private key is derived per call
//! inside the shared core and never cached, persisted, logged, or returned.

use crate::CoreError;

pub use wallet_core::kms::utf16_length;
#[cfg(any(test, feature = "testing"))]
pub use wallet_core::nostr::parse_event_json;
pub use wallet_core::nostr::{
    is_public_key, safe_non_negative_integer, NostrApplicationData, NostrEvent,
};

/// The wallet's coordination public key: x-only, 64 lowercase hex characters.
pub fn public_key(mnemonic: &str) -> Result<String, CoreError> {
    public_key_at(mnemonic, 0)
}

/// [`public_key`] at Nostr address `index` (the wallet uses 0; tests use 1 as a second identity).
pub fn public_key_at(mnemonic: &str, index: u32) -> Result<String, CoreError> {
    Ok(wallet_core::derive_nostr_public_key(
        mnemonic, index, 0, None,
    )?)
}

/// Opens one gift wrap addressed to this wallet. Any failure, from the event grammar to Krusty's
/// signature and rumor checks to the output bounds, yields `None`: a relay event is untrusted.
pub fn open(mnemonic: &str, event: &NostrEvent) -> Option<NostrApplicationData> {
    open_at(mnemonic, 0, event)
}

/// [`open`] with the coordination key at Nostr address `index`.
pub fn open_at(mnemonic: &str, index: u32, event: &NostrEvent) -> Option<NostrApplicationData> {
    wallet_core::open_nostr_event(mnemonic, index, 0, event, None).ok()
}

/// Wraps application data for one recipient at the host's clock (`now`, Unix seconds).
/// `index` is the sender's Nostr address (the wallet uses 0). Today only the test hooks call it;
/// intent sharing, which is deferred (docs/nostr-multisig.md §1), will; compiled for them only.
#[cfg(any(test, feature = "testing"))]
pub fn wrap(
    mnemonic: &str,
    index: u32,
    recipient: &str,
    identifier: &str,
    content: &str,
    now: u64,
) -> Result<String, CoreError> {
    Ok(wallet_core::wrap_nostr_application_data(
        mnemonic, index, 0, recipient, identifier, content, now, None,
    )?)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PHRASE: &str =
        "habit hope tip crystal because grunt nation idea electric witness alert like";

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
