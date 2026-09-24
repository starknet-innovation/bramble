//! The send path's `WalletCore` entry points, in a second `#[uniffi::export]` block so
//! `wallet.rs` only gains small accessors. Every input is untrusted and validated here, before a
//! plan exists; nothing here does I/O except reading the local activity file.

use std::sync::Arc;

use starknet_types_core::felt::Felt;

use super::calls;
use super::plan::{network_id_text, Account, Kind, Transfer, TransferPlan};
use super::types::{ActivityRecord, SendError, TransferRequest};
use super::u256::U256;
use crate::activity::store;
use crate::networks::{self, NetworkId};
use crate::wallet::WalletCore;
use crate::{felt, CoreError};

fn account_error(error: CoreError) -> SendError {
    match error {
        CoreError::InvalidInput { .. } => SendError::UnknownAccount,
        _ => SendError::Locked,
    }
}

impl WalletCore {
    fn plan_account_for(
        &self,
        network: NetworkId,
        index: u32,
    ) -> Result<(Account, u64), SendError> {
        let (info, generation) = self.plan_account(index, network).map_err(account_error)?;
        let parse = |value: &str| felt::parse_non_zero(value).ok_or(SendError::UnknownAccount);
        let address = parse(&info.address)?;
        Ok((
            Account {
                network,
                index,
                address,
                public_key: parse(&info.public_key)?,
                class_hash: parse(&info.class_hash)?,
                account_id: format!("{}:{}", network_id_text(network), felt::canonical(&address)),
            },
            generation,
        ))
    }
}

#[uniffi::export]
impl WalletCore {
    /// Validates and canonicalises a transfer and returns its plan. Requires an unlocked wallet;
    /// records the session generation so a lock (even one followed by a new unlock) voids it.
    /// Refuses a token that is not bundled for the network, an unparseable or zero recipient,
    /// and an amount the extension would refuse or no ERC-20 could carry.
    pub fn prepare_transfer(
        self: Arc<Self>,
        request: TransferRequest,
    ) -> Result<Arc<TransferPlan>, SendError> {
        let catalog = networks::info(request.network);
        let requested =
            calls::validate_recipient(&request.token_address).ok_or(SendError::UnknownToken)?;
        let token = catalog
            .tokens
            .iter()
            .find(|token| felt::parse(&token.address) == Some(requested))
            .ok_or(SendError::UnknownToken)?;
        let recipient = calls::validate_recipient(&request.recipient)
            .filter(|recipient| *recipient != Felt::ZERO)
            .ok_or(SendError::InvalidRecipient)?;
        let amount = calls::parse_token_amount(&request.amount, token.decimals)
            .map_err(|reason| SendError::InvalidAmount { reason })?;
        let calldata = calls::transfer_execute_calldata(&requested, &recipient, &amount)
            .ok_or(SendError::InvalidRecipient)?;
        let (account, generation) =
            self.plan_account_for(request.network, request.account_index)?;
        let transfer = Transfer {
            symbol: token.symbol.clone(),
            is_strk: token.symbol == "STRK",
            recipient,
            amount,
            amount_text: request.amount.trim().to_string(),
            summary: calls::transfer_summary(&amount, token.decimals, &token.symbol, &recipient),
            flags: calls::transfer_flags(&recipient, &account.address),
            calldata,
            fee_balance: request.fee_balance.as_deref().and_then(U256::from_decimal),
        };
        Ok(TransferPlan::new(
            &self,
            account,
            Kind::Transfer(Box::new(transfer)),
            generation,
        ))
    }

    /// The standalone Deploy account flow for the home chip: the same machine without the invoke.
    pub fn prepare_deployment(
        self: Arc<Self>,
        network: NetworkId,
        account_index: u32,
    ) -> Result<Arc<TransferPlan>, SendError> {
        let (account, generation) = self.plan_account_for(network, account_index)?;
        Ok(TransferPlan::new(
            &self,
            account,
            Kind::Deployment,
            generation,
        ))
    }

    /// Local activity for one account on one network, newest first. Requires an unlocked wallet
    /// (the account address is derived from the phrase).
    pub fn activity(
        &self,
        network: NetworkId,
        account_index: u32,
    ) -> Result<Vec<ActivityRecord>, SendError> {
        let (account, _) = self.plan_account_for(network, account_index)?;
        Ok(store::list(self.data_dir(), &account.account_id)
            .into_iter()
            .filter_map(|entry| {
                Some(ActivityRecord {
                    explorer_url: super::explorer_transaction_url(network, entry.hash.clone()),
                    kind: store::parse_kind(&entry.kind)?,
                    status: store::parse_status(&entry.status)?,
                    hash: entry.hash,
                    summary: entry.summary,
                    amount: entry.amount,
                    counterparty: entry.counterparty,
                    token: entry.token,
                    submitted_at_ms: entry.submitted_at,
                })
            })
            .collect())
    }

    /// A plan that reads one recorded transaction's status and settles its record; never signs.
    pub fn refresh_activity(
        self: Arc<Self>,
        network: NetworkId,
        account_index: u32,
        hash: String,
    ) -> Result<Arc<TransferPlan>, SendError> {
        let (account, generation) = self.plan_account_for(network, account_index)?;
        let hash = felt::parse_non_zero(&hash).ok_or(SendError::UnknownTransaction)?;
        let known = store::list(self.data_dir(), &account.account_id)
            .iter()
            .any(|entry| felt::parse(&entry.hash) == Some(hash));
        if !known {
            return Err(SendError::UnknownTransaction);
        }
        Ok(TransferPlan::new(
            &self,
            account,
            Kind::Refresh { hash },
            generation,
        ))
    }
}
