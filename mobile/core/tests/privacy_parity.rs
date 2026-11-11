//! Mobile's own privacy paths against the extension's, from `extension-privacy-wire.json`
//! (written by `bun run mobile:parity` from the extension's own code): viewing keys derived through
//! mobile's KMS glue, and the routing loader. The plan's bodies, every judged reply and every gate
//! are wallet-core's parity suites now (`crates/bramble-core/tests/privacy_parity.rs`,
//! `privacy_gates_parity.rs`), run over the same fixtures.

mod privacy_support;

use bramble_core::testing::{privacy as hooks, strk20_viewing_key, strk20_viewing_public_key};
use bramble_core::{Ladder, NetworkId};
use privacy_support::{wire, PHRASE};
use serde_json::Value;
use wallet_core::{derive_strk20_viewing_key, Felt, SecretFelt};

fn text(value: &Value) -> &str {
    value.as_str().unwrap()
}

#[test]
fn viewing_keys_match_the_extension_krusty_path() {
    let wire = wire();
    let keys = &wire["viewingKeys"];
    let (chain, pool) = (text(&keys["chainId"]), text(&keys["pool"]));
    for account in keys["accounts"].as_array().unwrap() {
        let index = account["accountIndex"].as_u64().unwrap() as u32;
        let derived = strk20_viewing_key(PHRASE, index, chain, pool).unwrap();
        assert_eq!(derived, text(&account["viewingKey"]), "account {index}");
        let (public, scoped_pool) =
            strk20_viewing_public_key(PHRASE, Ladder::Account, index, NetworkId::Mainnet).unwrap();
        assert_eq!(scoped_pool, pool, "account {index}");
        assert_eq!(
            public,
            text(&account["viewingPublicKey"]),
            "account {index}"
        );
    }
    // Krusty's own vectors, through wallet-core's wrapper (mobile never names Krusty).
    for vector in keys["crate"].as_array().unwrap() {
        let private_key = SecretFelt::new(Felt::from_hex(text(&vector["privateKey"])).unwrap());
        let key = derive_strk20_viewing_key(
            &private_key,
            text(&vector["chainId"]),
            text(&vector["pool"]),
        )
        .unwrap();
        assert_eq!(
            key.expose_secret_hex().as_str(),
            text(&vector["viewingKey"])
        );
    }
    for refusal in keys["refusals"].as_array().unwrap() {
        assert!(refusal["refused"].as_bool().unwrap());
        assert!(strk20_viewing_key(PHRASE, 0, chain, text(&refusal["pool"])).is_err());
    }
}

#[test]
fn routing_matches_and_ohttp_is_never_routed() {
    let wire = wire();
    let routing = &wire["routing"];
    assert_eq!(
        text(&routing["bundled"]),
        include_str!("../generated/privacy.json")
    );
    assert_eq!(
        hooks::routed_networks(text(&routing["bundled"])),
        Some(vec![NetworkId::Mainnet])
    );
    for variant in ["ohttpEnabled", "ohttpRelay"] {
        assert_eq!(
            hooks::routed_networks(text(&routing[variant])),
            Some(vec![]),
            "{variant}"
        );
        assert!(
            !text(&routing[variant]).contains("discoveryUrl"),
            "{variant}"
        );
    }
    assert!(!bramble_core::privacy_configured(NetworkId::Sepolia));
}
