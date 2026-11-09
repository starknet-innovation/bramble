//! The mobile core must reproduce the extension bit-for-bit. `tests/fixtures/extension-parity.json`
//! is written by `bun run mobile:parity` from the extension's real Krusty WASM path, and
//! `tests/conformance/mobile-parity.test.ts` keeps it in step with the extension.

mod common;

use serde_json::Value;

fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/extension-parity.json")).unwrap()
}

#[test]
fn opens_an_envelope_the_extension_sealed() {
    let fixture = fixture();
    let envelope = &fixture["envelope"];
    let sealed = envelope["sealed"].to_string();
    let opened = bramble_core::testing::open_envelope(
        &sealed,
        envelope["password"].as_str().unwrap(),
        envelope["scope"].as_str().unwrap(),
    )
    .unwrap();
    let plaintext: Value = serde_json::from_slice(&opened).unwrap();
    assert_eq!(plaintext, envelope["plaintext"]);

    assert!(
        bramble_core::testing::open_envelope(&sealed, "not the password", "bramble.parity")
            .is_err()
    );
    assert!(bramble_core::testing::open_envelope(
        &sealed,
        envelope["password"].as_str().unwrap(),
        "other"
    )
    .is_err());
}

#[test]
fn opens_a_dek_slot_the_extension_sealed() {
    use base64::Engine;
    let fixture = fixture();
    let slot = &fixture["dekSlot"];
    assert_eq!(slot["scope"], "bramble.mobile.dek.v1");
    let sealed = slot["sealed"].to_string();
    let dek =
        bramble_core::testing::open_password_slot(&sealed, slot["password"].as_str().unwrap())
            .unwrap();
    let expected = base64::engine::general_purpose::STANDARD
        .decode(slot["plaintext"]["dek"].as_str().unwrap())
        .unwrap();
    assert_eq!(dek, expected);
    assert!(matches!(
        bramble_core::testing::open_password_slot(&sealed, "not the password"),
        Err(bramble_core::CoreError::WrongPassword)
    ));
}
