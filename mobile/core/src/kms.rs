//! Mobile's glue over `wallet_core::kms`, which owns key custody: it validates inputs before they
//! reach Krusty and re-checks outputs before they leave (the extension's
//! `packages/platform/kms-krusty/src/adapter.ts`). What stays here is Bramble's: which key tree an
//! account walks (`Ladder`), the import form's phrase normalisation, and the OpenZeppelin account
//! version this wallet deploys.
//!
//! Private keys are derived per call, held in Krusty's zeroizing `SecretFelt`, and never returned
//! to a caller outside this crate.

use krusty_kms_common::{ChainId, SecretFelt};
use serde::{Deserialize, Serialize};
use starknet_types_core::felt::Felt;
use zeroize::Zeroizing;

use crate::felt;
use crate::CoreError;

pub use wallet_core::{generate_mnemonic, validate_mnemonic, StarkSignature as Signature};

/// The OpenZeppelin account release this wallet deploys (the extension's `account-contract.ts`).
/// Named exactly, never Krusty's `latest`, so a Krusty bump cannot move an address.
pub const OZ_ACCOUNT_VERSION: &str = "3.0.0";

pub(crate) fn kms_error(context: &str) -> impl Fn(krusty_kms_common::KmsError) -> CoreError + '_ {
    // Krusty's messages can echo input; only the operation name crosses the boundary.
    move |_| CoreError::Kms {
        operation: context.to_string(),
    }
}

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

/// Which key tree an account's index walks (the extension's issue 505). Each wallet app steps a
/// different field, so one index names a different key on each; an account record keeps the path
/// it was derived on, and every key is derived through it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, uniffi::Enum)]
#[serde(rename_all = "kebab-case")]
pub enum Ladder {
    /// This wallet's own ladder, `m/44'/9004'/index'/0/0`: the extension's `starknet-bip44` on
    /// the hardened account field. Every record written before vault version 5 is on it.
    Account,
    /// Braavos's ladder, `m/44'/9004'/0'/0/index`: `starknet-bip44` on the address field.
    Address,
    /// Ready (Argent X), the extension's `argentx-bip44`: the Ethereum key at `m/44'/60'/0'/0/0`
    /// seeds `m/44'/9004'/0'/0/index`. Ready takes no BIP-39 passphrase, so neither does this.
    #[serde(rename = "argentx")]
    ArgentX,
}

impl Ladder {
    /// The extension's derivation kind, as its selection keys spell it.
    pub(crate) fn kind(self) -> &'static str {
        match self {
            Self::Account | Self::Address => "starknet-bip44",
            Self::ArgentX => "argentx-bip44",
        }
    }
}

/// Derives the Starknet signing key at `index` on `path`. Every account key goes through here.
pub(crate) fn private_key(
    phrase: &str,
    passphrase: Option<&str>,
    path: Ladder,
    index: u32,
) -> Result<SecretFelt, CoreError> {
    // The shared core's order is (address index, account index), as Krusty's.
    let key = match path {
        Ladder::Account => {
            wallet_core::derive_starknet_keypair(phrase, 0, index, passphrase)?.private_key
        }
        Ladder::Address => {
            wallet_core::derive_starknet_keypair(phrase, index, 0, passphrase)?.private_key
        }
        Ladder::ArgentX => {
            if passphrase.is_some() {
                return Err(CoreError::InvalidInput {
                    reason: "Ready accounts take no passphrase".into(),
                });
            }
            wallet_core::derive_argent_legacy_keypair(phrase, index)?.private_key
        }
    };
    Ok(key)
}

/// The OpenZeppelin account class the wallet deploys: Krusty's manifest at `OZ_ACCOUNT_VERSION`.
pub fn oz_class_hash(chain: ChainId) -> Result<Felt, CoreError> {
    let network = match chain {
        ChainId::Mainnet => wallet_core::NetworkId::Mainnet,
        ChainId::Sepolia => wallet_core::NetworkId::Sepolia,
    };
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

/// The account's STRK20 viewing key scoped to `"<chain_id>:<pool>"`, zeroizing. The shared core
/// holds both scope values to canonical non-zero felts and the result to a usable scalar.
fn scoped_viewing_key(
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

/// Derives the account's STRK20 viewing key scoped to `"<chain_id>:<pool>"`, exactly as the
/// extension's adapter (`deriveStrk20ViewingKey`). The account key is derived per call into a
/// zeroizing `SecretFelt`. The viewing key leaves as a plain `Felt`, which callers must use for
/// one request body and drop (mobile/docs/privacy.md §5, residual).
pub fn derive_scoped_viewing_key(
    phrase: &str,
    passphrase: Option<&str>,
    path: Ladder,
    account_index: u32,
    chain_id: &str,
    pool_address: &str,
) -> Result<Felt, CoreError> {
    scoped_viewing_key(
        phrase,
        passphrase,
        path,
        account_index,
        chain_id,
        pool_address,
    )
    .map(|key| *key.expose_secret())
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
        for (chain, network) in [
            (ChainId::Mainnet, wallet_core::NetworkId::Mainnet),
            (ChainId::Sepolia, wallet_core::NetworkId::Sepolia),
        ] {
            let pinned = wallet_core::oz_account_class_hash(network, OZ_ACCOUNT_VERSION).unwrap();
            assert_eq!(felt::canonical(&oz_class_hash(chain).unwrap()), pinned);
        }
    }
}
