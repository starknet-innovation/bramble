//! Opt-in check against a real mainnet wallet. Never runs by default or in CI, and the phrase is
//! read from the environment only; it must never be committed. Run:
//!
//!   BRAMBLE_MOBILE_MAINNET_MNEMONIC="…" BRAMBLE_MOBILE_MAINNET_ADDRESS=0x… \
//!     cargo test --locked --test mainnet -- --ignored

use bramble_core::{NetworkId, WalletCore};

#[test]
#[ignore = "needs BRAMBLE_MOBILE_MAINNET_MNEMONIC and BRAMBLE_MOBILE_MAINNET_ADDRESS"]
fn derives_the_configured_mainnet_account() {
    assert!(
        std::env::var_os("CI").is_none(),
        "the mainnet wallet check never runs in CI"
    );
    let phrase =
        std::env::var("BRAMBLE_MOBILE_MAINNET_MNEMONIC").expect("BRAMBLE_MOBILE_MAINNET_MNEMONIC");
    let expected =
        std::env::var("BRAMBLE_MOBILE_MAINNET_ADDRESS").expect("BRAMBLE_MOBILE_MAINNET_ADDRESS");
    let dir = tempfile::tempdir().unwrap();
    let core = WalletCore::new(dir.path().to_string_lossy().into()).unwrap();
    core.import_wallet("mainnet check password".into(), phrase, None)
        .unwrap();
    let account = &core.accounts(NetworkId::Mainnet).unwrap()[0];
    // Compare numerically: the configured address may carry leading zeros.
    let canonical = |value: &str| {
        value
            .trim_start_matches("0x")
            .trim_start_matches('0')
            .to_lowercase()
    };
    assert_eq!(canonical(&account.address), canonical(&expected));
}
