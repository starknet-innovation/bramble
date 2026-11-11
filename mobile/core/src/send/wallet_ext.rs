//! The send path's `WalletCore` entry points, in a second `#[uniffi::export]` block, and the
//! plan's session accessors, so `wallet.rs` keeps only vault-security's session model. Every input
//! is untrusted and validated here, before a plan exists; nothing here does I/O except reading
//! the local activity file. Plans name their account by vault record id and every signature
//! passes `wallet_accounts::signing_record`.

use std::sync::atomic::Ordering;
use std::sync::Arc;

use starknet_types_core::felt::Felt;

use wallet_core::accounts::constructor_calldata;
use wallet_core::send::calls;
use wallet_core::send::plan::{Account, Kind, Token, Transfer, TransferRefusal};
use wallet_core::send::sign::Deployment;
use wallet_core::send::u256::U256;

use super::plan::TransferPlan;
use super::types::{SendError, TransferRequest};
use crate::account_address::argent_shape;
use crate::account_catalog::{self, AccountFamily};
use crate::account_store::StoredAccount;
use crate::activity::{failure_notice_message, with_log};
use crate::history::activity::ActivityEntry;
use crate::networks::{self, NetworkId};
use crate::portfolio::registry;
use crate::wallet::WalletCore;
use crate::wallet_accounts::{sign_for, signing_record, SignRefusal};
use crate::{contacts, felt, kms, multisig_store, CoreError};
use wallet_core::activity::store::parse_status;

impl From<SignRefusal> for SendError {
    fn from(refusal: SignRefusal) -> Self {
        match refusal {
            SignRefusal::Unknown => SendError::UnknownAccount,
        }
    }
}

