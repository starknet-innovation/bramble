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
/// directly, where the unscoped one is.
#[test]
fn viewing_keys_are_derived_only_through_the_shared_core() {
    fn visit(dir: &std::path::Path, found: &mut Vec<(String, String)>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                visit(&path, found);
                continue;
            }
            let text = std::fs::read_to_string(&path).unwrap();
            if text.contains("strk20_viewing_key") {
                found.push((path.display().to_string(), text));
            }
        }
    }
    let mut found = Vec::new();
    let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    visit(&src, &mut found);
    for (path, text) in &found {
        assert!(
            !text.contains("krusty_kms::derive_strk20_viewing_key")
                && !text.contains("krusty_kms::derive_scoped_strk20_viewing_key"),
            "{path} derives a viewing key from Krusty directly"
        );
    }
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
}
