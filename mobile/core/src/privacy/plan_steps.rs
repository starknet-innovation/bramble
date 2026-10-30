//! Reply handling for `PrivacyReadPlan` (docs/privacy.md §3, "Retries and budgets"):
//!
//! - discovery replies are judged against the 60 s budget of the current attempt first, then a
//!   non-2xx is retried only when its body matches the extension's pattern (`attempt × 1 s`),
//!   restarting note discovery from page one;
//! - a later discovery page must echo the `block_ref` pinned from the first (deviation 2) and the
//!   read stops after `MAX_DISCOVERY_PAGES` (deviation 3);
//! - the pool fee is retried on `-32005` or matching text.

use std::collections::BTreeSet;

use super::bodies::{self, INCOMING_PATH, PREFLIGHT_PATH};
use super::config::Limits;
use super::judge::{self, FeeAnswer};
use super::notes::cursor_complete;
use super::plan::{Read, ReadState, Stage, MAX_DISCOVERY_PAGES};
use super::types::{
    PrivacyFailure, PrivacyPurpose, PrivacyRegistration, PrivacyState, PrivacyStep, PrivateBalance,
};
use crate::networks::TokenInfo;
use crate::send::judge::{answer, chain, ChainAnswer};
use crate::send::u256::U256;
use crate::wallet::WalletCore;
use crate::{felt, networks, rpc};

/// The extension's `readRequestedTokens`, then the `balancesFrom` length cap.
///
/// `None` when `tokens` is longer than `limits.tokens` or `limits.balances`, an address is zero
/// or not a canonical non-zero felt (the same rule the catalog loader uses, so a bad entry is
/// refused rather than dropped), or an address repeats. The set is the numeric key `finish`
/// reads back for each token.
pub(crate) fn requested_token_keys(
    tokens: &[TokenInfo],
    limits: &Limits,
) -> Option<BTreeSet<U256>> {
    if tokens.len() > limits.tokens || tokens.len() > limits.balances {
        return None;
    }
    let mut keys = BTreeSet::new();
    for token in tokens {
        let address = felt::parse_non_zero(&token.address)?;
        let key = super::json::js_bigint(&super::json::Ordered::Str(felt::canonical(&address)))?;
        if !keys.insert(key) {
            return None;
        }
    }
    Some(keys)
}

pub(crate) fn purpose(read: Read) -> PrivacyPurpose {
    match read {
        Read::Chain => PrivacyPurpose::ChainId,
        Read::Preflight => PrivacyPurpose::PreflightCheck,
        Read::Discovery => PrivacyPurpose::IncomingState,
        Read::PoolFee => PrivacyPurpose::PoolFee,
    }
}

impl ReadState {
    fn viewing_key(&self, core: &WalletCore) -> Option<starknet_types_core::felt::Felt> {
        let chain_id = &networks::info(self.network).chain_id;
        let pool = felt::canonical(&self.route.pool);
        core.plan_viewing_key(self.generation, &self.account_id, chain_id, &pool)
            .ok()
    }

    fn post(&mut self, read: Read, path: &str, body: zeroize::Zeroizing<Vec<u8>>) -> PrivacyStep {
        let id = self.next_id();
        self.stage = Stage::Awaiting { id, read };
        PrivacyStep::Post {
            id,
            url: format!("{}{path}", self.route.discovery_url),
            // The only copy that leaves the zeroizing buffer: it becomes the FFI body.
            body: body.to_vec(),
            purpose: purpose(read),
        }
    }

    pub(crate) fn post_preflight(&mut self, core: &WalletCore) -> PrivacyStep {
        let Some(token) = self
            .tokens
            .first()
            .and_then(|t| felt::parse_non_zero(&t.address))
        else {
            return self.fail(PrivacyFailure::NotConfigured);
        };
        let Some(key) = self.viewing_key(core) else {
            return self.fail(PrivacyFailure::Locked);
        };
        let body = bodies::preflight(&self.route.pool, &self.address, &key, &token);
        self.post(Read::Preflight, PREFLIGHT_PATH, body)
    }

    pub(crate) fn post_incoming(&mut self, core: &WalletCore) -> PrivacyStep {
        let Some(key) = self.viewing_key(core) else {
            return self.fail(PrivacyFailure::Locked);
        };
        let page = match (&self.discovery.cursor, &self.discovery.block) {
            (Some(cursor), Some(block)) => Some((cursor, block)),
            _ => None,
        };
        let body = bodies::incoming(&self.route.pool, &self.address, &key, page);
        self.post(Read::Discovery, INCOMING_PATH, body)
    }

