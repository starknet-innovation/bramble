//! The FFI surface never returns secret-shaped bytes. Scans every exported function in the
//! modules that carry `#[uniffi::export]` and fails when one returns raw bytes, so a future method
//! cannot hand the DEK, a wrap secret or vault bytes to Swift or Kotlin without this test changing.

const EXPORTING: [(&str, &str); 3] = [
    ("lib.rs", include_str!("../src/lib.rs")),
    ("wallet.rs", include_str!("../src/wallet.rs")),
    ("biometric.rs", include_str!("../src/biometric.rs")),
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
