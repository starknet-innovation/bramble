//! The Settings screens show `core_info().krusty_version`. Krusty reaches mobile only through
//! wallet-core (tests/conformance/mobile-generated.test.ts checks this lockfile holds one copy),
//! so the version the core reports must be the one this lockfile resolves.

#[test]
fn core_info_reports_the_krusty_this_lockfile_resolves() {
    let lock = include_str!("../Cargo.lock");
    let resolved = lock
        .split("[[package]]")
        .find(|entry| entry.contains("\nname = \"krusty-kms\"\n"))
        .and_then(|entry| {
            entry
                .lines()
                .find_map(|line| line.strip_prefix("version = \"")?.strip_suffix('"'))
        })
        .expect("Cargo.lock resolves krusty-kms");
    assert_eq!(bramble_core::core_info().krusty_version, resolved);
}
