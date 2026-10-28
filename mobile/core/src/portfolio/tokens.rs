//! Token tracking, ported from `settings/preferences.ts` (`upsertToken`, `setTokenHidden`,
//! the defaults) and the side panel's `isHiddenFromHome` / `compareStrkFirst`; identity, the
//! registry and spam live in `registry.rs`. Tracked tokens, hidden ids,
//! the display currency and the explorer-lane choice persist per network in `preferences.json`.

use std::sync::Mutex;

use serde_json::{json, Map, Value};

use super::model::{network_code, network_from_code, DisplayCurrency, TokenBalance, TokenConfig};
pub use super::registry::{
    is_token_config, known_tokens, spam_reasons, token_config_id, token_glyph, token_spam_reasons,
    SpamReason, TokenGlyph,
};
pub(crate) use super::registry::{
    is_token_name, is_token_symbol, normalize_token_symbol, starknet_glyph, strk_address,
    with_token_id,
};
use crate::js::felt::same_felt;
use crate::js::json::{self, JsValue};
use crate::js::num::utf16_len;
use crate::networks::{self, NetworkId};
use crate::CoreError;

/// A tracked token as the Tokens screen lists it.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct TrackedToken {
    pub token: TokenConfig,
    /// `isHiddenFromHome`: user-hidden or likely spam.
    pub hidden_from_home: bool,
    pub likely_spam: bool,
}

/// Home's token list: visible balances, STRK first, and the "N not shown" count.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct HomeRows {
    pub visible: Vec<TokenBalance>,
    pub not_shown: u32,
}

/// Result of adding a token: the stored config and whether spam heuristics hid it.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct AddTokenOutcome {
    pub token: TokenConfig,
    pub hidden_as_spam: bool,
}

#[derive(Debug, Clone)]
struct Prefs {
    tokens: Vec<TokenConfig>,
    hidden: Vec<String>,
    currency: DisplayCurrency,
    explorer_fallback: Vec<(NetworkId, bool)>,
}

impl Prefs {
    fn defaults() -> Self {
        let tokens = [NetworkId::Mainnet, NetworkId::Sepolia]
            .into_iter()
            .flat_map(|network| {
                networks::info(network).tokens.iter().map(move |t| {
                    with_token_id(network, &t.address, &t.symbol, &t.name, t.decimals)
                })
            })
            .collect();
        Self {
            tokens,
            hidden: Vec::new(),
            currency: DisplayCurrency::Usd,
            explorer_fallback: Vec::new(),
        }
    }

    fn hidden_from_home(&self, token: &TokenConfig) -> bool {
        self.hidden.contains(&token.id) || !token_spam_reasons(token.clone()).is_empty()
    }
}

pub(crate) fn parse_token(value: &JsValue) -> Option<TokenConfig> {
    let keys = ["address", "decimals", "id", "name", "networkId", "symbol"];
    if !value
        .as_object()?
        .iter()
        .all(|(k, _)| keys.contains(&k.as_str()))
    {
        return None;
    }
    let decimals = value.get("decimals")?.as_f64()?;
    if decimals.fract() != 0.0 || !(0.0..=36.0).contains(&decimals) {
        return None;
    }
    let token = TokenConfig {
        id: value.get("id")?.as_str()?.to_string(),
        network: network_from_code(value.get("networkId")?.as_str()?)?,
        address: value.get("address")?.as_str()?.to_string(),
        symbol: value.get("symbol")?.as_str()?.to_string(),
        name: value.get("name")?.as_str()?.to_string(),
        decimals: decimals as u8,
    };
    is_token_config(&token).then_some(token)
}

fn is_token_id(id: &str) -> bool {
    (1..=200).contains(&utf16_len(id))
}

