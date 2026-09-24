//! One of the two modules that call Krusty KMS (with `kms_accounts.rs`). Mirrors `packages/platform/kms-krusty/src/adapter.ts`:
//! inputs are validated before they reach Krusty, and outputs are re-checked before they leave,
//! so a Krusty regression surfaces as an error here rather than as a wrong key or address.
//!
//! Private keys are derived per call, held in Krusty's zeroizing `SecretFelt`, and never returned to a caller
//! outside this crate.

use krusty_kms::{OzAccountClassConfig, STARKNET_COIN_TYPE};
use krusty_kms_common::{ChainId, SecretFelt};
use starknet_types_core::felt::Felt;
use zeroize::Zeroizing;

use crate::felt;
use crate::CoreError;

/// Mnemonic lengths Krusty generates and the extension accepts.
pub const MNEMONIC_WORD_COUNTS: [u8; 5] = [12, 15, 18, 21, 24];
/// Upper bound on an optional BIP-39 passphrase, as in `wallet-model/passphrase`.
const MAX_BIP39_PASSPHRASE_LENGTH: usize = 256;
/// Upper bound on phrase text accepted from the UI before BIP-39 parsing.
const MAX_MNEMONIC_TEXT_LENGTH: usize = 512;

/// A Stark ECDSA signature over a caller-supplied hash.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Signature {
    pub public_key: String,
    pub r: String,
    pub s: String,
}

pub(crate) fn kms_error(context: &str) -> impl Fn(krusty_kms_common::KmsError) -> CoreError + '_ {
    // Krusty's messages can echo input; only the operation name crosses the boundary.
    move |_| CoreError::Kms {
        operation: context.to_string(),
    }
}

/// Normalises phrase text the way the extension's import form does: lowercase words, single spaces.
pub fn normalise_phrase(phrase: &str) -> Zeroizing<String> {
    Zeroizing::new(
        phrase
            .split_whitespace()
            .map(str::to_lowercase)
            .collect::<Vec<_>>()
            .join(" "),
    )
}

/// Whether text is a checksummed BIP-39 English phrase of a supported length.
pub fn validate_mnemonic(phrase: &str) -> bool {
    if phrase.len() > MAX_MNEMONIC_TEXT_LENGTH {
        return false;
    }
    let words = phrase.split(' ').count();
    MNEMONIC_WORD_COUNTS
        .iter()
        .any(|count| usize::from(*count) == words)
        && krusty_kms::validate_mnemonic(phrase).is_ok()
}

/// Generates a fresh phrase from OS entropy.
pub fn generate_mnemonic(word_count: u8) -> Result<Zeroizing<String>, CoreError> {
    if !MNEMONIC_WORD_COUNTS.contains(&word_count) {
        return Err(CoreError::InvalidInput {
            reason: "unsupported word count".into(),
        });
    }
    let phrase = Zeroizing::new(
        krusty_kms::generate_mnemonic(usize::from(word_count)).map_err(kms_error("generate"))?,
    );
    if !validate_mnemonic(&phrase) {
        return Err(CoreError::Kms {
            operation: "generate".into(),
        });
    }
    Ok(phrase)
}

fn check_derivation_input(phrase: &str, passphrase: Option<&str>) -> Result<(), CoreError> {
    if !validate_mnemonic(phrase) {
        return Err(CoreError::InvalidInput {
            reason: "invalid recovery phrase".into(),
        });
    }
    if passphrase.is_some_and(|p| p.len() > MAX_BIP39_PASSPHRASE_LENGTH) {
        return Err(CoreError::InvalidInput {
            reason: "passphrase too long".into(),
        });
    }
    Ok(())
}

/// Derives the Starknet signing key at `m/44'/9004'/account'/0/index` (Krusty's layout).
pub(crate) fn private_key(
    phrase: &str,
    passphrase: Option<&str>,
    account_index: u32,
) -> Result<SecretFelt, CoreError> {
    check_derivation_input(phrase, passphrase)?;
    let pair = krusty_kms::derive_keypair_with_coin_type(
        phrase,
        0,
        account_index,
        STARKNET_COIN_TYPE,
        passphrase,
    )
    .map_err(kms_error("derive"))?;
    if !felt::is_private_key(pair.private_key.expose_secret()) {
        return Err(CoreError::Kms {
            operation: "derive".into(),
        });
    }
    Ok(pair.private_key)
}

/// The OpenZeppelin account class the wallet deploys, from Krusty's checked-in manifest.
pub fn oz_class_hash(chain: ChainId) -> Result<Felt, CoreError> {
    let class_hash = OzAccountClassConfig::latest(chain)
        .map_err(kms_error("class hash"))?
        .class_hash();
    if class_hash == Felt::ZERO {
        return Err(CoreError::Kms {
            operation: "class hash".into(),
        });
    }
    Ok(class_hash)
}

/// Signs a message hash with deterministic RFC-6979 Stark ECDSA.
pub fn sign_hash(
    phrase: &str,
    passphrase: Option<&str>,
    account_index: u32,
    message_hash: &str,
) -> Result<Signature, CoreError> {
    let hash = felt::parse(message_hash).ok_or_else(|| CoreError::InvalidInput {
        reason: "message hash is not a felt".into(),
    })?;
    let key = private_key(phrase, passphrase, account_index)?;
    let signature =
        krusty_kms::sign_stark_hash(key.expose_secret(), &hash).map_err(kms_error("sign"))?;
    if !felt::is_private_key(&signature.r) || !felt::is_private_key(&signature.s) {
        return Err(CoreError::Kms {
            operation: "sign".into(),
        });
    }
    Ok(Signature {
        public_key: felt::canonical(&signature.public_key),
        r: felt::canonical(&signature.r),
        s: felt::canonical(&signature.s),
    })
}
