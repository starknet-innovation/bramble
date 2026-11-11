//! The viewing key never leaves the core except inside a discovery `Post` body: not in any step's
//! `Debug`, state, failure, error, or gate output. Keys come from the public parity phrase.

mod privacy_support;

use bramble_core::testing::strk20_viewing_key;
use bramble_core::{PrivacyPurpose, PrivacyStep};
use privacy_support::{drive, mainnet_plan, steady, wallet, wire, Script, PHRASE};

fn forms(key: &str) -> [String; 3] {
    let digits = key.trim_start_matches("0x");
    [
        key.to_string(),
        format!("{digits:0>64}"),
        digits.to_string(),
    ]
}

#[test]
fn the_key_appears_only_inside_discovery_bodies() {
    let wire = wire();
    let keys = &wire["viewingKeys"];
    let key = strk20_viewing_key(
        PHRASE,
        0,
        keys["chainId"].as_str().unwrap(),
        keys["pool"].as_str().unwrap(),
    )
    .unwrap();
    let mut debug = String::new();
    let mut in_bodies = 0;
    let (_dir, core) = wallet();
    for case in wire["cases"].as_array().unwrap() {
        let run = drive(
            &mainnet_plan(&core),
            Script::from_case(&case["script"]),
            &mut steady,
        );
        for step in &run.steps {
            debug.push_str(&format!("{step:?}\n"));
            if let PrivacyStep::Post { body, purpose, .. } = step {
                assert!(matches!(
                    purpose,
                    PrivacyPurpose::PreflightCheck | PrivacyPurpose::IncomingState
                ));
                if std::str::from_utf8(body).unwrap().contains(&key) {
                    in_bodies += 1;
                }
            }
        }
        debug.push_str(&format!("{:?}\n", run.outcome));
    }
    assert!(in_bodies > 0, "the discovery bodies carry the key");
    assert!(
        debug.contains("[redacted"),
        "Post bodies are redacted in Debug"
    );
    for form in forms(&key) {
        assert!(!debug.contains(&form), "the key leaked into Debug output");
    }
}

/// The scoped derivation lives in `wallet_core::derive_strk20_viewing_key`, which takes the chain
/// and pool. Only `kms.rs` may call it, and nothing may reach Krusty's viewing-key functions
/// directly, where the unscoped one is: no file in `src` or `tests` names Krusty's crates at all
/// (mobile depends on Krusty only through wallet-core). Mobile's zeroizing accessor over it,
/// `scoped_viewing_key`, is reached only from `kms.rs` (the public key), the session-checked
/// `plan_viewing_key` behind the read plan's `PrivacyHost`, and the test hooks.
#[test]
fn viewing_keys_are_derived_only_through_the_shared_core() {
    fn visit(dir: &std::path::Path, found: &mut Vec<(String, String)>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                visit(&path, found);
                continue;
            }
            if path.extension().is_some_and(|ext| ext == "rs") {
                let text = std::fs::read_to_string(&path).unwrap();
                found.push((path.display().to_string(), text));
            }
        }
    }
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut everything = Vec::new();
    visit(&root.join("src"), &mut everything);
    visit(&root.join("tests"), &mut everything);
    // Split so this file does not name it either; it covers both of Krusty's crates.
    let krusty = concat!("krusty", "_kms");
    for (path, text) in &everything {
        assert!(!text.contains(krusty), "{path} names Krusty directly");
    }
    let src = root.join("src");
    let src_prefix = src.display().to_string();
    let found: Vec<(String, String)> = everything
        .into_iter()
        .filter(|(path, text)| {
            path.starts_with(&src_prefix)
                && (text.contains("strk20_viewing_key") || text.contains("scoped_viewing_key"))
        })
        .collect();
    let callers: Vec<&str> = found
        .iter()
        .filter(|(_, text)| text.contains("derive_strk20_viewing_key"))
        .map(|(path, _)| path.as_str())
        .collect();
    assert_eq!(callers, [src.join("kms.rs").display().to_string()]);
    let kms = &found.iter().find(|(path, _)| path == callers[0]).unwrap().1;
    assert_eq!(
        kms.matches("derive_strk20_viewing_key").count(),
        kms.matches("wallet_core::derive_strk20_viewing_key")
            .count()
    );
    let mut accessors: Vec<&str> = found
        .iter()
        .filter(|(_, text)| text.contains("scoped_viewing_key("))
        .map(|(path, _)| path.as_str())
        .collect();
    accessors.sort();
    let expected: Vec<String> = ["kms.rs", "privacy/wallet_ext.rs", "testing.rs"]
        .iter()
        .map(|file| src.join(file).display().to_string())
        .collect();
    assert_eq!(accessors, expected);
}
