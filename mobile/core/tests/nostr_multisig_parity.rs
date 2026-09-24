//! Nostr and multisig parity with the extension (`docs/nostr-multisig.md` §6.2).
//! `tests/fixtures/nostr-multisig-parity.json` is written by `bun run mobile:parity` through the
//! extension's own modules and re-checked by `tests/conformance/mobile-nostr-parity.test.ts`.
//! `tests/fixtures/rust-gift-wrap.json` goes the other way: this suite writes it when
//! `BRAMBLE_WRITE_FIXTURES=1`, and the extension must open it.

use bramble_core::testing::{nostr_public_key_at, open_gift_wrap, wrap_gift};
use bramble_core::{
    argent_multisig_normalize, argent_multisig_predict, argent_signer_guid,
    nostr_relay_url_normalize, wallet_contact_card_parse, ArgentMultisigConfig, ContactCardParse,
    MultisigAuthorityRead, MultisigAuthorityStatus, NetworkId, WalletCore,
};
use serde_json::{json, Value};

const RUST_WRAP: &str = "tests/fixtures/rust-gift-wrap.json";

fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/nostr-multisig-parity.json")).unwrap()
}

fn text(value: &Value) -> String {
    value.as_str().unwrap().to_string()
}

fn strings(value: &Value) -> Vec<String> {
    value.as_array().unwrap().iter().map(text).collect()
}

fn wallet(mnemonic: &str) -> (tempfile::TempDir, std::sync::Arc<WalletCore>) {
    let dir = tempfile::tempdir().unwrap();
    let core = WalletCore::new(dir.path().to_string_lossy().into()).unwrap();
    core.import_wallet("parity password".into(), mnemonic.into(), None)
        .unwrap();
    (dir, core)
}

#[test]
fn coordination_keys_match_the_extension() {
    for vector in fixture()["nostrKeys"].as_array().unwrap() {
        let mnemonic = vector["mnemonic"].as_str().unwrap();
        let index = vector["index"].as_u64().unwrap() as u32;
        assert_eq!(
            nostr_public_key_at(mnemonic, index).unwrap(),
            text(&vector["publicKey"])
        );
        if index == 0 {
            let (_dir, core) = wallet(mnemonic);
            assert_eq!(core.nostr_public_key().unwrap(), text(&vector["publicKey"]));
        }
    }
}

#[test]
fn opens_the_extension_gift_wrap_and_refuses_its_variants() {
    let fixture = fixture();
    let wrap = &fixture["giftWrap"];
    let parity = fixture["nostrKeys"][0]["mnemonic"].as_str().unwrap();
    let recipient = wrap["recipientNostrIndex"].as_u64().unwrap() as u32;
    let sender = text(&fixture["nostrKeys"][0]["publicKey"]);
    let (content, identifier, from) =
        open_gift_wrap(parity, recipient, wrap["eventJson"].as_str().unwrap()).unwrap();
    assert_eq!(
        (content, identifier, from),
        (text(&wrap["content"]), text(&wrap["identifier"]), sender)
    );
    assert!(
        open_gift_wrap(parity, 0, wrap["eventJson"].as_str().unwrap()).is_none(),
        "wrong recipient"
    );
    for rejection in wrap["rejections"].as_array().unwrap() {
        assert!(
            open_gift_wrap(parity, recipient, rejection["eventJson"].as_str().unwrap()).is_none(),
            "{}",
            rejection["name"]
        );
    }
}

#[test]
fn rust_gift_wraps_round_trip_and_the_committed_one_still_opens() {
    let fixture = fixture();
    let parity = fixture["nostrKeys"][0]["mnemonic"].as_str().unwrap();
    let cosigner = fixture["nostrKeys"][1]["index"].as_u64().unwrap() as u32;
    let recipient = text(&fixture["nostrKeys"][1]["publicKey"]);
    let content = text(&fixture["giftWrap"]["content"]);
    let fresh = wrap_gift(
        parity,
        0,
        &recipient,
        "bramble.multisig",
        &content,
        1_750_000_000,
    )
    .unwrap();
    assert_eq!(open_gift_wrap(parity, cosigner, &fresh).unwrap().0, content);
    if std::env::var("BRAMBLE_WRITE_FIXTURES").as_deref() == Ok("1") {
        let body = json!({"content": content, "eventJson": fresh, "identifier": "bramble.multisig",
                          "recipientNostrIndex": cosigner, "senderPublicKey": text(&fixture["nostrKeys"][0]["publicKey"])});
        std::fs::write(
            RUST_WRAP,
            format!("{}\n", serde_json::to_string_pretty(&body).unwrap()),
        )
        .unwrap();
    }
    let committed: Value =
        serde_json::from_str(&std::fs::read_to_string(RUST_WRAP).unwrap()).unwrap();
    let (opened, _, sender) =
        open_gift_wrap(parity, cosigner, committed["eventJson"].as_str().unwrap()).unwrap();
    assert_eq!(opened, text(&committed["content"]));
    assert_eq!(sender, text(&committed["senderPublicKey"]));
}

