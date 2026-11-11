//! Token tracking (`wallet_core::portfolio::tokens`, the extension's `settings/preferences.ts`
//! and the side panel's `isHiddenFromHome` / `compareStrkFirst`): the UniFFI shapes and the
//! `TokenPreferences` object, which holds the core's preferences over Bramble's catalogs behind a
//! lock. Identity, the registry and spam are `registry.rs`.

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use wallet_core::portfolio::tokens as port;
pub use wallet_core::portfolio::tokens::{AddTokenOutcome, HomeRows, TrackedToken};

use super::model::{DisplayCurrency, TokenBalance, TokenConfig};
pub use super::registry::{
    token_config_id, token_glyph, token_spam_reasons, SpamReason, TokenGlyph,
};
use crate::networks::{self, NetworkId};
use crate::CoreError;

/// A tracked token as the Tokens screen lists it.
#[uniffi::remote(Record)]
pub struct TrackedToken {
    pub token: TokenConfig,
    /// `isHiddenFromHome`: user-hidden or likely spam.
    pub hidden_from_home: bool,
    pub likely_spam: bool,
}

/// Home's token list: visible balances, STRK first, and the "N not shown" count.
#[uniffi::remote(Record)]
pub struct HomeRows {
    pub visible: Vec<TokenBalance>,
    pub not_shown: u32,
}

/// Result of adding a token: the stored config and whether spam heuristics hid it.
#[uniffi::remote(Record)]
pub struct AddTokenOutcome {
    pub token: TokenConfig,
    pub hidden_as_spam: bool,
}

/// Tracked tokens, hidden ids, display currency and the explorer-lane choice
/// (`preferences.json`). An unreadable file reads as the extension's defaults; a file from a newer
/// app (unknown schema) also reads as defaults but is never overwritten (`persisted` is `None`),
/// so a downgrade cannot destroy the user's token choices.
#[derive(uniffi::Object)]
pub struct TokenPreferences {
    prefs: Mutex<port::TokenPreferences<'static>>,
}

impl TokenPreferences {
    fn prefs(&self) -> MutexGuard<'_, port::TokenPreferences<'static>> {
        self.prefs.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[uniffi::export]
impl TokenPreferences {
    #[uniffi::constructor]
    pub fn new(persisted: Option<String>) -> Arc<Self> {
        Arc::new(Self {
            prefs: Mutex::new(port::TokenPreferences::new(
                persisted,
                networks::catalogs(),
                super::PORTFOLIO_POLICY,
            )),
        })
    }

    /// Tracked tokens on one network, in stored order (`tokensFlow`).
    pub fn tracked(&self, network: NetworkId) -> Vec<TrackedToken> {
        self.prefs().tracked(network)
    }

    /// The tracked tokens on `network` the Send review treats as known token contracts
    /// (`trustedTokens`): every one except those the spam heuristic flags. Pass to
    /// `TransferRequest.tracked_tokens`.
    pub fn trusted_token_addresses(&self, network: NetworkId) -> Vec<String> {
        self.prefs().trusted_token_addresses(network)
    }

    /// `setTokenHidden`.
    pub fn set_hidden(&self, token_id: String, hidden: bool) -> Result<(), CoreError> {
        Ok(self.prefs().set_hidden(token_id, hidden)?)
    }

    /// `upsertToken` then, for a likely-spam token, `setTokenHidden(true)` (`handleAddToken`).
    pub fn add(&self, token: TokenConfig) -> Result<AddTokenOutcome, CoreError> {
        Ok(self.prefs().add(token)?)
    }

    /// `visibleHomeBalances` sorted by `compareStrkFirst`, and the "N not shown" count.
    pub fn home_rows(&self, balances: Vec<TokenBalance>) -> HomeRows {
        self.prefs().home_rows(balances)
    }

    pub fn display_currency(&self) -> DisplayCurrency {
        self.prefs().display_currency()
    }

    pub fn set_display_currency(&self, currency: DisplayCurrency) {
        self.prefs().set_display_currency(currency);
    }

    /// Registry tokens not yet tracked on the network (`handleDetectTokens`' candidates).
    pub fn discovery_candidates(&self, network: NetworkId) -> Vec<TokenConfig> {
        self.prefs().discovery_candidates(network)
    }

    /// `explorerFallbackAllowed`: the stored choice, else allowed (mobile has no RPC override).
    pub fn explorer_fallback_allowed(&self, network: NetworkId) -> bool {
        self.prefs().explorer_fallback_allowed(network)
    }

    /// Whether the stored file came from a newer app and must not be overwritten.
    pub fn read_only(&self) -> bool {
        self.prefs().read_only()
    }

    /// The `preferences.json` document, or `None` when the file must be left untouched.
    pub fn persisted(&self) -> Option<String> {
        self.prefs().persisted()
    }
}
