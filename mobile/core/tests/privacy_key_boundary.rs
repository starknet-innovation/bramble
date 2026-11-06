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

#[test]
fn no_unscoped_viewing_key_derivation_exists() {
    fn visit(dir: &std::path::Path, found: &mut Vec<String>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                visit(&path, found);
            } else if std::fs::read_to_string(&path)
                .unwrap()
                .contains("derive_strk20_viewing_key")
            {
                found.push(path.display().to_string());
            }
        }
    }
    let mut found = Vec::new();
    visit(
        &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
        &mut found,
    );
    assert!(found.is_empty(), "unscoped derivation in {found:?}");
}
