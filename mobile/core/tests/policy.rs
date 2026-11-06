//! Security policy constants the core shares with the extension, read from the generated
//! `core/generated/policy.json` (`bun run mobile:assets`, drift-checked in `bun run check`).

use bramble_core::testing::{IDLE_LOCK_MS, KDF_ITERATIONS, MIN_PASSWORD_LENGTH};
use serde_json::Value;

#[test]
fn the_core_uses_the_extension_policy() {
    let policy: Value = serde_json::from_str(include_str!("../generated/policy.json")).unwrap();
    assert_eq!(policy["idleLockMs"].as_u64(), Some(IDLE_LOCK_MS));
    assert_eq!(
        policy["kdfIterations"].as_u64(),
        Some(u64::from(KDF_ITERATIONS))
    );
    assert_eq!(
        policy["minPassphraseLength"].as_u64(),
        Some(MIN_PASSWORD_LENGTH as u64)
    );
}
