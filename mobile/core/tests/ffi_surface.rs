//! The FFI surface never returns secret-shaped bytes. Scans every exported function in the
//! modules that carry `#[uniffi::export]` and fails when one returns raw bytes, so a future method
//! cannot hand the DEK, a wrap secret or vault bytes to Swift or Kotlin without this test changing.

const EXPORTING: [(&str, &str); 16] = [
    ("lib.rs", include_str!("../src/lib.rs")),
    (
        "account_catalog.rs",
        include_str!("../src/account_catalog.rs"),
    ),
    ("account_names.rs", include_str!("../src/account_names.rs")),
    (
        "wallet_accounts.rs",
        include_str!("../src/wallet_accounts.rs"),
    ),
    ("wallet.rs", include_str!("../src/wallet.rs")),
    ("biometric.rs", include_str!("../src/biometric.rs")),
    ("send/mod.rs", include_str!("../src/send/mod.rs")),
    ("send/plan.rs", include_str!("../src/send/plan.rs")),
    (
        "send/wallet_ext.rs",
        include_str!("../src/send/wallet_ext.rs"),
    ),
    (
        "ffi_nostr_multisig.rs",
        include_str!("../src/ffi_nostr_multisig.rs"),
    ),
    (
        "ffi_coordination.rs",
        include_str!("../src/ffi_coordination.rs"),
    ),
    (
        "privacy/wallet_ext.rs",
        include_str!("../src/privacy/wallet_ext.rs"),
    ),
    ("privacy/mod.rs", include_str!("../src/privacy/mod.rs")),
    ("privacy/plan.rs", include_str!("../src/privacy/plan.rs")),
    ("activity/feed.rs", include_str!("../src/activity/feed.rs")),
    (
        "history/activity_book.rs",
        include_str!("../src/history/activity_book.rs"),
    ),
];

/// Signatures of functions inside `#[uniffi::export]` items, up to their opening brace.
fn exported_signatures(source: &str) -> Vec<String> {
    let mut signatures = Vec::new();
    let mut rest = source;
    while let Some(start) = rest.find("#[uniffi::export") {
        let item = &rest[start..];
        // An exported impl block runs to its closing brace at column zero; a free fn to its body.
        let end = if item.lines().nth(1).is_some_and(|l| l.starts_with("impl")) {
            item.find("\n}\n").unwrap_or(item.len())
        } else {
            item.find('{').unwrap_or(item.len())
        };
        let block = &item[..end];
        let mut cursor = block;
        while let Some(at) = cursor.find("pub fn ") {
            let signature = &cursor[at..];
            let stop = signature.find('{').unwrap_or(signature.len());
            signatures.push(
                signature[..stop]
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" "),
            );
            cursor = &signature[stop..];
        }
        rest = &item[end..];
    }
    signatures
}

#[test]
fn no_exported_function_returns_bytes() {
    let mut seen = 0;
    for (file, source) in EXPORTING {
        for signature in exported_signatures(source) {
            seen += 1;
            let returns = signature.split("->").nth(1).unwrap_or("");
            assert!(
                !returns.contains("u8>") && !returns.contains("[u8"),
                "{file}: `{signature}` returns bytes across the FFI"
            );
        }
    }
    assert!(seen >= 30, "the scan found only {seen} exported functions");
}

#[test]
fn the_wrap_secret_only_flows_into_the_core() {
    let biometric = include_str!("../src/biometric.rs");
    for signature in exported_signatures(biometric) {
        if signature.contains("wrap_secret") {
            let returns = signature.split("->").nth(1).unwrap_or("");
            assert!(returns.contains("Result<(), CoreError>"), "{signature}");
        }
    }
}

/// Signing is by account record only (`docs/accounts.md` §2.7): no exported function signs, plans
/// a transfer or deployment, or reads activity by account index, so the retired `sign_hash(index)`
/// cannot come back as a path the apps could reach.
#[test]
fn nothing_exported_signs_or_plans_by_account_index() {
    let mut signers = 0;
    for (file, source) in EXPORTING {
        for signature in exported_signatures(source) {
            let name = signature
                .trim_start_matches("pub fn ")
                .split('(')
                .next()
                .unwrap_or("");
            assert_ne!(name, "sign_hash", "{file}: the index shim is retired");
            let acts =
                name.contains("sign") || name.starts_with("prepare_") || name.ends_with("activity");
            if acts {
                signers += 1;
                assert!(
                    !signature.contains("account_index"),
                    "{file}: `{signature}` takes an account index"
                );
            }
        }
    }
    assert!(
        signers >= 5,
        "found only {signers} signing or planning functions"
    );
}