#[test]
fn argent_multisig_layout_matches_the_extension() {
    let argent = &fixture()["argent"];
    for vector in argent["guids"].as_array().unwrap() {
        assert_eq!(
            argent_signer_guid(text(&vector["publicKey"])).unwrap(),
            text(&vector["guid"])
        );
    }
    for vector in argent["configs"].as_array().unwrap() {
        let config = ArgentMultisigConfig {
            threshold: u32::try_from(vector["threshold"].as_u64().unwrap()).unwrap(),
            signer_public_keys: strings(&vector["signerPublicKeys"]),
        };
        assert_eq!(
            argent_multisig_normalize(config.clone())
                .unwrap()
                .signer_public_keys,
            strings(&vector["normalized"])
        );
        let prediction = argent_multisig_predict(config, text(&vector["salt"])).unwrap();
        assert_eq!(
            prediction.constructor_calldata,
            strings(&vector["calldata"])
        );
        assert_eq!(prediction.address, text(&vector["address"]));
    }
    for vector in argent["rejected"].as_array().unwrap() {
        let config = ArgentMultisigConfig {
            threshold: u32::try_from(vector["threshold"].as_u64().unwrap()).unwrap(),
            signer_public_keys: strings(&vector["signerPublicKeys"]),
        };
        assert!(argent_multisig_normalize(config).is_err(), "{vector}");
    }
}

#[test]
fn wallet_cards_parse_like_the_extension() {
    for vector in fixture()["cards"].as_array().unwrap() {
        let parsed = wallet_contact_card_parse(text(&vector["input"]), NetworkId::Mainnet);
        let expected = &vector["parsed"];
        match (expected.is_null(), &parsed) {
            (true, ContactCardParse::Unrecognized) => {}
            (false, ContactCardParse::OtherNetwork) => assert_ne!(expected["networkId"], "SN_MAIN"),
            (false, ContactCardParse::Valid { card }) => {
                assert_eq!(expected["networkId"], "SN_MAIN");
                assert_eq!(card.address, text(&expected["address"]));
                assert_eq!(
                    card.public_key_x.as_deref(),
                    expected["publicKeyX"].as_str()
                );
                assert_eq!(
                    card.nostr_public_key.as_deref(),
                    expected["nostrPublicKey"].as_str()
                );
            }
            _ => panic!("{} parsed as {parsed:?}", vector["input"]),
        }
    }
}

#[test]
fn relay_urls_match_the_extension_except_where_mobile_is_stricter() {
    for vector in fixture()["relayUrls"].as_array().unwrap() {
        let mobile = match nostr_relay_url_normalize(text(&vector["value"])) {
            Ok(None) => "defaults",
            Ok(Some(_)) => "valid",
            Err(_) => "invalid",
        };
        if vector.get("mobileDiffers").is_some() {
            assert_eq!(mobile, "invalid", "{vector}");
        } else {
            assert_eq!(mobile, vector["extension"], "{vector}");
        }
    }
}

fn respond(read: &MultisigAuthorityRead, result: Value) {
    let request = read.next_request().unwrap();
    let body = json!({"jsonrpc": "2.0", "id": request.id, "result": result}).to_string();
    read.accept_response(request.id, body).unwrap();
}

#[test]
fn joined_records_are_what_the_extension_stores() {
    let fixture = fixture();
    for vector in fixture["joins"].as_array().unwrap() {
        let (dir, core) = wallet(fixture["nostrKeys"][0]["mnemonic"].as_str().unwrap());
        core.add_account(NetworkId::Sepolia).unwrap();
        let read =
            MultisigAuthorityRead::new(NetworkId::Sepolia, text(&vector["address"])).unwrap();
        respond(&read, json!("0x534e5f5345504f4c4941"));
        respond(&read, json!({"block_hash": "0x1", "block_number": 1}));
        respond(&read, fixture["classHash"].clone());
        respond(
            &read,
            json!([format!("0x{:x}", vector["threshold"].as_u64().unwrap())]),
        );
        let mut guids = vec![json!(format!(
            "0x{:x}",
            vector["signerGuids"].as_array().unwrap().len()
        ))];
        guids.extend(
            vector["signerGuids"]
                .as_array()
                .unwrap()
                .iter()
                .rev()
                .cloned(),
        );
        respond(&read, Value::Array(guids));
        assert_eq!(read.status(), Some(MultisigAuthorityStatus::Available));
        core.add_multisig(read).unwrap();
        let stored: Value = serde_json::from_str(
            &std::fs::read_to_string(dir.path().join("multisigs.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(stored["records"][0], vector["record"]);
    }
}
