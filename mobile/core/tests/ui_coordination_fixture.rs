//! The fixture the iOS UI suite drives coordination with (`tests/fixtures/ui-coordination.json`):
//! the co-signer's public wallet cards, the address of the 2-of-2 the suite creates (parity
//! account 0 and the co-signer, salt 0x0), and one gift wrap from the co-signer carrying a
//! package for exactly that account. `BRAMBLE_WRITE_FIXTURES=1` rewrites it; every run checks that
//! the committed wrap still opens for the parity wallet and names the predicted account.
//! The co-signer is the published E2E phrase's Starknet account 5 and Nostr address 1: a second
//! identity the UI wallet (account 0 only) never holds, with no second phrase in the repository.

mod common;

use bramble_core::testing::{nostr_public_key_at, open_gift_wrap, wrap_gift};
use bramble_core::{
    argent_multisig_predict, wallet_contact_card_encode, ArgentMultisigConfig, NetworkId,
    WalletContactCard, WalletCore,
};
use common::{oz, PHRASE as PARITY};
use serde_json::{json, Value};

/// The co-signer's Starknet account index and Nostr address index within the parity phrase.
const COSIGNER_ACCOUNT: u32 = 5;
const COSIGNER_NOSTR: u32 = 1;
const FIXTURE: &str = "tests/fixtures/ui-coordination.json";

/// The parity phrase with OpenZeppelin account `index` restored on Sepolia and active.
fn wallet(index: u32) -> (tempfile::TempDir, std::sync::Arc<WalletCore>) {
    let (dir, _clock, core) = common::pending();
    core.restore_recovered_accounts(NetworkId::Sepolia, vec![oz(index)])
        .unwrap();
    (dir, core)
}

/// The active account's card on `network` (projected there by the network switch).
fn card(core: &WalletCore, network: NetworkId) -> String {
    let account = core.ensure_network_account(network).unwrap().unwrap();
    wallet_contact_card_encode(WalletContactCard {
        network,
        address: account.address.clone(),
        public_key_x: Some(account.public_key.clone()),
        nostr_public_key: Some(nostr_public_key_at(PARITY, COSIGNER_NOSTR).unwrap()),
    })
    .unwrap()
}

#[test]
fn the_ui_coordination_fixture_opens_for_the_parity_wallet() {
    let (_a, ours) = wallet(0);
    let (_b, cosigner) = wallet(COSIGNER_ACCOUNT);
    let config = ArgentMultisigConfig {
        threshold: 2,
        signer_public_keys: vec![
            ours.accounts(NetworkId::Sepolia).unwrap()[0]
                .public_key
                .clone(),
            cosigner.accounts(NetworkId::Sepolia).unwrap()[0]
                .public_key
                .clone(),
        ],
    };
    let prediction = argent_multisig_predict(config, "0x0".into()).unwrap();
    let account_id = format!("SN_SEPOLIA:{}", prediction.address);
    if std::env::var("BRAMBLE_WRITE_FIXTURES").as_deref() == Ok("1") {
        let package = json!({
            "intent": {"accountId": account_id, "configSnapshot": {
                "classHash": prediction.class_hash, "signerGuids": prediction.signer_guids, "threshold": 2}},
            "kind": "bramble.argent-multisig-intent", "version": 1,
        })
        .to_string();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let event = wrap_gift(
            PARITY,
            COSIGNER_NOSTR,
            &ours.nostr_public_key().unwrap(),
            "bramble.multisig",
            &package,
            now,
        )
        .unwrap();
        let body = json!({
            "cosignerCardMainnet": card(&cosigner, NetworkId::Mainnet),
            "cosignerCardSepolia": card(&cosigner, NetworkId::Sepolia),
            "predictedAddress": prediction.address,
            "relayEvents": [event],
        });
        std::fs::write(
            FIXTURE,
            format!("{}\n", serde_json::to_string_pretty(&body).unwrap()),
        )
        .unwrap();
    }
    let fixture: Value = serde_json::from_str(&std::fs::read_to_string(FIXTURE).unwrap()).unwrap();
    assert_eq!(fixture["predictedAddress"], json!(prediction.address));
    assert_eq!(
        fixture["cosignerCardSepolia"],
        json!(card(&cosigner, NetworkId::Sepolia))
    );
    let event = fixture["relayEvents"][0].as_str().unwrap();
    let (content, identifier, sender) = open_gift_wrap(PARITY, 0, event).unwrap();
    assert_eq!(identifier, "bramble.multisig");
    assert_eq!(sender, nostr_public_key_at(PARITY, COSIGNER_NOSTR).unwrap());
    let package: Value = serde_json::from_str(&content).unwrap();
    assert_eq!(package["intent"]["accountId"], json!(account_id));
}
