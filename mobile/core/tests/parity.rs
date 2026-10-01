//! The mobile core must reproduce the extension bit-for-bit. `tests/fixtures/extension-parity.json`
//! is written by `bun run mobile:parity` from the extension's real Krusty WASM path, and
//! `tests/conformance/mobile-parity.test.ts` keeps it in step with the extension.

mod common;

use bramble_core::{AccountFamily, NetworkId, RecoverySelection};
use serde_json::Value;

fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/extension-parity.json")).unwrap()
}

fn network(id: &str) -> NetworkId {
    match id {
        "SN_MAIN" => NetworkId::Mainnet,
        "SN_SEPOLIA" => NetworkId::Sepolia,
        other => panic!("unexpected network {other}"),
    }
}

#[test]
fn accounts_and_signatures_match_the_extension() {
    let fixture = fixture();
    let dir = tempfile::tempdir().unwrap();
    let core = common::open(dir.path(), &common::FakeClock::new());
    core.import_wallet(
        "parity password".into(),
        fixture["mnemonic"].as_str().unwrap().into(),
        None,
    )
    .unwrap();
    let oz = |account_index| RecoverySelection {
        family: AccountFamily::OpenZeppelin,
        account_index,
        class_hash: None,
    };
    let restored = core
        .restore_recovered_accounts(NetworkId::Sepolia, vec![oz(0), oz(1)])
        .unwrap();
    // Switching to Mainnet projects the active (first) account there.
    core.select_account(restored[0].id.clone()).unwrap();
    core.ensure_network_account(NetworkId::Mainnet).unwrap();

    for vector in fixture["accounts"].as_array().unwrap() {
        let index = u32::try_from(vector["accountIndex"].as_u64().unwrap()).unwrap();
        let net = network(vector["networkId"].as_str().unwrap());
        let records = core.account_records(net).unwrap();
        let account = records.iter().find(|a| a.account_index == index).unwrap();
        assert_eq!(
            account.address,
            vector["address"].as_str().unwrap(),
            "address {index} {net:?}"
        );
        assert_eq!(account.class_hash, vector["classHash"].as_str().unwrap());
        assert_eq!(account.public_key, vector["publicKeyX"].as_str().unwrap());

        let signature = core
            .sign_hash_for_account(
                account.id.clone(),
                fixture["messageHash"].as_str().unwrap().into(),
            )
            .unwrap();
        assert_eq!(signature.public_key, vector["publicKeyX"].as_str().unwrap());
        assert_eq!(signature.r, vector["signatureR"].as_str().unwrap());
        assert_eq!(signature.s, vector["signatureS"].as_str().unwrap());
    }
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
