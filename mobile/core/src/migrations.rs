//! Vault file migrations, following the extension's `schema/migrations.ts`: exactly one adjacent
//! step per version, each a pure function of its input. Randomness (the new DEK, IVs, commits) is
//! drawn by the caller and passed in, so a step is deterministic and testable with fixed bytes.
//!
//! A v1 file can only be opened with the passphrase, so migration runs after a successful
//! passphrase open, never earlier. The caller proves the new file round-trips before writing it,
//! and leaves the old file in place if anything fails.

use crate::container::{
    self, Dek, Randomness, StoredVault, VaultFile, VaultPayload, CONTAINER_VERSION, V1_SCOPE,
};
use crate::files::storage;
use crate::vault::{self, SealingKey};
use crate::CoreError;

/// A vault opened with the passphrase. `migrated` means `container` is a new v2 built from a v1
/// file that is still on disk.
pub(crate) struct Opened {
    pub payload: VaultPayload,
    pub dek: Dek,
    pub container: VaultFile,
    pub migrated: bool,
}

/// Opens whatever is on disk with the passphrase (one KDF). A v1 file is migrated in memory and
/// proven to round-trip; writing it is the caller's decision.
pub(crate) fn open_stored(stored: StoredVault, password: &str) -> Result<Opened, CoreError> {
    match stored {
        StoredVault::V2(container) => {
            let container = *container;
            let (dek, _) = container.open_dek(password)?;
            let payload = container.open_payload(&dek)?;
            Ok(Opened {
                payload,
                dek,
                container,
                migrated: false,
            })
        }
        StoredVault::V1(envelope) => {
            let (plaintext, key) = vault::open(&envelope, password, V1_SCOPE)?;
            let payload = VaultPayload::parse(&plaintext, 1)?;
            let dek = container::new_dek()?;
            let container = migrate_v1(&MigrationInput {
                payload: &payload,
                key: &key,
                dek: &dek,
                randomness: &Randomness::draw()?,
            })?;
            let proven = container.open_dek_with(&key)?;
            let payload = container.open_payload(&proven)?;
            if *proven != *dek {
                return Err(storage("vault migration did not round-trip"));
            }
            Ok(Opened {
                payload,
                dek,
                container,
                migrated: true,
            })
        }
    }
}

/// Everything a step needs: the opened v1 payload, the passphrase key it was opened with
/// (re-derived at the current KDF strength), and fresh randomness.
pub(crate) struct MigrationInput<'a> {
    pub payload: &'a VaultPayload,
    pub key: &'a SealingKey,
    pub dek: &'a [u8; 32],
    pub randomness: &'a Randomness,
}

type Step = fn(&MigrationInput<'_>) -> Result<VaultFile, CoreError>;

/// `(from version, step to from + 1)`. The last step ends at `CONTAINER_VERSION`.
pub(crate) const VAULT_MIGRATIONS: [(u32, Step); 1] = [(1, v1_to_v2)];

/// v1 (a bare envelope around a version-1 payload) → v2 (DEK container). Keeps the lineage, the
/// accounts, the phrase and its passphrase; the payload version becomes 2.
fn v1_to_v2(input: &MigrationInput<'_>) -> Result<VaultFile, CoreError> {
    let payload = VaultPayload {
        account_count: input.payload.account_count,
        mnemonic: input.payload.mnemonic.clone(),
        mnemonic_passphrase: input.payload.mnemonic_passphrase.clone(),
        version: CONTAINER_VERSION,
    };
    container::seal_new(input.key, input.dek, &payload, input.randomness)
}

/// Migrates an opened v1 file to the current version.
pub(crate) fn migrate_v1(input: &MigrationInput<'_>) -> Result<VaultFile, CoreError> {
    let (_, step) =
        VAULT_MIGRATIONS
            .iter()
            .find(|(from, _)| *from == 1)
            .ok_or(CoreError::Storage {
                reason: "no migration".into(),
            })?;
    step(input)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::container::{parse, StoredVault};

    const PHRASE: &str =
        "habit hope tip crystal because grunt nation idea electric witness alert like";

    #[test]
    fn steps_are_adjacent_and_end_at_the_current_version() {
        for (index, (from, _)) in VAULT_MIGRATIONS.iter().enumerate() {
            assert_eq!(*from, index as u32 + 1);
        }
        assert_eq!(VAULT_MIGRATIONS.len() as u32 + 1, CONTAINER_VERSION);
    }

    #[test]
    fn the_step_is_deterministic_given_its_randomness() {
        let key = SealingKey::fixed("fixture passphrase", [7; 16], &"ab".repeat(16));
        let payload = VaultPayload {
            account_count: 3,
            mnemonic: PHRASE.into(),
            mnemonic_passphrase: None,
            version: 1,
        };
        let randomness = Randomness {
            dek_iv: [1; 12],
            dek_commit: [2; 16],
            payload_iv: [3; 12],
            payload_commit: [4; 16],
        };
        let input = MigrationInput {
            payload: &payload,
            key: &key,
            dek: &[9; 32],
            randomness: &randomness,
        };
        let first = serde_json::to_string(&migrate_v1(&input).unwrap()).unwrap();
        let second = serde_json::to_string(&migrate_v1(&input).unwrap()).unwrap();
        assert_eq!(first, second);
        // Golden: the exact file this input must produce. A change here changes stored bytes.
        let golden: serde_json::Value = serde_json::from_str(include_str!(
            "../tests/fixtures/migration-v1-to-v2.golden.json"
        ))
        .unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&first).unwrap(),
            golden
        );
        let StoredVault::V2(file) = parse(&first).unwrap() else {
            panic!("expected a container")
        };
        let dek = file.open_dek_with(&key).unwrap();
        assert_eq!(*dek, [9; 32]);
        let opened = file.open_payload(&dek).unwrap();
        assert_eq!(opened.account_count, 3);
        assert_eq!(opened.version, 2);
    }
}