    fn over_budget(&self, now_ms: u64) -> bool {
        now_ms.saturating_sub(self.attempt_started_ms) >= self.limits.discovery_budget_ms
    }

    pub(crate) fn on_http(
        &mut self,
        core: &WalletCore,
        read: Read,
        status: u16,
        body: &[u8],
        now_ms: u64,
    ) -> PrivacyStep {
        if self.over_budget(now_ms) {
            return self.fail(PrivacyFailure::BudgetExceeded);
        }
        if !(200..300).contains(&status) {
            let text = String::from_utf8_lossy(&body[..body.len().min(judge::MAX_RESPONSE_BYTES)]);
            if judge::matches_retry(&text) {
                return self.retry_or(read, PrivacyFailure::RateLimited);
            }
            return self.fail(if status == 409 {
                PrivacyFailure::Reorg
            } else {
                PrivacyFailure::ServiceUnavailable
            });
        }
        let Some(reply) = judge::parse_body(body) else {
            return self.fail(PrivacyFailure::InvalidResponse);
        };
        match read {
            Read::Preflight => match judge::preflight_registered(&reply) {
                Some(true) => {
                    self.registered = true;
                    self.begin(core, Read::Discovery, now_ms)
                }
                Some(false) => self.begin(core, Read::PoolFee, now_ms),
                None => self.fail(PrivacyFailure::InvalidResponse),
            },
            _ => self.on_page(core, reply, now_ms),
        }
    }

    fn on_page(
        &mut self,
        core: &WalletCore,
        reply: super::json::Ordered,
        now_ms: u64,
    ) -> PrivacyStep {
        let Some(block) = judge::block_ref(&reply) else {
            return self.fail(PrivacyFailure::InvalidResponse);
        };
        // Pinned from the first page; every later page must answer from the same block.
        if self
            .discovery
            .block
            .as_ref()
            .is_some_and(|pinned| *pinned != block)
        {
            return self.fail(PrivacyFailure::InvalidResponse);
        }
        let Some(requested) = self.requested.as_ref() else {
            return self.fail(PrivacyFailure::NotConfigured);
        };
        if self
            .discovery
            .totals
            .fold_page(&reply, self.limits, requested)
            .is_none()
        {
            return self.fail(PrivacyFailure::InvalidResponse);
        }
        let Some(cursor) = reply.get("cursor").cloned() else {
            return self.fail(PrivacyFailure::InvalidResponse);
        };
        let Some(complete) = cursor_complete(&cursor) else {
            return self.fail(PrivacyFailure::InvalidResponse);
        };
        self.discovery.pages += 1;
        self.discovery.block = Some(block);
        if complete {
            return self.begin(core, Read::PoolFee, now_ms);
        }
        if self.discovery.pages >= MAX_DISCOVERY_PAGES {
            return self.fail(PrivacyFailure::InvalidResponse);
        }
        self.discovery.cursor = Some(cursor);
        self.post_incoming(core)
    }

    pub(crate) fn on_rpc(
        &mut self,
        core: &WalletCore,
        read: Read,
        id: u64,
        body: &str,
        now_ms: u64,
    ) -> PrivacyStep {
        match read {
            Read::Chain => match chain(answer(body, id), self.network) {
                ChainAnswer::Match => self.begin(core, Read::Preflight, now_ms),
                ChainAnswer::Mismatch => self.fail(PrivacyFailure::WrongChain),
                ChainAnswer::Unreadable => self.fail(PrivacyFailure::RpcUnavailable),
            },
            _ => match judge::pool_fee(body, id, self.limits.max_pool_fee) {
                FeeAnswer::Fee(fee) => self.finish(fee),
                FeeAnswer::Retryable => {
                    self.retry_or(Read::PoolFee, PrivacyFailure::PoolReadFailed)
                }
                FeeAnswer::Failed => self.fail(PrivacyFailure::PoolReadFailed),
            },
        }
    }