impl From<TransferRefusal> for SendError {
    fn from(refusal: TransferRefusal) -> Self {
        match refusal {
            TransferRefusal::InvalidRecipient => SendError::InvalidRecipient,
            TransferRefusal::InvalidAmount(reason) => SendError::InvalidAmount { reason },
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

/// The DEPLOY_ACCOUNT a record's address commits to (`accountDeployment`), or `None` when this
/// wallet does not deploy the record's class. OpenZeppelin: salt 0 and `[public_key]`. Ready:
/// the pinned Argent 0.4.0 class or Xverse's build of it (`DEPLOYABLE_ARGENT_CLASSES`), with the
/// record's salt and the core's constructor calldata (`[0, public_key, 1]`: a Starknet signer and
/// no guardian), at the layout the catalog gives the class. Braavos: only the
/// modern deployment class, with the public key as salt and sole constructor argument (an older
/// base-class counterfactual is refused, since its deployment authorization is not established).
/// Which classes are deployable is this catalog's rule; `Plan::new` then drops any deployment
/// that does not reproduce the stored address, so nothing else is ever deployed.
fn deployment(record: &StoredAccount, public_key: &Felt) -> Option<Deployment> {
    let class_hash = record.class_felt();
    let (salt, constructor_calldata) = match record.family() {
        AccountFamily::OpenZeppelin => (Felt::ZERO, vec![*public_key]),
        AccountFamily::Argent
            if class_hash == account_catalog::catalog().argent_default
                || class_hash == account_catalog::catalog().argent_xverse =>
        {
            let shape = argent_shape(AccountFamily::Argent, &class_hash).ok()?;
            let calldata =
                constructor_calldata(AccountFamily::Argent, &class_hash, shape, public_key).ok()?;
            (record.salt_felt()?, calldata)
        }
        AccountFamily::Braavos if class_hash == account_catalog::catalog().braavos_deployment => {
            (*public_key, vec![*public_key])
        }
        AccountFamily::Argent | AccountFamily::Braavos => return None,
    };
    Some(Deployment {
        class_hash,
        salt,
        constructor_calldata,
    })
}

/// The acting account for a plan: the core's `Account`, built once from the vault record, and
/// what ties the plan to that record. The plan's `Transfer` is derived from the same `account`.
struct PlanAccount {
    account: Account,
    account_id: String,
    network: NetworkId,
    generation: u64,
}

fn plan_account(record: &StoredAccount) -> Result<Account, SendError> {
    let parse = |value: &str| felt::parse_non_zero(value).ok_or(SendError::UnknownAccount);
    let (address, public_key) = (parse(&record.address)?, parse(&record.public_key)?);
    Ok(Account {
        network: record.network(),
        deployment: deployment(record, &public_key),
        address,
        public_key,
        authorization: account_catalog::send_authorization(record.family()),
    })
}

/// The token contracts the wallet knows on `network` (`tokenContractRecipientFlag`'s list): the
/// bundled Send tokens, STRK among them, and the curated registry.
pub(crate) fn known_token_addresses(network: NetworkId) -> Vec<Felt> {
    let bundled = networks::info(network)
        .tokens
        .iter()
        .map(|t| t.address.clone());
    let curated = registry::known_tokens(network)
        .into_iter()
        .map(|t| t.address);
    bundled
        .chain(curated)
        .filter_map(|address| felt::parse(&address))
        .collect()
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

    /// Every address on `network` the person can be expected to recognise, for the poisoning
    /// check: their vault accounts, their multisig accounts, and saved contacts (the extension's
    /// `withTrustedRecipients`). Recipients merely seen in the activity log are left out, because
    /// chain history is merged into it and an attacker can plant rows there (the extension
    /// excludes chain-discovered history for the same reason). Fails closed: an unreadable
    /// contacts or multisig file refuses the send rather than checking against fewer addresses.
    fn trusted_recipients(&self, network: NetworkId) -> Result<Vec<Felt>, SendError> {
        let own = self
            .with_session(false, |session| {
                Ok(session
                    .payload
                    .accounts
                    .iter()
                    .filter(|record| record.network() == network)
                    .filter_map(|record| felt::parse(&record.address))
                    .collect::<Vec<_>>())
            })
            .map_err(|_| SendError::Locked)?;
        // The recipient cannot be vetted without the addresses it might imitate.
        let contacts =
            contacts::list(&self.data_dir, network).map_err(|_| SendError::InvalidRecipient)?;
        let multisigs =
            multisig_store::load(&self.data_dir).map_err(|_| SendError::InvalidRecipient)?;
        let catalog_id = contacts::network_catalog_id(network);
        Ok(own
            .into_iter()
            .chain(contacts.iter().filter_map(|c| felt::parse(&c.address)))
            .chain(
                multisigs
                    .records
                    .iter()
                    .filter(|record| record.network_id == catalog_id)
                    .filter_map(|record| felt::parse(&record.address)),
            )
            .collect())
    }

    /// The stored record `account_id` names plus the session generation, for a plan being
    /// prepared. A signing plan must pass `signing_record` (a known record, no pending discovery). Passive: preparing or reading never renews the idle window.
    fn plan_account_for(&self, account_id: &str, purpose: Use) -> Result<PlanAccount, SendError> {
        let outcome = self.with_session(false, |session| {
            let payload = &session.payload;
            let record = match purpose {
                Use::Sign => signing_record(payload, account_id).map_err(SendError::from),
                Use::Read => payload.record(account_id).ok_or(SendError::UnknownAccount),
            };
            Ok(record.and_then(|record| {
                Ok(PlanAccount {
                    account: plan_account(record)?,
                    account_id: record.id.clone(),
                    network: record.network(),
                    generation: self.lock_epoch.load(Ordering::SeqCst),
                })
            }))
        });
        outcome.unwrap_or(Err(SendError::Locked))
    }

    /// Signs a hash for a plan, only while the session generation is still `generation` and the
    /// record still passes the signing gate. `Err(CoreError::Locked)` when the wallet was locked,
    /// idle-locked, or re-unlocked since the plan was prepared (every lock and every new session
    /// advances `lock_epoch`, both under the session mutex held here). The key is derived from
    /// the record's index, used, and wiped inside this call. Renews the idle window only when
    /// `renew`: a review's signature (Braavos's deployment estimate) is passive, as reads are.
    pub(crate) fn plan_sign(
        &self,
        generation: u64,
        account_id: &str,
        hash: &Felt,
        renew: bool,
    ) -> Result<kms::Signature, CoreError> {
        self.with_session(renew, |session| {
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
    /// The account is the vault record `request.account_id` on `request.network`. An undeployed
    /// Braavos account is refused by the plan's review (`BraavosDeployFirst`): it deploys only
    /// through `prepare_deployment`.
    /// Refuses a token that is not bundled for the network, an unparseable or zero recipient,
    /// and an amount the extension would refuse or no ERC-20 could carry. Also refuses with
    /// `InvalidRecipient` when the contacts or multisig file is unreadable, since the recipient
    /// cannot then be checked against every address it might imitate.
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
        let acting = self.plan_account_for(&request.account_id, Use::Sign)?;
        if acting.network != request.network {
            return Err(SendError::UnknownAccount);
        }
        let tokens = known_token_addresses(request.network)
            .into_iter()
            .chain(
                request
                    .tracked_tokens
                    .iter()
                    .filter_map(|address| felt::parse(address)),
            )
            .collect::<Vec<_>>();
        // The same account the plan signs for, so the self-transfer and lookalike flags are
        // judged against the address that will send.
        let transfer = Transfer::new(
            &acting.account,
            Token {
                address: requested,
                symbol: &token.symbol,
                decimals: token.decimals,
            },
            &request.recipient,
            &request.amount,
            &self.trusted_recipients(request.network)?,
            &tokens,
            request.fee_balance.as_deref().and_then(U256::from_decimal),
        )?;
        Ok(self.plan(acting, Kind::Transfer(Box::new(transfer))))
    }

    /// The standalone Deploy account flow for the home chip: the same machine without the invoke.
    /// Only for a record that passes the signing gate.
    pub fn prepare_deployment(
        self: Arc<Self>,
        account_id: String,
    ) -> Result<Arc<TransferPlan>, SendError> {
        let acting = self.plan_account_for(&account_id, Use::Sign)?;
        Ok(self.plan(acting, Kind::Deployment))
    }

    /// The account's one activity list, newest first: the transactions this wallet submitted and
    /// the on-chain history rows merged into the same log. Requires an unlocked wallet (the record
    /// lives in the vault). Any family may be read.
    pub fn activity(&self, account_id: String) -> Result<Vec<ActivityEntry>, SendError> {
        let acting = self.plan_account_for(&account_id, Use::Read)?;
        Ok(with_log(&self.data_dir, |log| {
            log.scope(&acting.account_id)
        }))
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
        let acting = self.plan_account_for(&account_id, Use::Read)?;
        let taken = with_log(&self.data_dir, |log| {
            log.retire_expired(&acting.account_id, now_ms);
            log.take_failure_notices(&acting.account_id)
        });
        Ok(taken
            .iter()
            .filter_map(|entry| {
                let status = parse_status(&entry.status)?;
                Some(failure_notice_message(status, &entry.summary))
            })
            .collect())
    }

    /// A plan that reads one recorded transaction's status and settles its record; never signs.
    pub fn refresh_activity(
        self: Arc<Self>,
        account_id: String,
        hash: String,
    ) -> Result<Arc<TransferPlan>, SendError> {
        let acting = self.plan_account_for(&account_id, Use::Read)?;
        let hash = felt::parse_non_zero(&hash).ok_or(SendError::UnknownTransaction)?;
        let known = with_log(&self.data_dir, |log| log.list(&acting.account_id))
            .iter()
            .any(|entry| felt::parse(&entry.hash) == Some(hash));
        if !known {
            return Err(SendError::UnknownTransaction);
        }
        Ok(self.plan(acting, Kind::Refresh { hash }))
    }
}

impl WalletCore {
    fn plan(self: &Arc<Self>, acting: PlanAccount, kind: Kind) -> Arc<TransferPlan> {
        TransferPlan::new(
            self,
            acting.account_id,
            acting.network,
            acting.account,
            kind,
            acting.generation,
        )
    }
}
