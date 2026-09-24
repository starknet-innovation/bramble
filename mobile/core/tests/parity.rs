//! The mobile core must reproduce the extension bit-for-bit. `tests/fixtures/extension-parity.json`
//! is written by `bun run mobile:parity` from the extension's real Krusty WASM path, and
//! `tests/conformance/mobile-parity.test.ts` keeps it in step with the extension.

use bramble_core::{NetworkId, WalletCore};
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
    let core = WalletCore::new(dir.path().to_string_lossy().into()).unwrap();
    core.import_wallet(
        "parity password".into(),
        fixture["mnemonic"].as_str().unwrap().into(),
        None,
    )
    .unwrap();
    core.add_account(NetworkId::Sepolia).unwrap();

    for vector in fixture["accounts"].as_array().unwrap() {
        let index = u32::try_from(vector["accountIndex"].as_u64().unwrap()).unwrap();
        let net = network(vector["networkId"].as_str().unwrap());
        let account = &core.accounts(net).unwrap()[index as usize];
        assert_eq!(
            account.address,
            vector["address"].as_str().unwrap(),
            "address {index} {net:?}"
        );
        assert_eq!(account.class_hash, vector["classHash"].as_str().unwrap());
        assert_eq!(account.public_key, vector["publicKeyX"].as_str().unwrap());

        let signature = core
            .sign_hash(index, fixture["messageHash"].as_str().unwrap().into())
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