fn parse_prefs(value: &JsValue) -> Option<Prefs> {
    let tokens = value
        .get("tokens")?
        .as_array()?
        .iter()
        .map(parse_token)
        .collect::<Option<Vec<_>>>()?;
    let hidden: Vec<String> = value
        .get("hiddenTokens")?
        .as_array()?
        .iter()
        .map(|v| v.as_str().filter(|s| is_token_id(s)).map(str::to_string))
        .collect::<Option<_>>()?;
    let unique = hidden
        .iter()
        .enumerate()
        .all(|(i, id)| !hidden[..i].contains(id));
    let currency = DisplayCurrency::from_code(value.get("displayCurrency")?.as_str()?)?;
    let mut explorer_fallback = Vec::new();
    for (key, allowed) in value.get("explorerFallback")?.as_object()? {
        let JsValue::Bool(allowed) = allowed else {
            return None;
        };
        explorer_fallback.push((network_from_code(key)?, *allowed));
    }
    unique.then_some(Prefs {
        tokens,
        hidden,
        currency,
        explorer_fallback,
    })
}

/// Tracked tokens, hidden ids, display currency and the explorer-lane choice
/// (`preferences.json`). An unreadable file reads as the extension's defaults; a file from a newer
/// app (unknown schema) also reads as defaults but is never overwritten (`persisted` is `None`),
/// so a downgrade cannot destroy the user's token choices.
#[derive(uniffi::Object)]
pub struct TokenPreferences {
    prefs: Mutex<Prefs>,
    read_only: bool,
}

impl TokenPreferences {
    fn prefs(&self) -> std::sync::MutexGuard<'_, Prefs> {
        self.prefs
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

#[uniffi::export]
impl TokenPreferences {
    #[uniffi::constructor]
    pub fn new(persisted: Option<String>) -> std::sync::Arc<Self> {
        let doc = persisted.as_deref().and_then(json::parse);
        let schema = doc
            .as_ref()
            .and_then(|d| d.get("schema"))
            .and_then(JsValue::as_str);
        let read_only = doc.is_some() && schema != Some(super::SCHEMA);
        let prefs = doc
            .as_ref()
            .filter(|_| !read_only)
            .and_then(parse_prefs)
            .unwrap_or_else(Prefs::defaults);
        std::sync::Arc::new(Self {
            prefs: Mutex::new(prefs),
            read_only,
        })
    }

    /// Tracked tokens on one network, in stored order (`tokensFlow`).
    pub fn tracked(&self, network: NetworkId) -> Vec<TrackedToken> {
        let prefs = self.prefs();
        prefs
            .tokens
            .iter()
            .filter(|t| t.network == network)
            .map(|t| TrackedToken {
                token: t.clone(),
                hidden_from_home: prefs.hidden_from_home(t),
                likely_spam: !token_spam_reasons(t.clone()).is_empty(),
            })
            .collect()
    }

    /// `setTokenHidden`.
    pub fn set_hidden(&self, token_id: String, hidden: bool) -> Result<(), CoreError> {
        if !is_token_id(&token_id) {
            return Err(CoreError::InvalidInput {
                reason: "Invalid token".into(),
            });
        }
        let mut prefs = self.prefs();
        if !hidden {
            prefs.hidden.retain(|id| *id != token_id);
        } else if !prefs.hidden.contains(&token_id) {
            prefs.hidden.push(token_id);
        }
        Ok(())
    }

    /// `upsertToken` then, for a likely-spam token, `setTokenHidden(true)` (`handleAddToken`).
    pub fn add(&self, token: TokenConfig) -> Result<AddTokenOutcome, CoreError> {
        let token = with_token_id(
            token.network,
            &token.address,
            &token.symbol,
            &token.name,
            token.decimals,
        );
        if !is_token_config(&token) {
            return Err(CoreError::InvalidInput {
                reason: "Invalid token".into(),
            });
        }
        let spam = !token_spam_reasons(token.clone()).is_empty();
        let mut prefs = self.prefs();
        prefs.tokens.retain(|t| t.id != token.id);
        prefs.tokens.push(token.clone());
        if spam && !prefs.hidden.contains(&token.id) {
            prefs.hidden.push(token.id.clone());
        }
        Ok(AddTokenOutcome {
            token,
            hidden_as_spam: spam,
        })
    }

