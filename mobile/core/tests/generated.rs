//! The app runs the catalogs compiled into wallet-core's `bramble-core`, not the files
//! `bun run mobile:assets` writes here. Hold the two together, so a catalog regenerated in Bramble
//! cannot be silently ignored by the core this crate pins: move the `rev` to a core that carries it.

use std::path::Path;

/// `catalogs::GENERATED` paths are relative to Bramble's `mobile/`.
fn mobile_dir() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap()
}

#[test]
fn the_core_embeds_what_the_generators_wrote() {
    for (path, embedded) in bramble_core::catalogs::GENERATED {
        let written = std::fs::read_to_string(mobile_dir().join(path))
            .unwrap_or_else(|error| panic!("{path}: {error}"));
        assert!(
            written == embedded,
            "{path} differs from the copy in the pinned bramble-core"
        );
    }
}

#[test]
fn every_generated_file_is_embedded() {
    let listed: Vec<&str> = bramble_core::catalogs::GENERATED
        .iter()
        .map(|(path, _)| path)
        .copied()
        .collect();
    let generated = mobile_dir().join("core/generated");
    for entry in std::fs::read_dir(generated).unwrap() {
        let name = entry.unwrap().file_name().into_string().unwrap();
        let path = format!("core/generated/{name}");
        assert!(
            listed.contains(&path.as_str()),
            "{path} is not in bramble-core's catalogs::GENERATED"
        );
    }
}
