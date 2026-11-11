//! Mobile's glue over `wallet_core::kms`, which owns key custody: it validates inputs before they
//! reach Krusty and re-checks outputs before they leave (the extension's
//! `packages/platform/kms-krusty/src/adapter.ts`). What stays here is Bramble's: the UniFFI shape
//! of the core's `Ladder` (which key tree an account walks), the import form's phrase
//! normalisation, and the OpenZeppelin account version this wallet deploys.
//!
//! Private keys are derived per call, held in the zeroizing `SecretFelt` (Krusty's, re-exported
//! by `wallet_core`), and never returned to a caller outside this crate.

use starknet_types_core::felt::Felt;
use wallet_core::{NetworkId, SecretFelt};
use zeroize::Zeroizing;

use crate::felt;
use crate::CoreError;

pub use wallet_core::{generate_mnemonic, validate_mnemonic, StarkSignature as Signature};

/// The OpenZeppelin account release this wallet deploys (the extension's `account-contract.ts`).
/// Named exactly, never Krusty's `latest`, so a Krusty bump cannot move an address.
pub const OZ_ACCOUNT_VERSION: &str = "3.0.0";

/// A felt the shared core returned as canonical text, back as a `Felt`.
fn parsed(text: &str, operation: &str) -> Result<Felt, CoreError> {
    felt::parse(text).ok_or_else(|| CoreError::Kms {
        operation: operation.into(),
    })
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

// The type is `wallet_core`'s; its UniFFI shape (and the docs the bindings carry) is declared
// here, and the names the vault stores are `account_store::stored_ladder`'s.
pub use wallet_core::accounts::Ladder;

/// Which key tree an account's index walks (the extension's issue 505). Each wallet app steps a
/// different field, so one index names a different key on each; an account record keeps the path
/// it was derived on, and every key is derived through it.
#[uniffi::remote(Enum)]
pub enum Ladder {
    /// This wallet's own ladder, `m/44'/9004'/index'/0/0`: the extension's `starknet-bip44` on
    /// the hardened account field. Every record written before vault version 5 is on it.
    Account,
    /// Braavos's ladder, `m/44'/9004'/0'/0/index`: `starknet-bip44` on the address field.
    Address,
    /// Ready (Argent X), the extension's `argentx-bip44`: the Ethereum key at `m/44'/60'/0'/0/0`
    /// seeds `m/44'/9004'/0'/0/index`. Ready takes no BIP-39 passphrase, so neither does this.
    ArgentX,
}

/// Derives the Starknet signing key at `index` on `path`. Every account key goes through here.
pub(crate) fn private_key(
    phrase: &str,
    passphrase: Option<&str>,
    path: Ladder,
    index: u32,
) -> Result<SecretFelt, CoreError> {
    Ok(wallet_core::account_key(phrase, passphrase, path, index)?)
}

/// The account public key at `index` on `path`, shared by every family on that coordinate. The
/// signing key is derived and dropped inside the shared core; only the public key leaves.
pub(crate) fn public_key(
    phrase: &str,
    passphrase: Option<&str>,
    path: Ladder,
    index: u32,
) -> Result<Felt, CoreError> {
    Ok(wallet_core::account_public_key(
        phrase, passphrase, path, index,
    )?)
}

/// The OpenZeppelin account class the wallet deploys: Krusty's manifest at `OZ_ACCOUNT_VERSION`.
pub fn oz_class_hash(network: NetworkId) -> Result<Felt, CoreError> {
    let class_hash = wallet_core::oz_account_class_hash(network, OZ_ACCOUNT_VERSION)?;
    parsed(&class_hash, "class hash")
}

/// Signs a message hash with deterministic RFC-6979 Stark ECDSA.
pub fn sign_hash(
    phrase: &str,
    passphrase: Option<&str>,
    path: Ladder,
    account_index: u32,
    message_hash: &str,
) -> Result<Signature, CoreError> {
    let key = private_key(phrase, passphrase, path, account_index)?;
    Ok(wallet_core::sign_stark_hash(&key, message_hash)?)
}

/// The account's STRK20 viewing key scoped to `"<chain_id>:<pool>"`, exactly as the extension's
/// adapter (`deriveStrk20ViewingKey`), zeroizing. The account key is derived per call into a
/// zeroizing `SecretFelt`; the shared core holds both scope values to canonical non-zero felts
/// and the result to a usable scalar.
pub(crate) fn scoped_viewing_key(
    phrase: &str,
    passphrase: Option<&str>,
    path: Ladder,
    account_index: u32,
    chain_id: &str,
    pool_address: &str,
) -> Result<SecretFelt, CoreError> {
    let key = private_key(phrase, passphrase, path, account_index)?;
    Ok(wallet_core::derive_strk20_viewing_key(
        &key,
        chain_id,
        pool_address,
    )?)
}

/// The public viewing key this wallet would register for one account in one pool
/// (`previewStrk20ViewingPublicKey`), so recovery can compare it with the key the pool holds.
/// The viewing key is derived inside this call and only its public x-coordinate leaves it.
pub fn scoped_viewing_public_key(
    phrase: &str,
    passphrase: Option<&str>,
    path: Ladder,
    account_index: u32,
    chain_id: &str,
    pool_address: &str,
) -> Result<Felt, CoreError> {
    let viewing_key = scoped_viewing_key(
        phrase,
        passphrase,
        path,
        account_index,
        chain_id,
        pool_address,
    )?;
    parsed(
        &wallet_core::stark_public_key(&viewing_key)?,
        "viewing public key",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const PHRASE: &str =
        "habit hope tip crystal because grunt nation idea electric witness alert like";

    #[test]
    fn the_bip39_passphrase_bound_is_the_extensions() {
        // 1,024 UTF-16 units (`wallet-model/preferences/passphrase.ts`), not bytes.
        let at_bound = "é".repeat(1_024);
        assert!(private_key(PHRASE, Some(&at_bound), Ladder::Account, 0).is_ok());
        let over = "p".repeat(1_025);
        assert!(matches!(
            private_key(PHRASE, Some(&over), Ladder::Account, 0),
            Err(CoreError::InvalidInput { .. })
        ));
        assert!(private_key(PHRASE, Some("p"), Ladder::ArgentX, 0).is_err());
    }

    #[test]
    fn the_oz_class_is_the_pinned_release_on_each_network() {
        for network in [NetworkId::Mainnet, NetworkId::Sepolia] {
            let pinned = wallet_core::oz_account_class_hash(network, OZ_ACCOUNT_VERSION).unwrap();
            assert_eq!(felt::canonical(&oz_class_hash(network).unwrap()), pinned);
        }
    }
}