    pub(crate) fn on_transport_failure(&mut self, read: Read, now_ms: u64) -> PrivacyStep {
        match read {
            Read::Chain => self.fail(PrivacyFailure::RpcUnavailable),
            Read::PoolFee => self.fail(PrivacyFailure::PoolReadFailed),
            Read::Preflight | Read::Discovery if self.over_budget(now_ms) => {
                self.fail(PrivacyFailure::BudgetExceeded)
            }
            Read::Preflight | Read::Discovery => self.fail(PrivacyFailure::ServiceUnavailable),
        }
    }

    fn finish(&mut self, fee: u128) -> PrivacyStep {
        let balances = if self.registered {
            let mut balances = Vec::with_capacity(self.tokens.len());
            for token in self.tokens {
                let Some(address) = felt::parse_non_zero(&token.address) else {
                    return self.fail(PrivacyFailure::NotConfigured);
                };
                let key =
                    super::json::js_bigint(&super::json::Ordered::Str(felt::canonical(&address)));
                let total = key
                    .map(|k| self.discovery.totals.total(&k))
                    .unwrap_or_default();
                let balance = total.to_decimal();
                let formatted = rpc::format_amount(&balance, token.decimals, token.decimals)
                    .unwrap_or_else(|_| "0".into());
                balances.push(PrivateBalance {
                    token_address: token.address.clone(),
                    symbol: token.symbol.clone(),
                    decimals: token.decimals,
                    balance,
                    formatted,
                });
            }
            balances
        } else {
            Vec::new()
        };
        self.stage = Stage::Closed;
        PrivacyStep::Finished {
            state: PrivacyState {
                network: self.network,
                account_id: self.account_id.clone(),
                registration: if self.registered {
                    PrivacyRegistration::Registered
                } else {
                    PrivacyRegistration::Unregistered
                },
                balances,
                pool_fee_fri: format!("{fee:#x}"),
                pool_address: self.route.pool_address.clone(),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::super::bodies::BlockRef;
    use super::super::config::Limits;
    use super::super::plan::MAX_DISCOVERY_PAGES;
    use super::*;
    use crate::networks::{self, NetworkId, TokenInfo};
    use crate::send::u256::U256;

    fn token(address: &str) -> TokenInfo {
        TokenInfo {
            address: address.to_owned(),
            decimals: 18,
            name: "Token".into(),
            symbol: "T".into(),
        }
    }

    fn limits(tokens: usize, balances: usize) -> Limits {
        Limits {
            tokens,
            balances,
            ..super::super::config::routing().limits.clone()
        }
    }

    #[test]
    fn purposes_are_stable() {
        assert_eq!(purpose(Read::Discovery), PrivacyPurpose::IncomingState);
        assert_eq!(MAX_DISCOVERY_PAGES, 256);
        // The block type is shared with the body writer, so the echo is the value first seen.
        assert_ne!(BlockRef::Number(1), BlockRef::Text("1".into()));
    }

    #[test]
    fn a_requested_token_list_the_extension_rejects_is_refused() {
        let wide = limits(64, 64);
        let accepted = requested_token_keys(&[token("0x1"), token("0xa")], &wide).unwrap();
        assert_eq!(
            accepted,
            BTreeSet::from([U256::from_u128(1), U256::from_u128(10)])
        );
        // Length is the list's, against both caps: `readRequestedTokens` uses `tokens`,
        // `balancesFrom` uses `balances`.
        let three = [token("0x1"), token("0x2"), token("0x3")];
        assert!(requested_token_keys(&three, &limits(2, 64)).is_none());
        assert!(requested_token_keys(&three, &limits(64, 2)).is_none());
        assert!(requested_token_keys(&[token("0x0")], &wide).is_none());
        assert!(requested_token_keys(&[token("not-a-token")], &wide).is_none());
        // Non-canonical spelling used to be dropped and the read continued until `finish`.
        assert!(requested_token_keys(&[token("0x1"), token("0x01")], &wide).is_none());
        assert!(requested_token_keys(&[token("0x1"), token("0x1")], &wide).is_none());
    }

    #[test]
    fn the_bundled_catalog_is_a_list_the_extension_would_accept() {
        let limits = super::super::config::routing().limits.clone();
        for network in [NetworkId::Mainnet, NetworkId::Sepolia] {
            let tokens = &networks::info(network).tokens;
            let keys = requested_token_keys(tokens, &limits).expect("bundled tokens");
            assert_eq!(keys.len(), tokens.len());
            assert!(!tokens.is_empty());
        }
    }
}
