//! Encrypted vault envelope, byte-compatible with the extension's `EncryptedEnvelope` v3
//! (`packages/platform/vault/src/encrypted-store.ts`): PBKDF2-SHA-256 at 600 000 iterations
//! derives an AES-256-GCM key; the additional data binds the ciphertext to
//! `scope \0 lineage \0 commit`, so an envelope cannot be replayed under another scope.
//!
//! Reads fail closed on any field the extension would reject, including a tampered-down
//! iteration count.

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::CoreError;

/// Current PBKDF2 strength, identical to the extension's `KDF_ITERATIONS`.
pub const KDF_ITERATIONS: u32 = 600_000;
/// Legacy strength the extension still reads (never writes).
const LEGACY_KDF_ITERATIONS: [u32; 1] = [310_000];
/// Shortest vault password, as `MIN_VAULT_PASSPHRASE_LENGTH` (the rule itself is `ui::is_vault_passphrase`).
pub const MIN_PASSWORD_LENGTH: usize = 8;

/// The extension's v3 envelope, field for field.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Envelope {
    pub cipher: String,
    pub commit: String,
    pub data: String,
    pub iterations: u32,
    pub iv: String,
    pub kdf: String,
    pub lineage: String,
    pub salt: String,
    pub scope: String,
    pub version: u8,
}

/// A password-derived AES key and the salt it was derived with, wiped on drop.
pub struct SealingKey {
    key: Zeroizing<[u8; 32]>,
    salt: [u8; 16],
    lineage: String,
}

/// Fresh bytes from the OS CSPRNG. The one randomness boundary of the vault.
pub(crate) fn random<const N: usize>() -> Result<[u8; N], CoreError> {
    let mut bytes = [0u8; N];
    getrandom::fill(&mut bytes).map_err(|_| CoreError::Storage {
        reason: "entropy unavailable".into(),
    })?;
    Ok(bytes)
}

/// Checks the password bounds the extension's setup screen enforces.
pub fn check_password(password: &str) -> Result<(), CoreError> {
    if !crate::ui::is_vault_passphrase(password) {
        return Err(CoreError::InvalidInput {
            reason: format!("password must be at least {MIN_PASSWORD_LENGTH} characters"),
        });
    }
    Ok(())
}

fn derive_key(password: &str, salt: &[u8], iterations: u32) -> Zeroizing<[u8; 32]> {
    let mut key = Zeroizing::new([0u8; 32]);
    pbkdf2::pbkdf2_hmac::<sha2::Sha256>(password.as_bytes(), salt, iterations, key.as_mut());
    key
}

pub(crate) fn decode<const N: usize>(value: &str) -> Option<[u8; N]> {
    BASE64.decode(value).ok()?.try_into().ok()
}

/// `a \0 b \0 c`, the additional-data layout every Bramble ciphertext uses.
pub(crate) fn additional_data(scope: &str, lineage: &str, commit: &str) -> Vec<u8> {
    format!("{scope}\0{lineage}\0{commit}").into_bytes()
}

/// Whether `value` is `len` lowercase hex digits, the lineage and slot-id grammar.
pub(crate) fn is_lower_hex(value: &str, len: usize) -> bool {
    value.len() == len
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Lowercase hex of fresh random bytes.
pub(crate) fn random_hex<const N: usize>() -> Result<String, CoreError> {
    Ok(random::<N>()?.iter().map(|b| format!("{b:02x}")).collect())
}

/// AES-256-GCM encryption under a raw 32-byte key.
pub(crate) fn aead_seal(
    key: &[u8; 32],
    iv: &[u8; 12],
    aad: &[u8],
    msg: &[u8],
) -> Result<Vec<u8>, CoreError> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| CoreError::Storage {
        reason: "cipher init".into(),
    })?;
    cipher
        .encrypt(&Nonce::from(*iv), Payload { msg, aad })
        .map_err(|_| CoreError::Storage {
            reason: "encrypt".into(),
        })
}

/// AES-256-GCM decryption under a raw 32-byte key; `None` when authentication fails.
pub(crate) fn aead_open(
    key: &[u8; 32],
    iv: &[u8; 12],
    aad: &[u8],
    msg: &[u8],
) -> Option<Zeroizing<Vec<u8>>> {
    let cipher = Aes256Gcm::new_from_slice(key).ok()?;
    cipher
        .decrypt(&Nonce::from(*iv), Payload { msg, aad })
        .ok()
        .map(Zeroizing::new)
}

impl SealingKey {
    /// Derives a key for a brand-new vault with a fresh salt and lineage.
    pub fn create(password: &str) -> Result<Self, CoreError> {
        check_password(password)?;
        let salt = random::<16>()?;
        let lineage = random_hex::<16>()?;
        Ok(Self {
            key: derive_key(password, &salt, KDF_ITERATIONS),
            salt,
            lineage,
        })
    }

    /// Seals JSON plaintext under `scope`, with a fresh IV and commit marker on every call.
    #[cfg(test)]
    pub fn seal(&self, plaintext: &[u8], scope: &str) -> Result<Envelope, CoreError> {
        self.seal_with(plaintext, scope, &random::<12>()?, &random::<16>()?)
    }

