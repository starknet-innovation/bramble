//! `TransferPlan`: mobile's FFI object around `wallet_core::send::plan::Plan`, the core-owned
//! state machine for one reviewed transfer (or standalone deployment, or status refresh). The
//! step order is the extension's recorded wire order; `mobile/docs/transactions.md` §3.
//!
//! The wrapper holds what ties a plan to this wallet: the vault record it signs for, the session
//! generation it was prepared in, and the plan's `PlanHost` (`impl PlanHost for TransferPlan`
//! below), which maps the core's session check, signing, pending records, observations and
//! explorer links onto `WalletCore`, the activity store and the explorer catalog.

use std::sync::{Arc, Mutex, MutexGuard, Weak};

use wallet_core::send::judge::{Observation, TxStatus};
use wallet_core::send::plan::{
    Account, Kind, PendingKind, PendingRecord, Plan, PlanHost, SignRefusal,
};
use wallet_core::{Felt, StarkSignature};

use super::types::{ActivityKind, SendError, SendFailure, SendStep, StepReply, TransferReview};
use wallet_core::activity::store::{kind_text, Entry};
use wallet_core::history::activity::TransferDirection;
use wallet_core::history::activity_rules::direction_text;

use crate::activity::with_log;
use crate::networks::NetworkId;
use crate::wallet::WalletCore;
use crate::{felt, CoreError};

/// Bramble's send numbers, until 2.7 moves them to `bramble-core`: the same values as its
/// `FEE_MARGIN_PERCENT`, `REVIEWED_FEE_HEADROOM` and `CONFIRMATION_DELAYS_MS`, each checked
/// against `extension-transactions-rules.json` (`fixture_tests.rs`).
pub(crate) const FEE_MARGIN_PERCENT: u32 = 50;
pub(crate) const REVIEWED_FEE_HEADROOM: wallet_core::send::fees::Headroom =
    wallet_core::send::fees::Headroom {
        numerator: 3,
        denominator: 2,
    };
/// The confirmation checkpoints of the extension's `CONFIRMATION_DELAYS_MS`.
pub const CONFIRMATION_DELAYS_MS: [u32; 12] = [
    0, 250, 500, 900, 1_500, 2_500, 4_000, 5_000, 7_500, 10_000, 10_000, 10_000,
];
pub(crate) const SEND_POLICY: wallet_core::send::plan::Policy = wallet_core::send::plan::Policy {
    fee_margin_percent: FEE_MARGIN_PERCENT,
    reviewed_fee_headroom: REVIEWED_FEE_HEADROOM,
    confirmation_delays_ms: &CONFIRMATION_DELAYS_MS,
};

/// One plan. Dropped on any edit, lock or dismissal; a new plan means a new review.
#[derive(uniffi::Object)]
pub struct TransferPlan {
    core: Weak<WalletCore>,
    /// The vault record's id, `<networkId>:<address>` (the extension's account id). It scopes
    /// activity and is what every signature for this plan is requested by.
    account_id: String,
    network: NetworkId,
    /// The session generation (`lock_epoch`) the plan was prepared in.
    generation: u64,
    plan: Mutex<Plan>,
}

impl TransferPlan {
    pub(crate) fn new(
        core: &Arc<WalletCore>,
        account_id: String,
        network: NetworkId,
        account: Account,
        kind: Kind,
        generation: u64,
    ) -> Arc<Self> {
        Arc::new(Self {
            core: Arc::downgrade(core),
            account_id,
            network,
            generation,
            plan: Mutex::new(Plan::new(account, kind, SEND_POLICY)),
        })
    }

    fn lock_plan(&self) -> MutexGuard<'_, Plan> {
        // A poisoned lock means a panic mid-step: close the plan rather than continue.
        self.plan.lock().unwrap_or_else(|poisoned| {
            let mut guard = poisoned.into_inner();
            guard.close();
            guard
        })
    }

    /// How many hashes this plan has signed; for tests that prove a refusal reached no signer.
    #[doc(hidden)]
    pub fn signatures_made(&self) -> u32 {
        self.lock_plan().signatures_made()
    }
}

