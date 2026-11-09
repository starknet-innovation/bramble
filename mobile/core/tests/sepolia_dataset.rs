//! Opt-in: mobile discovery against the Sepolia vendor-import dataset (issue 821,
//! `tools/vendor-dataset/`). For every phrase in the dataset's git-ignored seed file, imports it,
//! runs the default scan over a bundled Sepolia endpoint, and checks that every D1 fixture in
//! `tools/vendor-dataset/manifest/sepolia/` is listed. D1 means the default probe can recompute
//! the address, so a miss is a bug (`docs/VENDOR_IMPORT_DATASET.md`). Read-only; never in CI.
//!
//!   cargo test --locked --test sepolia_dataset -- --ignored --nocapture
//!
//! Seeds come from `.env.vendor-seeds.local` at the repository root, or `BRAMBLE_DATASET_ENV_FILE`,
//! exactly as the dataset tools read them. A seed absent from the file is skipped with a note
//! (S-RDY and S-XVS are app-made and arrive late). Only fixture ids and addresses are printed.

mod common;

use std::collections::BTreeMap;
use std::path::PathBuf;

use bramble_core::NetworkId;
use common::live::{canonical, endpoint, refuse_ci, scan};
use serde_json::Value;

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// One variable from the seed file, parsed as `dataset-env.ts` does; `None` when absent or empty.
fn seed(name: &str) -> Option<String> {
    let path = std::env::var_os("BRAMBLE_DATASET_ENV_FILE")
        .map(PathBuf::from)
        .unwrap_or_else(|| repo_root().join(".env.vendor-seeds.local"));
    let text = std::fs::read_to_string(&path).expect("the dataset seed file is readable");
    text.lines().find_map(|line| {
        let value = line.strip_prefix(name)?.strip_prefix('=')?.trim();
        let value = value.trim_matches('"').trim();
        (!value.is_empty()).then(|| value.to_string())
    })
}

/// D1 phrase fixtures from the Sepolia manifest, grouped by seed variable: `(id, address)`.
fn d1_fixtures() -> BTreeMap<String, Vec<(String, String)>> {
    let dir = repo_root().join("tools/vendor-dataset/manifest/sepolia");
    let mut groups: BTreeMap<String, Vec<(String, String)>> = BTreeMap::new();
    for file in std::fs::read_dir(&dir).expect("the Sepolia manifest is present") {
        let text = std::fs::read_to_string(file.unwrap().path()).unwrap();
        let manifest: BTreeMap<String, Value> = serde_json::from_str(&text).unwrap();
        for entry in manifest.values() {
            let field = |key: &str| entry[key].as_str().unwrap_or_default().to_string();
            // Keys (`BRAMBLE_DATASET_KEY_*`) and multisig seat pairs are not phrase imports, and
            // Ledger ladders derive on the device (checked by hand, as the dataset README says).
            let var = field("seed");
            if field("detectability") != "D1"
                || !var.starts_with("BRAMBLE_DATASET_SEED_")
                || field("vendorDerivation").starts_with("ledger")
            {
                continue;
            }
            groups
                .entry(var)
                .or_default()
                .push((field("id"), field("address")));
        }
    }
    groups
}

#[test]
#[ignore = "live Sepolia; needs the dataset seed file"]
fn discovery_lists_every_d1_sepolia_fixture() {
    refuse_ci();
    let url = endpoint(NetworkId::Sepolia);
    let mut missed = Vec::new();
    let mut checked = 0;
    for (var, fixtures) in d1_fixtures() {
        let Some(phrase) = seed(&var) else {
            println!(
                "{var} not in the seed file: skipping {} fixture(s)",
                fixtures.len()
            );
            continue;
        };
        let dir = tempfile::tempdir().unwrap();
        let core = common::open(dir.path(), &common::FakeClock::new());
        core.import_wallet("sepolia dataset password".into(), phrase, None)
            .unwrap_or_else(|error| panic!("{var} did not import: {error:?}"));
        let found: Vec<String> = scan(&core, NetworkId::Sepolia, &url)
            .iter()
            .map(|candidate| canonical(&candidate.address))
            .collect();
        for (id, address) in fixtures {
            checked += 1;
            let hit = found.contains(&canonical(&address));
            println!("{} {id} {address}", if hit { "found " } else { "MISSED" });
            if !hit {
                missed.push(id);
            }
        }
    }
    assert!(checked > 0, "no D1 fixture had its seed in the seed file");
    assert!(
        missed.is_empty(),
        "discovery missed D1 fixtures: {missed:?}"
    );
}