    /// `visibleHomeBalances` sorted by `compareStrkFirst`, and the "N not shown" count.
    pub fn home_rows(&self, balances: Vec<TokenBalance>) -> HomeRows {
        let prefs = self.prefs();
        let total = balances.len();
        let mut visible: Vec<TokenBalance> = balances
            .into_iter()
            .filter(|b| match prefs.tokens.iter().find(|t| t.id == b.token.id) {
                Some(token) => !prefs.hidden_from_home(token),
                None => true,
            })
            .collect();
        let strk = strk_address();
        visible.sort_by_key(|b| !same_felt(&b.token.address, strk));
        HomeRows {
            not_shown: (total - visible.len()) as u32,
            visible,
        }
    }

    pub fn display_currency(&self) -> DisplayCurrency {
        self.prefs().currency
    }

    pub fn set_display_currency(&self, currency: DisplayCurrency) {
        self.prefs().currency = currency;
    }

    /// Registry tokens not yet tracked on the network (`handleDetectTokens`' candidates).
    pub fn discovery_candidates(&self, network: NetworkId) -> Vec<TokenConfig> {
        let prefs = self.prefs();
        known_tokens(network)
            .into_iter()
            .filter(|known| {
                !prefs
                    .tokens
                    .iter()
                    .any(|t| t.network == network && same_felt(&t.address, &known.address))
            })
            .collect()
    }

    /// `explorerFallbackAllowed`: the stored choice, else allowed (mobile has no RPC override).
    pub fn explorer_fallback_allowed(&self, network: NetworkId) -> bool {
        self.prefs()
            .explorer_fallback
            .iter()
            .find(|(n, _)| *n == network)
            .is_none_or(|(_, allowed)| *allowed)
    }

    /// Whether the stored file came from a newer app and must not be overwritten.
    pub fn read_only(&self) -> bool {
        self.read_only
    }

    /// The `preferences.json` document, or `None` when the file must be left untouched.
    pub fn persisted(&self) -> Option<String> {
        if self.read_only {
            return None;
        }
        let prefs = self.prefs();
        let tokens: Vec<Value> = prefs
            .tokens
            .iter()
            .map(|t| {
                json!({ "address": t.address, "decimals": t.decimals, "id": t.id, "name": t.name,
                        "networkId": network_code(t.network), "symbol": t.symbol })
            })
            .collect();
        let fallback: Map<String, Value> = prefs
            .explorer_fallback
            .iter()
            .map(|(n, allowed)| (network_code(*n).to_string(), Value::Bool(*allowed)))
            .collect();
        Some(
            json!({ "schema": super::SCHEMA, "tokens": tokens, "hiddenTokens": prefs.hidden,
                    "displayCurrency": prefs.currency.code(), "explorerFallback": fallback })
            .to_string(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_and_round_trip() {
        let prefs = TokenPreferences::new(None);
        assert_eq!(prefs.tracked(NetworkId::Mainnet).len(), 2);
        let doc = prefs.persisted().unwrap();
        let again = TokenPreferences::new(Some(doc.clone()));
        assert_eq!(again.persisted().unwrap(), doc);
        let newer =
            TokenPreferences::new(Some(r#"{"schema":"bramble.mobile.portfolio.v9"}"#.into()));
        assert!(newer.read_only());
        assert_eq!(newer.persisted(), None);
    }

    #[test]
    fn spam_is_hidden_on_add() {
        let prefs = TokenPreferences::new(None);
        let fake = with_token_id(NetworkId::Mainnet, "0x1234", "USDC", "USD Coin", 6);
        let outcome = prefs.add(fake).unwrap();
        assert!(outcome.hidden_as_spam);
        assert!(prefs
            .tracked(NetworkId::Mainnet)
            .iter()
            .any(|t| t.likely_spam && t.hidden_from_home));
    }
}
