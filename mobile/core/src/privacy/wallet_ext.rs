//! The privacy `WalletCore` entry point, in its own `#[uniffi::export]` block so `wallet.rs` only
//! gains the crate-private `plan_viewing_key` accessor. No I/O, no derivation: the plan derives the
//! viewing key per request body, under the generation recorded here.

use std::sync::Arc;

use super::config;
use super::plan::{Discovery, PrivacyReadPlan, ReadState, Stage};
use super::types::PrivacyError;
use crate::networks::{self, NetworkId};
use crate::wallet::WalletCore;
use crate::{felt, CoreError};

#[uniffi::export]
impl WalletCore {
    /// A private-balance read for one account. Requires an unlocked wallet and records the session
    /// generation, so a lock (even one followed by a new unlock) fails the plan `Locked` at its next
    /// derivation. `NotConfigured` when the network has no plain routing: Sepolia today, and any
    /// network whose routing turns OHTTP on.
    pub fn prepare_privacy_read(
        self: Arc<Self>,
        network: NetworkId,
        account_index: u32,
    ) -> Result<Arc<PrivacyReadPlan>, PrivacyError> {
        let route = config::route_for(network).ok_or(PrivacyError::NotConfigured)?;
        let (account, generation) =
            self.plan_account(account_index, network)
                .map_err(|error| match error {
                    CoreError::InvalidInput { .. } => PrivacyError::UnknownAccount,
                    _ => PrivacyError::Locked,
                })?;
        let address = felt::parse_non_zero(&account.address).ok_or(PrivacyError::UnknownAccount)?;
        let state = ReadState {
            network,
            account_index,
            address,
            route,
            limits: &config::routing().limits,
            tokens: &networks::info(network).tokens,
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