    /// `seal` with the IV and commit supplied, so a migration step can be deterministic.
    pub(crate) fn seal_with(
        &self,
        plaintext: &[u8],
        scope: &str,
        iv: &[u8; 12],
        commit: &[u8; 16],
    ) -> Result<Envelope, CoreError> {
        let commit = BASE64.encode(commit);
        let aad = additional_data(scope, &self.lineage, &commit);
        let data = aead_seal(&self.key, iv, &aad, plaintext)?;
        Ok(Envelope {
            cipher: "AES-256-GCM".into(),
            commit,
            data: BASE64.encode(data),
            iterations: KDF_ITERATIONS,
            iv: BASE64.encode(iv),
            kdf: "PBKDF2-SHA-256".into(),
            lineage: self.lineage.clone(),
            salt: BASE64.encode(self.salt),
            scope: scope.into(),
            version: 3,
        })
    }

    /// The vault lineage this key seals under.
    pub(crate) fn lineage(&self) -> &str {
        &self.lineage
    }

    /// Opens an envelope this key sealed (same salt and lineage) without running the KDF again.
    /// Used to prove a freshly built envelope round-trips before it is written.
    pub(crate) fn open_sealed(
        &self,
        envelope: &Envelope,
        scope: &str,
    ) -> Result<Zeroizing<Vec<u8>>, CoreError> {
        let invalid = || CoreError::Storage {
            reason: "invalid vault envelope".into(),
        };
        if !valid_shape(envelope, scope)
            || envelope.iterations != KDF_ITERATIONS
            || envelope.lineage != self.lineage
            || decode::<16>(&envelope.salt) != Some(self.salt)
        {
            return Err(invalid());
        }
        let iv = decode::<12>(&envelope.iv).ok_or_else(invalid)?;
        let data = BASE64.decode(&envelope.data).map_err(|_| invalid())?;
        let aad = additional_data(scope, &envelope.lineage, &envelope.commit);
        aead_open(&self.key, &iv, &aad, &data).ok_or_else(invalid)
    }

    /// A key with fixed parts, for deterministic tests of the migration step.
    #[cfg(test)]
    pub(crate) fn fixed(password: &str, salt: [u8; 16], lineage: &str) -> Self {
        Self {
            key: derive_key(password, &salt, KDF_ITERATIONS),
            salt,
            lineage: lineage.into(),
        }
    }
}

fn valid_shape(envelope: &Envelope, scope: &str) -> bool {
    envelope.version == 3
        && envelope.cipher == "AES-256-GCM"
        && envelope.kdf == "PBKDF2-SHA-256"
        && (envelope.iterations == KDF_ITERATIONS
            || LEGACY_KDF_ITERATIONS.contains(&envelope.iterations))
        && envelope.scope == scope
        && is_lower_hex(&envelope.lineage, 32)
        && decode::<16>(&envelope.commit).is_some()
}

/// Opens an envelope. A wrong password and a tampered envelope are indistinguishable by design.
/// Returns the plaintext and a sealing key that re-seals under the same salt and lineage.
pub fn open(
    envelope: &Envelope,
    password: &str,
    scope: &str,
) -> Result<(Zeroizing<Vec<u8>>, SealingKey), CoreError> {
    if !valid_shape(envelope, scope) {
        return Err(CoreError::Storage {
            reason: "invalid vault envelope".into(),
        });
    }
    let (Some(salt), Some(iv)) = (decode::<16>(&envelope.salt), decode::<12>(&envelope.iv)) else {
        return Err(CoreError::Storage {
            reason: "invalid vault envelope".into(),
        });
    };
    let data = BASE64
        .decode(&envelope.data)
        .map_err(|_| CoreError::Storage {
            reason: "invalid vault envelope".into(),
        })?;
    // A legacy-strength vault is re-derived at the current strength before it is re-sealed.
    let key = derive_key(password, &salt, envelope.iterations);
    let aad = additional_data(scope, &envelope.lineage, &envelope.commit);
    let plaintext = aead_open(&key, &iv, &aad, &data).ok_or(CoreError::WrongPassword)?;
    let key = if envelope.iterations == KDF_ITERATIONS {
        key
    } else {
        derive_key(password, &salt, KDF_ITERATIONS)
    };
    Ok((
        plaintext,
        SealingKey {
            key,
            salt,
            lineage: envelope.lineage.clone(),
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_binds_scope() {
        let key = SealingKey::create("correct horse").unwrap();
        let sealed = key.seal(b"{\"a\":1}", "scope.a").unwrap();
        let (plain, _) = open(&sealed, "correct horse", "scope.a").unwrap();
        assert_eq!(plain.as_slice(), b"{\"a\":1}");
        assert!(matches!(
            open(&sealed, "wrong horse!", "scope.a"),
            Err(CoreError::WrongPassword)
        ));
        assert!(open(&sealed, "correct horse", "scope.b").is_err());
    }

    #[test]
    fn rejects_tampered_metadata() {
        let key = SealingKey::create("correct horse").unwrap();
        let sealed = key.seal(b"{}", "s").unwrap();
        let weakened = Envelope {
            iterations: 1,
            ..sealed.clone()
        };
        assert!(open(&weakened, "correct horse", "s").is_err());
        let recommitted = Envelope {
            commit: BASE64.encode([0u8; 16]),
            ..sealed.clone()
        };
        assert!(matches!(
            open(&recommitted, "correct horse", "s"),
            Err(CoreError::WrongPassword)
        ));
        let relined = Envelope {
            lineage: "0".repeat(32),
            ..sealed
        };
        assert!(matches!(
            open(&relined, "correct horse", "s"),
            Err(CoreError::WrongPassword)
        ));
    }

    #[test]
    fn enforces_password_bounds() {
        assert!(check_password("short").is_err());
        assert!(check_password("        x").is_err());
        assert!(check_password("long enough").is_ok());
    }
}
