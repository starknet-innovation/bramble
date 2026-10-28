//! Opt-in, read-only private-balance read against a real mainnet wallet and the live privacy
//! service. Never runs by default (`#[ignore]`) and refuses to run under CI. The phrase is read
//! from the environment only and must never be committed. It sends that wallet's scoped viewing
//! key to the discovery service inside the core-built body, exactly as the extension does, so it
//! also needs the acknowledgement the iOS `MainnetPrivacyTests` asks for. Nothing is signed or
//! broadcast. Run:
//!
//!   BRAMBLE_MOBILE_PRIVACY_LIVE_ACK="I understand this sends my viewing key to the privacy service" \
//!   BRAMBLE_MOBILE_MAINNET_MNEMONIC="…" BRAMBLE_MOBILE_MAINNET_ADDRESS=0x… \
//!     cargo test --locked --test privacy_mainnet -- --ignored --nocapture
//!
//! `BRAMBLE_MOBILE_PRIVACY_DISCOVERY_URL` points discovery at another service (mobile/README.md).
//!
//! The core has no HTTP client, so this test moves the bytes with the system `curl`: HTTPS only,
//! no redirects, the body on stdin (never on the command line). It prints public results only:
//! registration, per-token totals, the pool fee, each page's `block_ref`, and latencies.

mod privacy_support;

use std::io::Write;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use bramble_core::{
    deployment_status_request, judge_deployment_status, max_privacy_response_bytes,
    privacy_discovery_url, rpc_verify_chain_id, set_privacy_discovery_override, supported_networks,
    NetworkId, PrivacyPurpose, PrivacyReply, PrivacyStep, WalletCore,
};
use zeroize::Zeroize;

const ACK: &str = "I understand this sends my viewing key to the privacy service";
const CI_MARKERS: [&str; 4] = [
    "CI",
    "GITHUB_ACTIONS",
    "TEST_RUNNER_CI",
    "TEST_RUNNER_GITHUB_ACTIONS",
];

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as u64)
}

/// POSTs `body` over HTTPS with curl; `(status, reply)` or `None` on a transport failure.
fn post(url: &str, body: &[u8], limit: u64) -> Option<(u16, Vec<u8>)> {
    let mut child = Command::new("curl")
        .args([
            "-sS",
            "--proto",
            "=https",
            "--max-redirs",
            "0",
            "--max-time",
            "60",
        ])
        .args(["--max-filesize", &limit.to_string()])
        .args([
            "-H",
            "Content-Type: application/json",
            "--data-binary",
            "@-",
        ])
        .args(["-w", "\n%{http_code}", url])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    child.stdin.take()?.write_all(body).ok()?;
    let output = child.wait_with_output().ok()?;
    if !output.status.success() {
        return None;
    }
    let split = output.stdout.iter().rposition(|b| *b == b'\n')?;
    let status = std::str::from_utf8(&output.stdout[split + 1..])
        .ok()?
        .parse()
        .ok()?;
    let reply = output.stdout[..split].to_vec();
    (reply.len() as u64 <= limit).then_some((status, reply))
}

fn rpc(url: &str, body: &str) -> Option<String> {
    let (status, reply) = post(url, body.as_bytes(), 8 * 1024 * 1024)?;
    (status == 200).then(|| String::from_utf8(reply).ok())?
}

