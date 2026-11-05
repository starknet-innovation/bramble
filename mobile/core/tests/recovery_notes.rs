//! The scan's advisory notes end to end (issue 542 and the privacy-pool note): deployed rows read
//! their signer state and the pool's registered key, and word them as the extension's picker.

mod common;

use bramble_core::testing;
use bramble_core::{account_classes, Ladder, NetworkId};
use common::{pending, view_key, Node, PHRASE};

const GET_OWNER: &str = "0x3ee0bfaf5b124501fef19bbd1312e71f6966d186c42eeb91d1bff729b91d1d4";
const GET_OWNER_TYPE: &str = "0xae4c53adcf230c976273bd2a636233f06e97b1d4a68208d3d10a80d2f8a0a4";
const GET_GUARDIAN: &str = "0x24fd89f2d8a7798e705aa5361f39154ca43e03721c05188285138f16018955d";
const GET_SIGNERS: &str = "0x2b8faca80de28f81027b46c4f3cb534c44616e721ae9f1e96539c6b54a1d932";
const GET_DEFERRED_REMOVE_SIGNERS: &str =
    "0x3f4c3fd98c1f85cfe943da13a3e1970248bf364130b9590071520aa2ec61e93";
const GET_PUBLIC_KEY: &str = "0x1a35984e05126dbecb7c3bb9929e7dd9106d460c59b1633739a5c733a5fb13b";

fn view(node: &mut Node, contract: &str, selector: &str, argument: Option<&str>, result: &[&str]) {
    node.views.insert(
        view_key(contract, selector, argument),
        result.iter().map(|felt| felt.to_string()).collect(),
    );
}

#[test]
fn deployed_rows_carry_the_extensions_advisory_notes() {
    let network = NetworkId::Mainnet;
    let (_dir, _clock, core) = pending();
    let (_probe_dir, _probe_clock, probe) = pending();
    let first = probe.recovery_scan_next(network, None).unwrap();
    let address_of = |position: usize| {
        let body: serde_json::Value = serde_json::from_str(&first.requests[position].body).unwrap();
        body["params"]["contract_address"]
            .as_str()
            .unwrap()
            .to_string()
    };
    // Index 0: OZ (0), …, Argent 0.4.0 on Ready's ladder (7), Braavos 1.0.0 (8); OZ at index 1.
    let (oz, ready, braavos, oz_one) =
        (address_of(0), address_of(7), address_of(8), address_of(10));
    let (own_view, pool) =
        testing::strk20_viewing_public_key(PHRASE, Ladder::Account, 0, network).expect("a pool");
    let ready_key = testing::ladder_public_key(PHRASE, Ladder::ArgentX, 0).unwrap();
    let braavos_key = testing::ladder_public_key(PHRASE, Ladder::Address, 0).unwrap();
    let argent_040 = account_classes()
        .into_iter()
        .find(|class| class.label == "argent 0.4.0")
        .unwrap()
        .class_hash;

    let mut node = Node {
        block_time: 100,
        ..Node::default()
    };
    for address in [&oz, &ready, &braavos, &oz_one] {
        node.deployed.insert(address.clone());
    }
    node.classes.insert(ready.clone(), argent_040);
    node.classes
        .insert(braavos.clone(), testing::braavos_implementation_class());
    // Ready: this wallet's owner, a guardian, and another wallet's key in the pool.
    view(&mut node, &ready, GET_OWNER, None, &[&ready_key]);
    view(&mut node, &ready, GET_OWNER_TYPE, None, &["0x0"]);
    view(&mut node, &ready, GET_GUARDIAN, None, &["0x9"]);
    view(&mut node, &pool, GET_PUBLIC_KEY, Some(&ready), &["0x123"]);
    // Braavos: a 2FA signer whose removal expires at the block's own timestamp, so not yet.
    view(
        &mut node,
        &braavos,
        GET_SIGNERS,
        None,
        &["0x1", &braavos_key, "0x1", "0x9", "0x0"],
    );
    view(
        &mut node,
        &braavos,
        GET_DEFERRED_REMOVE_SIGNERS,
        None,
        &["0x64"],
    );
    // OZ: this wallet's own registration, then another wallet's.
    view(&mut node, &pool, GET_PUBLIC_KEY, Some(&oz), &[&own_view]);
    view(&mut node, &pool, GET_PUBLIC_KEY, Some(&oz_one), &["0x456"]);

    let step = node.run_scan(&core, network);
    let row = |address: &str| {
        step.candidates
            .iter()
            .find(|candidate| candidate.address == address)
            .expect("deployed rows are kept")
    };
    let ready = row(&ready);
    assert_eq!(
        ready.hint,
        "Deployed on Starknet · has a guardian · view only"
    );
    assert_eq!(
        ready.note.as_deref(),
        Some("Private balances off · privacy previously set up in Ready and cannot be imported to Bramble")
    );
    assert!(
        ready.selectable && ready.auto_select,
        "a note never blocks the import"
    );
    let braavos = row(&braavos);
    assert_eq!(
        braavos.hint,
        "Deployed on Starknet · 2FA active · view only"
    );
    assert_eq!(braavos.note, None, "an unreadable pool key is no note");
    let oz = row(&oz);
    assert_eq!(
        (oz.hint.as_str(), oz.note.as_deref()),
        ("Deployed on Starknet", None)
    );
    assert_eq!(
        row(&oz_one).note.as_deref(),
        Some("Private balances off · privacy previously set up in another wallet and cannot be imported to Bramble")
    );
}

#[test]
fn a_network_without_a_pool_reads_no_pool_key() {
    let (_dir, _clock, core) = pending();
    let (_probe_dir, _probe_clock, probe) = pending();
    let first = probe.recovery_scan_next(NetworkId::Sepolia, None).unwrap();
    let body: serde_json::Value = serde_json::from_str(&first.requests[0].body).unwrap();
    let oz = body["params"]["contract_address"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(
        testing::strk20_viewing_public_key(PHRASE, Ladder::Account, 0, NetworkId::Sepolia)
            .is_none()
    );
    let mut node = Node::default();
    node.deployed.insert(oz.clone());
    let step = core.recovery_scan_next(NetworkId::Sepolia, None).unwrap();
    let detail = core.recovery_scan_submit(node.answer_all(&step)).unwrap();
    assert!(
        !detail
            .requests
            .iter()
            .any(|request| request.body.contains(GET_PUBLIC_KEY)),
        "no pool on Sepolia, so no pool read"
    );
}
