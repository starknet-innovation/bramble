//! Opt-in checks against a real mainnet wallet. Never run by default or in CI, and the phrase is
//! read from the environment only; it must never be committed or printed. Run:
//!
//!   BRAMBLE_MOBILE_MAINNET_MNEMONIC="…" BRAMBLE_MOBILE_MAINNET_ADDRESS=0x… \
//!     cargo test --locked --test mainnet -- --ignored
//!
//! Add `BRAMBLE_MOBILE_MAINNET_DISCOVERY=1` to also run account discovery against the bundled
//! Mainnet RPC endpoints (read-only: `starknet_chainId`, `starknet_getClassHashAt`, and ERC-20
//! `balanceOf`; nothing is signed or sent) through the curl helper in `common/live.rs`.

mod common;

use bramble_core::{AccountFamily, NetworkId, RecoverySelection, WalletCore};
use common::live::{canonical, endpoint, refuse_ci, scan};

fn imported() -> (tempfile::TempDir, std::sync::Arc<WalletCore>) {
    let phrase =
        std::env::var("BRAMBLE_MOBILE_MAINNET_MNEMONIC").expect("BRAMBLE_MOBILE_MAINNET_MNEMONIC");
    let dir = tempfile::tempdir().unwrap();
    let core = common::open(dir.path(), &common::FakeClock::new());
    core.import_wallet("mainnet check password".into(), phrase, None)
        .unwrap();
    (dir, core)
}

#[test]
#[ignore = "needs BRAMBLE_MOBILE_MAINNET_MNEMONIC and BRAMBLE_MOBILE_MAINNET_ADDRESS"]
fn derives_the_configured_mainnet_account() {
    refuse_ci();
    let expected =
        std::env::var("BRAMBLE_MOBILE_MAINNET_ADDRESS").expect("BRAMBLE_MOBILE_MAINNET_ADDRESS");
    let (_dir, core) = imported();
    core.restore_recovered_accounts(
        NetworkId::Mainnet,
        vec![RecoverySelection {
            family: AccountFamily::OpenZeppelin,
            account_index: 0,
            ladder: None,
            class_hash: None,
        }],
    )
    .unwrap();
    let account = &core.accounts(NetworkId::Mainnet).unwrap()[0];
    assert_eq!(canonical(&account.address), canonical(&expected));
}

#[test]
#[ignore = "needs BRAMBLE_MOBILE_MAINNET_DISCOVERY=1 and the mainnet phrase variables"]
fn discovery_finds_the_configured_mainnet_account() {
    refuse_ci();
    if std::env::var("BRAMBLE_MOBILE_MAINNET_DISCOVERY").as_deref() != Ok("1") {
        return;
    }
    let expected =
        std::env::var("BRAMBLE_MOBILE_MAINNET_ADDRESS").expect("BRAMBLE_MOBILE_MAINNET_ADDRESS");
    let url = endpoint(NetworkId::Mainnet);
    let (_dir, core) = imported();
    let candidates = scan(&core, NetworkId::Mainnet, &url);
    assert!(
        candidates
            .iter()
            .any(|candidate| canonical(&candidate.address) == canonical(&expected)),
        "discovery lists the configured account"
    );
}