#[test]
#[ignore = "needs BRAMBLE_MOBILE_PRIVACY_LIVE_ACK, BRAMBLE_MOBILE_MAINNET_MNEMONIC and _ADDRESS"]
fn reads_private_balances_on_mainnet() {
    for marker in CI_MARKERS {
        assert!(
            std::env::var_os(marker).is_none(),
            "the live privacy read never runs in CI ({marker} is set)"
        );
    }
    assert_eq!(
        std::env::var("BRAMBLE_MOBILE_PRIVACY_LIVE_ACK").as_deref(),
        Ok(ACK),
        "set BRAMBLE_MOBILE_PRIVACY_LIVE_ACK to opt in"
    );
    let phrase =
        std::env::var("BRAMBLE_MOBILE_MAINNET_MNEMONIC").expect("BRAMBLE_MOBILE_MAINNET_MNEMONIC");
    let expected =
        std::env::var("BRAMBLE_MOBILE_MAINNET_ADDRESS").expect("BRAMBLE_MOBILE_MAINNET_ADDRESS");
    if let Ok(url) = std::env::var("BRAMBLE_MOBILE_PRIVACY_DISCOVERY_URL") {
        set_privacy_discovery_override(NetworkId::Mainnet, Some(url))
            .expect("BRAMBLE_MOBILE_PRIVACY_DISCOVERY_URL refused by the core's URL rules");
    }
    let discovery = privacy_discovery_url(NetworkId::Mainnet).expect("mainnet privacy is routed");
    println!("discovery service: {discovery}");

    let dir = tempfile::tempdir().unwrap();
    let core = WalletCore::new(
        dir.path().to_string_lossy().into(),
        std::sync::Arc::new(privacy_support::StillClock),
    )
    .unwrap();
    core.import_wallet("mainnet privacy password".into(), phrase, None)
        .unwrap();
    let account = core
        .restore_recovered_accounts(
            NetworkId::Mainnet,
            vec![bramble_core::RecoverySelection {
                family: bramble_core::AccountFamily::OpenZeppelin,
                account_index: 0,
                ladder: None,
                class_hash: None,
            }],
        )
        .unwrap()[0]
        .clone();
    let canonical = |value: &str| {
        value
            .trim_start_matches("0x")
            .trim_start_matches('0')
            .to_lowercase()
    };
    assert_eq!(canonical(&account.address), canonical(&expected));

    let network = supported_networks()
        .into_iter()
        .find(|info| info.network == NetworkId::Mainnet)
        .unwrap();
    // The first RPC endpoint that proves the chain, as the iOS driver picks it.
    let endpoint = network
        .rpc_urls
        .iter()
        .find(|url| {
            let body = bramble_core::rpc_chain_id_request(1);
            rpc(url, &body).is_some_and(|reply| {
                matches!(rpc_verify_chain_id(reply, 1, NetworkId::Mainnet), Ok(true))
            })
        })
        .expect("a mainnet RPC endpoint proves SN_MAIN")
        .clone();
    let deployment_body = deployment_status_request(1, account.address.clone()).unwrap();
    let deployment =
        rpc(&endpoint, &deployment_body).map(|reply| judge_deployment_status(reply, 1));
    println!("account deployment: {deployment:?}");

    let plan = core
        .clone()
        .prepare_privacy_read(account.id.clone())
        .expect("a read plan for account 0");
    let limit = max_privacy_response_bytes();
    let started = Instant::now();
    let mut block_refs = Vec::new();
    let mut reply = PrivacyReply::Start { now_ms: now_ms() };
    let state = loop {
        match plan.advance(reply).expect("the plan accepts each reply") {
            PrivacyStep::Post {
                id,
                url,
                mut body,
                purpose,
            } => {
                let sent = Instant::now();
                let answer = post(&url, &body, limit);
                body.zeroize();
                println!("{purpose:?}: {} ms", sent.elapsed().as_millis());
                reply = match answer {
                    Some((status, reply)) => {
                        if purpose == PrivacyPurpose::IncomingState && status == 200 {
                            let page: serde_json::Value =
                                serde_json::from_slice(&reply).unwrap_or_default();
                            block_refs.push(page["block_ref"].to_string());
                        } else if status != 200 {
                            println!("{purpose:?}: HTTP {status}");
                        }
                        PrivacyReply::Http {
                            id,
                            status,
                            body: reply,
                            now_ms: now_ms(),
                        }
                    }
                    None => PrivacyReply::TransportFailure {
                        id,
                        now_ms: now_ms(),
                    },
                };
            }
            PrivacyStep::Rpc { id, body, purpose } => {
                let sent = Instant::now();
                let answer = rpc(&endpoint, &body);
                println!("{purpose:?}: {} ms", sent.elapsed().as_millis());
                reply = match answer {
                    Some(body) => PrivacyReply::Rpc {
                        id,
                        body,
                        now_ms: now_ms(),
                    },
                    None => PrivacyReply::TransportFailure {
                        id,
                        now_ms: now_ms(),
                    },
                };
            }
            PrivacyStep::Wait { delay_ms } => {
                println!("service asked to retry; waiting {delay_ms} ms");
                std::thread::sleep(Duration::from_millis(delay_ms.into()));
                reply = PrivacyReply::WaitElapsed { now_ms: now_ms() };
            }
            PrivacyStep::Finished { state } => break state,
            PrivacyStep::Failed { failure } => panic!("the read failed: {failure:?}"),
        }
    };
    println!("read total: {} ms", started.elapsed().as_millis());
    println!("registration: {:?}", state.registration);
    for balance in &state.balances {
        println!(
            "private {}: {} ({} base units)",
            balance.symbol, balance.formatted, balance.balance
        );
    }
    println!("pool fee: {} fri", state.pool_fee_fri);
    println!(
        "discovery pages: {}, block_ref per page: {block_refs:?}",
        block_refs.len()
    );
    assert!(
        block_refs.windows(2).all(|pair| pair[0] == pair[1]),
        "every page answered from the same block"
    );
}
