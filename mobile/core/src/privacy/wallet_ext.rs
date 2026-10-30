//! The privacy `WalletCore` entry point and its crate-private viewing-key accessor, so `wallet.rs`
//! keeps only vault-security's session model. No I/O: the plan derives the viewing key per request
//! body, under the generation recorded here, from the vault record it names (never an index).

use std::sync::atomic::Ordering;
use std::sync::Arc;

use super::config;
use super::plan::{Discovery, PrivacyReadPlan, ReadState, Stage};
use super::types::PrivacyError;
use crate::networks;
use crate::wallet::WalletCore;
use crate::wallet_accounts::signing_record;
use crate::{felt, kms, CoreError};

impl WalletCore {
    /// Derives the scoped STRK20 viewing key of the record `account_id`, only while the session
    /// generation (`lock_epoch`) is still `generation` and the record still passes the signing gate
    /// (a known record in a vault not waiting for discovery, any family, as the extension's
    /// `deriveVaultStrk20ViewingKey`). Checked under the session mutex held for the whole derivation, so a lock cannot
    /// interleave; passive (never renews). `Err(CoreError::Locked)` otherwise. Never exported:
    /// the key goes straight into one request body (privacy/plan.rs).
    pub(crate) fn plan_viewing_key(
        &self,
        generation: u64,
        account_id: &str,
        chain_id: &str,
        pool_address: &str,
    ) -> Result<starknet_types_core::felt::Felt, CoreError> {
        self.with_session(false, |session| {
            if self.lock_epoch.load(Ordering::SeqCst) != generation {
                return Err(CoreError::Locked);
            }
            let payload = &session.payload;
            let record = signing_record(payload, account_id).map_err(|_| CoreError::Locked)?;
            kms::derive_scoped_viewing_key(
                &payload.mnemonic,
                payload.mnemonic_passphrase.as_deref(),
                record.ladder(),
                record.account_index,
                chain_id,
                pool_address,
            )
        })
    }
}

#[uniffi::export]
impl WalletCore {
    /// A private-balance read for the vault record `account_id` (on its own network). Requires an
    /// unlocked wallet and records the session generation, so a lock (even one followed by a new
    /// unlock) fails the plan `Locked` at its next derivation. `UnknownAccount` for a record that is
    /// missing; `NotConfigured` when the network has no plain
    /// routing: Sepolia today, and any network whose routing turns OHTTP on.
    pub fn prepare_privacy_read(
        self: Arc<Self>,
        account_id: String,
    ) -> Result<Arc<PrivacyReadPlan>, PrivacyError> {
        let (network, address, generation) = self
            .with_session(false, |session| {
                let payload = &session.payload;
                Ok(signing_record(payload, &account_id).map(|record| {
                    (
                        record.network(),
                        record.address.clone(),
                        self.lock_epoch.load(Ordering::SeqCst),
                    )
                }))
            })
            .map_err(|_| PrivacyError::Locked)?
            .map_err(|_| PrivacyError::UnknownAccount)?;
        let route = config::route_for(network).ok_or(PrivacyError::NotConfigured)?;
        let address = felt::parse_non_zero(&address).ok_or(PrivacyError::UnknownAccount)?;
        let limits = &config::routing().limits;
        let tokens = &networks::info(network).tokens;
        let state = ReadState {
            network,
            account_id,
            address,
            route,
            limits,
            tokens,
            requested: super::plan_steps::requested_token_keys(tokens, limits),
            generation,
            stage: Stage::Fresh,
            next_id: 0,
            attempt: 0,
            attempt_started_ms: 0,
            registered: false,
            discovery: Discovery::default(),
        };
        Ok(PrivacyReadPlan::new(&self, state))
    }
}
