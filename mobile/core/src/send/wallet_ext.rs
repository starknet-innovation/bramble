//! The send path's `WalletCore` entry points, in a second `#[uniffi::export]` block, and the
//! plan's session accessors, so `wallet.rs` keeps only vault-security's session model. Every input
//! is untrusted and validated here, before a plan exists; nothing here does I/O except reading
//! the local activity file. Plans name their account by vault record id and every signature
//! passes `wallet_accounts::signing_record`.

use std::sync::atomic::Ordering;
use std::sync::Arc;

use starknet_types_core::felt::Felt;

use super::calls;
use super::plan::{Account, Kind, Transfer, TransferPlan};
use super::types::{SendError, TransferRequest};
use super::u256::U256;
use crate::account_store::StoredAccount;
use crate::activity::{observation, store};
use crate::history::activity::ActivityEntry;
use crate::networks;
use crate::wallet::WalletCore;
use crate::wallet_accounts::{sign_for, signing_record, SignRefusal};
use crate::{felt, kms, CoreError};

impl From<SignRefusal> for SendError {
    fn from(refusal: SignRefusal) -> Self {
        match refusal {
            SignRefusal::Unknown => SendError::UnknownAccount,
            SignRefusal::ViewOnly => SendError::ViewOnlyAccount,
            SignRefusal::Unsupported => SendError::UnsupportedAccount,
        }
    }
}

/// What a plan needs the account for: signing (transfer, deployment) passes the signing gate;
/// reading activity only needs the record to exist.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Use {
    Sign,
    Read,
}

fn plan_account(record: &StoredAccount) -> Result<Account, SendError> {
    let parse = |value: &str| felt::parse_non_zero(value).ok_or(SendError::UnknownAccount);
    Ok(Account {
        network: record.network(),
        address: parse(&record.address)?,
        public_key: parse(&record.public_key)?,
        class_hash: parse(&record.class_hash)?,
        account_id: record.id.clone(),
    })
}

/// The plan's view of vault-security's session (`wallet.rs`): the generation is `lock_epoch`, read
/// and checked only through `with_session`, so the idle lock applies and the check happens under
/// the same session mutex every lock, idle lock and new session advances it under.
impl WalletCore {
    /// The current session generation (`lock_epoch`), or `None` while locked. Passive.
    pub(crate) fn session_generation(&self) -> Option<u64> {
        self.with_session(false, |_| Ok(self.lock_epoch.load(Ordering::SeqCst)))
            .ok()
    }

    /// The stored record `account_id` names plus the session generation, for a plan being
    /// prepared. A signing plan must pass `signing_record` (no view-only or Argent record, no
    /// pending discovery). Passive: preparing or reading never renews the idle window.
    fn plan_account_for(
        &self,
        account_id: &str,
        purpose: Use,
    ) -> Result<(Account, u64), SendError> {
        let outcome = self.with_session(false, |session| {
            let payload = &session.payload;
            let record = match purpose {
                Use::Sign => signing_record(payload, account_id).map_err(SendError::from),
                Use::Read => payload.record(account_id).ok_or(SendError::UnknownAccount),
            };
            Ok(record
                .and_then(plan_account)
                .map(|account| (account, self.lock_epoch.load(Ordering::SeqCst))))
        });
        outcome.unwrap_or(Err(SendError::Locked))
    }

    /// Signs a hash for a plan, only while the session generation is still `generation` and the
    /// record still passes the signing gate. `Err(CoreError::Locked)` when the wallet was locked,
    /// idle-locked, or re-unlocked since the plan was prepared (every lock and every new session
    /// advances `lock_epoch`, both under the session mutex held here). The key is derived from
    /// the record's index, used, and wiped inside this call. Renews.
    pub(crate) fn plan_sign(
        &self,
        generation: u64,
        account_id: &str,
        hash: &Felt,
    ) -> Result<kms::Signature, CoreError> {
        self.with_session(true, |session| {
            if self.lock_epoch.load(Ordering::SeqCst) != generation {
                return Err(CoreError::Locked);
            }
            let payload = &session.payload;
            let record = signing_record(payload, account_id)?;
            sign_for(payload, record, &felt::canonical(hash))
        })
    }
}

#[uniffi::export]
impl WalletCore {
    /// Validates and canonicalises a transfer and returns its plan. Requires an unlocked wallet;
    /// records the session generation so a lock (even one followed by a new unlock) voids it.
    /// The account is the vault record `request.account_id` on `request.network`; a view-only
    /// (Braavos) or Argent/Ready record is refused before any request is built.
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
        let (account, generation) = self.plan_account_for(&request.account_id, Use::Sign)?;
        if account.network != request.network {
            return Err(SendError::UnknownAccount);
        }
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
    /// Only for a record that passes the signing gate (an OpenZeppelin account).
    pub fn prepare_deployment(
        self: Arc<Self>,
        account_id: String,
    ) -> Result<Arc<TransferPlan>, SendError> {
        let (account, generation) = self.plan_account_for(&account_id, Use::Sign)?;
        Ok(TransferPlan::new(
            &self,
            account,
            Kind::Deployment,
            generation,
        ))
    }

    /// The account's one activity list, newest first: the transactions this wallet submitted and
    /// the on-chain history rows merged into the same log. Requires an unlocked wallet (the record
    /// lives in the vault). Any family may be read.
    pub fn activity(&self, account_id: String) -> Result<Vec<ActivityEntry>, SendError> {
        let (account, _) = self.plan_account_for(&account_id, Use::Read)?;
        Ok(crate::activity::feed::scope(
            &self.data_dir,
            &account.account_id,
        ))
    }

    /// Retires the account's unresolved records that outlived their hour (`expiredObservations`:
    /// the status is kept, one notice is owed) and hands out every owed notice once, as the
    /// extension's `wallet.transactionAlerts`: the copy of `failureNoticeMessage`, at most five
    /// per call, marked delivered before they are returned. Delivery is at-most-once: a host that
    /// dies before showing one loses it, and the record keeps its status either way. `now_ms` is
    /// the host's wall clock, the clock records' `submitted_at` is on. Requires an unlocked wallet.
    pub fn take_activity_notices(
        &self,
        account_id: String,
        now_ms: u64,
    ) -> Result<Vec<String>, SendError> {
        let (account, _) = self.plan_account_for(&account_id, Use::Read)?;
        store::retire_expired(&self.data_dir, &account.account_id, now_ms);
        Ok(
            store::take_failure_notices(&self.data_dir, &account.account_id)
                .iter()
                .filter_map(|entry| {
                    let status = store::parse_status(&entry.status)?;
                    Some(observation::failure_notice_message(status, &entry.summary))
                })
                .collect(),
        )
    }

    /// A plan that reads one recorded transaction's status and settles its record; never signs.
    pub fn refresh_activity(
        self: Arc<Self>,
        account_id: String,
        hash: String,
    ) -> Result<Arc<TransferPlan>, SendError> {
        let (account, generation) = self.plan_account_for(&account_id, Use::Read)?;
        let hash = felt::parse_non_zero(&hash).ok_or(SendError::UnknownTransaction)?;
        let known = store::list(&self.data_dir, &account.account_id)
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
