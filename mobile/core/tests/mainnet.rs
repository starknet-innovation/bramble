//! Opt-in checks against a real mainnet wallet. Never run by default or in CI, and the phrase is
//! read from the environment only; it must never be committed or printed. Run:
//!
//!   BRAMBLE_MOBILE_MAINNET_MNEMONIC="…" BRAMBLE_MOBILE_MAINNET_ADDRESS=0x… \
//!     cargo test --locked --test mainnet -- --ignored
//!
//! Add `BRAMBLE_MOBILE_MAINNET_DISCOVERY=1` to also run account discovery against the bundled
//! Mainnet RPC endpoints (read-only: `starknet_chainId`, `starknet_getClassHashAt`, and ERC-20
//! `balanceOf`; nothing is signed or sent). The HTTP helper shells out to `curl` and exists only in
//! this test, so the core stays sans-IO.

mod common;

use std::process::Command;

use bramble_core::{
    rpc_chain_id_request, rpc_verify_chain_id, supported_networks, AccountFamily, NetworkId,
    RecoverySelection, RpcResponse, WalletCore,
};

fn refuse_ci() {
    for marker in [
        "CI",
        "GITHUB_ACTIONS",
        "TEST_RUNNER_CI",
        "TEST_RUNNER_GITHUB_ACTIONS",
    ] {
        assert!(
            std::env::var_os(marker).is_none(),
            "the mainnet wallet check never runs in CI ({marker} is set)"
        );
    }
}

fn imported() -> (tempfile::TempDir, std::sync::Arc<WalletCore>) {
    let phrase =
        std::env::var("BRAMBLE_MOBILE_MAINNET_MNEMONIC").expect("BRAMBLE_MOBILE_MAINNET_MNEMONIC");
    let dir = tempfile::tempdir().unwrap();
    let core = common::open(dir.path(), &common::FakeClock::new());
    core.import_wallet("mainnet check password".into(), phrase, None)
        .unwrap();
    (dir, core)
}

// Compare numerically: the configured address may carry leading zeros.
fn canonical(value: &str) -> String {
    value
        .trim_start_matches("0x")
        .trim_start_matches('0')
        .to_lowercase()
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

fn post(url: &str, body: &str) -> String {
    let output = Command::new("curl")
        .args(["-sS", "--max-time", "20", "-X", "POST"])
        .args([
            "-H",
            "content-type: application/json",
            "--data-binary",
            body,
            url,
        ])
        .output()
        .expect("curl runs");
    assert!(output.status.success(), "request failed");
    String::from_utf8(output.stdout).expect("response is UTF-8")
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
    let network = supported_networks()
        .into_iter()
        .find(|info| info.network == NetworkId::Mainnet)
        .unwrap();
    let url = network
        .rpc_urls
        .iter()
        .find(|url| {
            rpc_verify_chain_id(post(url, &rpc_chain_id_request(1)), 1, NetworkId::Mainnet)
                .unwrap_or(false)
        })
        .expect("a bundled endpoint proves Mainnet")
        .clone();
    let (_dir, core) = imported();
    let mut step = core.recovery_scan_next(NetworkId::Mainnet, None).unwrap();
    while !step.complete {
        while !step.requests.is_empty() {
            let responses = step
                .requests
                .iter()
                .map(|request| RpcResponse {
                    id: request.id,
                    body: post(&url, &request.body),
                })
                .collect();
            step = core.recovery_scan_submit(responses).unwrap();
        }
        if !step.complete {
            step = core.recovery_scan_next(NetworkId::Mainnet, None).unwrap();
        }
    }
    assert!(
        step.candidates
            .iter()
            .any(|candidate| canonical(&candidate.address) == canonical(&expected)),
        "discovery lists the configured account"
    );
}