#[uniffi::export]
impl TransferPlan {
    /// Feeds the last reply and returns the next thing the host must do. A reply whose id is not
    /// the one outstanding, or a reply kind the current step does not expect, returns
    /// `OutOfOrder` and closes the plan (fail closed). A `Failed` step also closes it.
    // An error never means "nothing was sent": `interrupted_failure` says whether a signed write
    // left (the hosts call it on every error; `transactions_lifecycle.rs` pins it).
    pub fn advance(&self, reply: StepReply) -> Result<SendStep, SendError> {
        let mut plan = self.lock_plan();
        if self.core.upgrade().is_none() {
            plan.close();
            return Err(SendError::PlanClosed);
        }
        plan.advance(self, reply).map_err(SendError::from)
    }

    /// The review the last `Review` step announced; `None` before the first review.
    pub fn current_review(&self) -> Option<TransferReview> {
        self.lock_plan().current_review().cloned()
    }

    /// What the journey must report if the plan stops (closed by a lock, backgrounding, or
    /// dismissal) after a signed write may have left the device: the invoke as
    /// `SubmissionIndeterminate`, an automatic deployment as `DeploymentUnconfirmed` (the
    /// extension's "Account deployment was broadcast as <hash>, but confirmation is unknown"),
    /// each with its hash. `None` while no write has been handed out, when "not sent" is true.
    pub fn interrupted_failure(&self) -> Option<SendFailure> {
        self.lock_plan().interrupted_failure()
    }

    /// Stops the plan: no further step, and so no further signing point, can be reached.
    /// Idempotent. It never erases the pending activity record of a write the plan already
    /// handed out; that record is settled by status reconciliation.
    ///
    /// Exported as `cancel`: Kotlin's generated `AutoCloseable.close()` (which frees the handle)
    /// would otherwise clash with it.
    #[uniffi::method(name = "cancel")]
    pub fn close(&self) {
        self.lock_plan().close();
    }
}

/// The wallet behind the plan. Every call re-reads the wallet through the weak reference; a
/// dropped wallet is a moved session.
impl PlanHost for TransferPlan {
    fn session_current(&self) -> bool {
        self.core
            .upgrade()
            .is_some_and(|core| core.session_generation() == Some(self.generation))
    }

    /// `plan_sign` checks the generation under the session mutex on every call, so a lock after
    /// Confirm refuses the deployment, the invoke after a deployment wait, and Braavos's review
    /// estimate alike, not only Confirm.
    fn sign(&self, hash: &Felt, renew: bool) -> Result<StarkSignature, SignRefusal> {
        let core = self.core.upgrade().ok_or(SignRefusal::Locked)?;
        core.plan_sign(self.generation, &self.account_id, hash, renew)
            .map_err(|error| match error {
                CoreError::Locked | CoreError::NoWallet => SignRefusal::Locked,
                _ => SignRefusal::Failed,
            })
    }

    /// Best effort, as the extension's `recordSubmittedActivity`: a storage failure never blocks
    /// or rewrites a send.
    fn record_pending(&self, record: PendingRecord) {
        let Some(core) = self.core.upgrade() else {
            return;
        };
        let (kind, amount, counterparty, token, token_address) = match record.kind {
            PendingKind::Transfer {
                amount,
                recipient,
                symbol,
                token_address,
            } => (
                ActivityKind::Transfer,
                Some(amount),
                Some(felt::canonical(&recipient)),
                Some(symbol),
                Some(felt::canonical(&token_address)),
            ),
            PendingKind::Deployment => (ActivityKind::Deploy, None, None, None, None),
        };
        with_log(&core.data_dir, |log| {
            log.record(Entry {
                account_id: self.account_id.clone(),
                amount,
                counterparty,
                // A public send this wallet made moves value out (`wallet-ops.ts`).
                direction: token
                    .as_ref()
                    .map(|_| direction_text(TransferDirection::Out).into()),
                failure_notice: None,
                finalized_on_l1: None,
                hash: felt::canonical(&record.hash),
                kind: kind_text(kind).into(),
                network_id: self.network.catalog_id().into(),
                not_found_count: None,
                status: "pending".into(),
                submitted_at: record.submitted_at,
                summary: record.summary,
                token,
                token_address,
            })
        });
    }

    fn observe(&self, hash: &Felt, observation: Observation) -> Option<TxStatus> {
        let core = self.core.upgrade()?;
        with_log(&core.data_dir, |log| {
            log.observe(&self.account_id, hash, observation)
        })
    }

    fn explorer_url(&self, hash: &str) -> Option<String> {
        crate::history::explorer::explorer_transaction_url(self.network, hash.into())
    }
}
