use super::*;

fn found(family: AccountFamily, class_hash: Felt, index: u32) -> Found {
    Found {
        family,
        ladder: if family == AccountFamily::Braavos {
            Ladder::Address
        } else {
            Ladder::Account
        },
        class_hash,
        account_index: index,
        address: Felt::from(99u64),
        deployed: false,
        funded: false,
        restriction: None,
        privacy_elsewhere: false,
    }
}

// Bramble's creatable rule through the core's keep rule, as the scan applies them.
fn keep(found: &Found, manual: bool) -> bool {
    let creatable = is_creatable(found.family, found.ladder, &found.class_hash);
    wallet_core::accounts::scan::keep(found, creatable, manual)
}

#[test]
fn keep_rule_matches_onboarding_ops() {
    let oz = catalog().open_zeppelin_class;
    let argent = catalog().argent_default;
    let braavos = catalog().braavos_deployment;
    let braavos_base = deployment_classes(AccountFamily::Braavos)
        .map(|entry| entry.class_hash)
        .find(|hash| *hash != braavos)
        .unwrap();
    assert!(keep(&found(AccountFamily::OpenZeppelin, oz, 0), false));
    assert!(!keep(&found(AccountFamily::OpenZeppelin, oz, 3), false));
    assert!(keep(&found(AccountFamily::OpenZeppelin, oz, 3), true));
    assert!(keep(&found(AccountFamily::Argent, argent, 0), false));
    // Braavos lists index 0 at the class its app deploys (issue 718); older classes only
    // once used. Xverse's build is never listed unused.
    assert!(keep(&found(AccountFamily::Braavos, braavos, 0), false));
    assert!(!keep(&found(AccountFamily::Braavos, braavos_base, 0), true));
    assert!(!keep(
        &found(AccountFamily::Argent, catalog().argent_xverse, 0),
        true
    ));
    let mut funded = found(AccountFamily::Braavos, braavos_base, 7);
    funded.funded = true;
    assert!(keep(&funded, false));
    // Ready's ladder never offers an account this wallet would create.
    let mut ready = found(AccountFamily::Argent, argent, 0);
    ready.ladder = Ladder::ArgentX;
    assert!(!keep(&ready, true));
}

#[test]
fn scan_walks_each_familys_ladder_in_extension_order() {
    let argent = deployment_classes(AccountFamily::Argent).count();
    let braavos = deployment_classes(AccountFamily::Braavos).count();
    let shapes = scan_shapes(true, NetworkId::Mainnet).unwrap();
    // OZ; every Argent release on this wallet's ladder; all but Xverse's on Ready's; Braavos.
    let ready = argent - 1;
    assert_eq!(shapes.len(), 1 + argent + ready + braavos);
    assert_eq!(
        (shapes[0].family, shapes[0].ladder),
        (AccountFamily::OpenZeppelin, Ladder::Account)
    );
    let own = &shapes[1..1 + argent];
    assert!(own
        .iter()
        .all(|s| s.family == AccountFamily::Argent && s.ladder == Ladder::Account));
    assert!(own.iter().any(|s| s.class_hash == catalog().argent_xverse));
    let vendor = &shapes[1 + argent..1 + argent + ready];
    assert!(vendor.iter().all(|s| s.ladder == Ladder::ArgentX));
    assert!(vendor
        .iter()
        .all(|s| s.class_hash != catalog().argent_xverse));
    assert!(shapes[1 + argent + ready..]
        .iter()
        .all(|s| s.ladder == Ladder::Address));
    // A passphrase-protected phrase has no Ready accounts.
    let without_ready = scan_shapes(false, NetworkId::Mainnet).unwrap();
    assert_eq!(without_ready.len(), 1 + argent + braavos);
}

/// `recoveryScanShapes` and `isCreatableCandidate` as the extension wrote them into the scan
/// fixture (`accounts-parity-scan.json`): Bramble's rule, which lives here until 2.7.
#[test]
fn scan_shapes_are_the_extensions() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/accounts-parity-scan.json"
    );
    let fixture: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let text = |value: &serde_json::Value| value.as_str().unwrap().to_string();
    let network = NetworkId::from_catalog_id(&text(&fixture["networkId"])).unwrap();
    let expected: Vec<_> = fixture["shapes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|shape| {
            (
                text(&shape["accountContractType"]),
                text(&shape["derivation"]),
                felt::parse(&text(&shape["classHash"])).unwrap(),
                shape["creatable"].as_bool().unwrap(),
            )
        })
        .collect();
    let shapes: Vec<_> = scan_shapes(true, network)
        .unwrap()
        .iter()
        .map(|shape| {
            (
                shape.family.wire().to_string(),
                shape.ladder.kind().to_string(),
                shape.class_hash,
                shape.creatable,
            )
        })
        .collect();
    assert_eq!(shapes, expected);
}

#[test]
fn selections_default_to_each_familys_vendor_ladder() {
    let pick = |family, ladder| RecoverySelection {
        family,
        account_index: 1,
        ladder,
        class_hash: None,
    };
    let path = |family, ladder| selection_path(&pick(family, ladder));
    assert_eq!(
        path(AccountFamily::OpenZeppelin, None).unwrap(),
        Ladder::Account
    );
    assert_eq!(path(AccountFamily::Argent, None).unwrap(), Ladder::ArgentX);
    assert_eq!(
        path(AccountFamily::Argent, Some(Ladder::Account)).unwrap(),
        Ladder::Account
    );
    assert_eq!(path(AccountFamily::Braavos, None).unwrap(), Ladder::Address);
    assert!(path(AccountFamily::OpenZeppelin, Some(Ladder::Address)).is_err());
    assert!(path(AccountFamily::Argent, Some(Ladder::Address)).is_err());
    assert!(path(AccountFamily::Braavos, Some(Ladder::Account)).is_err());
    assert!(path(AccountFamily::Braavos, Some(Ladder::ArgentX)).is_err());
}
