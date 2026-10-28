//! `TransferPlan`: one reviewed transfer (or standalone deployment, or status refresh) as a
//! core-owned state machine. The host only relays request bodies and replies; it cannot reorder
//! steps, skip the re-estimate, substitute bounds, or hand in a hash. See `mobile/docs/
//! transactions.md` §3 for the step order, which is the extension's recorded wire order.
//!
//! Review steps live in `plan_review`, the submit path in `plan_submit`.

use std::sync::{Arc, Mutex, MutexGuard, Weak};

use starknet_types_core::felt::Felt;

use super::fees::{Bounds, FeeQuote};
use super::judge;
use super::plan_probe::Probe;
use super::types::{
    ReviewFlag, RpcPurpose, SendError, SendFailure, SendFailureCode, SendStep, StepReply,
    TransferReview, TxStatus,
};
use super::u256::U256;
use crate::networks::NetworkId;
use crate::wallet::WalletCore;

/// The confirmation checkpoints of the extension's `CONFIRMATION_DELAYS_MS`.
pub const CONFIRMATION_DELAYS_MS: [u32; 12] = [
    0, 250, 500, 900, 1_500, 2_500, 4_000, 5_000, 7_500, 10_000, 10_000, 10_000,
];
/// starknet.js `waitForTransaction`: poll interval and attempt budget.
pub const DEPLOY_POLL_INTERVAL_MS: u32 = 5_000;
pub const DEPLOY_POLL_ATTEMPTS: u32 = 200;

/// How the account authorises a transaction: `authorizationShape` in the extension's
/// `account-families.ts`, decided by the record's family when the plan is prepared.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Authorization {
    /// OpenZeppelin: a bare `[r, s]`; estimates skip validation.
    StarkPair,
    /// Ready (Argent 0.4): one `Signer::Starknet` in a signer array, `[1, 0, public_key, r, s]`;
    /// estimates validate a query signature of the same shape, and the account's class and signer
    /// are read at one accepted block before anything is estimated or signed.
    ArgentSignerArray,
}

/// The DEPLOY_ACCOUNT an account's address commits to (`accountDeployment`), proven against the
/// stored address when the plan is prepared.
pub(crate) struct Deployment {
    pub class_hash: Felt,
    pub salt: Felt,
    pub constructor_calldata: Vec<Felt>,
}

/// The acting account, as stored in the vault when the plan was prepared: an OpenZeppelin or a
/// Ready (Argent) record that passed `wallet_accounts::signing_record`.
pub(crate) struct Account {
    pub network: NetworkId,
    pub address: Felt,
    pub public_key: Felt,
    pub authorization: Authorization,
    /// `None` for a Ready record deployed with an older class: the extension deploys only the
    /// pinned Argent 0.4.0 release, so such an account can send once deployed and upgraded, but
    /// is never deployed from here ("Argent account class hash does not match the pinned release").
    pub deployment: Option<Deployment>,
    /// The vault record's id, `<networkId>:<address>` (the extension's account id). It scopes
    /// activity and is what every signature for this plan is requested by.
    pub account_id: String,
}

impl Account {
    pub(crate) fn is_argent(&self) -> bool {
        self.authorization == Authorization::ArgentSignerArray
    }

    /// The signature an estimate carries: none for OpenZeppelin (validation skipped), the
    /// extension's `argentQueryAccount` shape `(r, s) = (1, 1)` for Ready.
    pub(crate) fn query_signature(&self) -> Vec<Felt> {
        match self.authorization {
            Authorization::StarkPair => Vec::new(),
            Authorization::ArgentSignerArray => self.signature(Felt::ONE, Felt::ONE),
        }
    }

    /// `serializeAccountSignature` for this account's family.
    pub(crate) fn signature(&self, r: Felt, s: Felt) -> Vec<Felt> {
        match self.authorization {
            Authorization::StarkPair => vec![r, s],
            // One signer, `Signer::Starknet` (variant 0), its public key, then `(r, s)`.
            Authorization::ArgentSignerArray => vec![Felt::ONE, Felt::ZERO, self.public_key, r, s],
        }
    }
}

/// The one stored ERC-20 call every review, hash and record is derived from.
pub(crate) struct Transfer {
    pub symbol: String,
    /// The bundled token's contract, recorded on the activity row beside its symbol.
    pub token_address: Felt,
    pub is_strk: bool,
    pub recipient: Felt,
    pub amount: U256,
    pub amount_text: String,
    pub calldata: Vec<Felt>,
    pub summary: String,
    pub flags: Vec<ReviewFlag>,
    pub fee_balance: Option<U256>,
}

pub(crate) enum Kind {
    Transfer(Box<Transfer>),
    Deployment,
    Refresh { hash: Felt },
}

/// Which reply the plan is waiting for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Expect {
    ReviewChain,
    /// The account-state reads (`plan_probe`): the accepted block, the class, and the signer.
    Block(Probe),
    Class(Probe),
    Owner(Probe),
    OwnerType(Probe),
    Guardian(Probe),
    ReviewNonce,
    ReviewEstimate,
    ReviewDeployNonce,
    ReviewDeployEstimate,
    SubmitChain,
    SubmitNonce,
    SubmitEstimate,
    DeployNonce,
    DeployEstimate,
    DeployWrite,
    DeployStatus,
    DeployReceipt,
    InvokeNonce,
    InvokeWrite,
    ConfirmStatus,
    RefreshStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AfterWait {
    DeployStatus,
    DeployReceipt,
    Checkpoint,
}

enum Stage {
    Fresh,
    Awaiting { id: u64, expect: Expect },
    Waiting(AfterWait),
    Reviewed,
    Broadcasted,
    Finished(TxStatus),
    Closed,
}

/// Values gathered while the plan runs.
#[derive(Default)]
pub(crate) struct Work {
    pub now_ms: u64,
    pub next_id: u64,
    /// Review: `Some(deployed)` once `ClassHashAt` answered.
    pub deployed: Option<bool>,
    pub nonce: Felt,
    /// The accepted block the current account-state reads are pinned to.
    pub block: Felt,
    /// `get_owner`, held until `get_owner_type` answers (the extension reads both at once).
    pub owner: Option<judge::CallAnswer>,
    pub fee: Option<FeeQuote>,
    pub deploy_fee: Option<FeeQuote>,
    pub requires_deployment: bool,
    pub already_deployed: bool,
    pub reviewed_fee: Option<FeeQuote>,
    pub reviewed_deploy_fee: Option<FeeQuote>,
    pub submit_deployed: bool,
    pub invoke_bounds: Option<Bounds>,
    pub deploy_hash: Option<Felt>,
    pub deployment_accepted: bool,
    pub attempts: u32,
    pub invoke_hash: Option<Felt>,
    pub checkpoint: usize,
}

pub(crate) struct PlanState {
    pub account: Account,
    pub kind: Kind,
    pub generation: u64,
    stage: Stage,
    pub work: Work,
    pub signatures: u32,
    pub review: Option<TransferReview>,
}

/// One plan. Dropped on any edit, lock or dismissal; a new plan means a new review.
#[derive(uniffi::Object)]
pub struct TransferPlan {
    core: Weak<WalletCore>,
    state: Mutex<PlanState>,
}

impl TransferPlan {
    pub(crate) fn new(
        core: &Arc<WalletCore>,
        account: Account,
        kind: Kind,
        generation: u64,
    ) -> Arc<Self> {
        Arc::new(Self {
            core: Arc::downgrade(core),
            state: Mutex::new(PlanState {
                account,
                kind,
                generation,
                stage: Stage::Fresh,
                work: Work::default(),
                signatures: 0,
                review: None,
            }),
        })
    }

    fn lock_state(&self) -> MutexGuard<'_, PlanState> {
        // A poisoned lock means a panic mid-step: close the plan rather than continue.
        self.state.lock().unwrap_or_else(|poisoned| {
            let mut guard = poisoned.into_inner();
            guard.stage = Stage::Closed;
            guard
        })
    }

    /// How many hashes this plan has signed; for tests that prove a refusal reached no signer.
    #[doc(hidden)]
    pub fn signatures_made(&self) -> u32 {
        self.lock_state().signatures
    }
}

#[uniffi::export]
impl TransferPlan {
    /// Feeds the last reply and returns the next thing the host must do. A reply whose id is not
    /// the one outstanding, or a reply kind the current step does not expect, returns
    /// `OutOfOrder` and closes the plan (fail closed). A `Failed` step also closes it.
    pub fn advance(&self, reply: StepReply) -> Result<SendStep, SendError> {
        let mut state = self.lock_state();
        if matches!(state.stage, Stage::Closed) {
            return Err(SendError::PlanClosed);
        }
        let Some(core) = self.core.upgrade() else {
            state.stage = Stage::Closed;
            return Err(SendError::PlanClosed);
        };
        let result = state.step(&core, reply);
        if matches!(result, Ok(SendStep::Failed { .. }) | Err(_)) {
            state.stage = Stage::Closed;
        }
        result
    }

    /// The review the last `Review` step announced; `None` before the first review.
    pub fn current_review(&self) -> Option<TransferReview> {
        self.lock_state().review.clone()
    }

    /// What the journey must report if the plan stops (closed by a lock, backgrounding, or
    /// dismissal) after a signed write may have left the device: the invoke as
    /// `SubmissionIndeterminate`, an automatic deployment as `DeploymentUnconfirmed` (the
    /// extension's "Account deployment was broadcast as <hash>, but confirmation is unknown"),
    /// each with its hash. `None` while no write has been handed out, when "not sent" is true.
    pub fn interrupted_failure(&self) -> Option<SendFailure> {
        let state = self.lock_state();
        let work = &state.work;
        let (code, hash) = match (work.invoke_hash, work.deploy_hash) {
            (Some(hash), _) => (SendFailureCode::SubmissionIndeterminate, hash),
            (None, Some(hash)) if matches!(state.kind, Kind::Transfer(_)) => {
                (SendFailureCode::DeploymentUnconfirmed, hash)
            }
            (None, Some(hash)) => (SendFailureCode::SubmissionIndeterminate, hash),
            (None, None) => return None,
        };
        Some(SendFailure {
            code,
            hash: Some(crate::felt::canonical(&hash)),
            detail: None,
        })
    }

    /// Stops the plan: no further step, and so no further signing point, can be reached.
    /// Idempotent. It never erases the pending activity record of a write the plan already
    /// handed out; that record is settled by status reconciliation.
    ///
    /// Exported as `cancel`: Kotlin's generated `AutoCloseable.close()` (which frees the handle)
    /// would otherwise clash with it.
    #[uniffi::method(name = "cancel")]
    pub fn close(&self) {
        self.lock_state().stage = Stage::Closed;
    }
}

impl PlanState {
    fn step(&mut self, core: &WalletCore, reply: StepReply) -> Result<SendStep, SendError> {
        let stage = std::mem::replace(&mut self.stage, Stage::Closed);
        match (stage, reply) {
            (Stage::Fresh, StepReply::Start) | (Stage::Reviewed, StepReply::RetryEstimate) => {
                Ok(self.start())
            }
            (
                Stage::Awaiting { id, expect },
                StepReply::Rpc {
                    id: got,
                    body,
                    now_ms,
                },
            ) if id == got => {
                self.work.now_ms = now_ms;
                Ok(self.on_reply(core, expect, judge::answer(&body, id)))
            }
            (Stage::Awaiting { id, expect }, StepReply::TransportFailure { id: got, now_ms })
                if id == got =>
            {
                self.work.now_ms = now_ms;
                Ok(self.on_reply(core, expect, None))
            }
            (Stage::Waiting(after), StepReply::WaitElapsed) => Ok(self.after_wait(after)),
            (Stage::Reviewed, StepReply::Confirm) => self.confirm(core),
            (Stage::Broadcasted, StepReply::Proceed)
            | (Stage::Finished(TxStatus::Pending), StepReply::CheckAgain) => Ok(self.checkpoint(0)),
            _ => Err(SendError::OutOfOrder),
        }
    }

    fn start(&mut self) -> SendStep {
        let (now_ms, next_id) = (self.work.now_ms, self.work.next_id);
        self.work = Work {
            now_ms,
            next_id,
            ..Work::default()
        };
        if let Kind::Refresh { hash } = self.kind {
            return self.rpc(
                Expect::RefreshStatus,
                RpcPurpose::TransactionStatus,
                false,
                |_, id| super::rpc_bodies::transaction_status(id, &hash),
            );
        }
        self.rpc(Expect::ReviewChain, RpcPurpose::ChainId, false, |_, id| {
            crate::rpc::chain_id_request(id)
        })
    }

    fn on_reply(
        &mut self,
        core: &WalletCore,
        expect: Expect,
        answer: Option<judge::Answer>,
    ) -> SendStep {
        match expect {
            Expect::Block(_)
            | Expect::Class(_)
            | Expect::Owner(_)
            | Expect::OwnerType(_)
            | Expect::Guardian(_) => self.on_probe_reply(expect, answer),
            Expect::ReviewChain
            | Expect::ReviewNonce
            | Expect::ReviewEstimate
            | Expect::ReviewDeployNonce
            | Expect::ReviewDeployEstimate => self.on_review_reply(expect, answer),
            _ => self.on_submit_reply(core, expect, answer),
        }
    }

    fn after_wait(&mut self, after: AfterWait) -> SendStep {
        match after {
            AfterWait::DeployStatus => self.poll_deployment(),
            AfterWait::DeployReceipt => self.read_deploy_receipt(),
            AfterWait::Checkpoint => {
                let Some(hash) = self.target_hash() else {
                    return self.fail(SendFailureCode::SubmissionIndeterminate, None);
                };
                self.rpc(
                    Expect::ConfirmStatus,
                    RpcPurpose::TransactionStatus,
                    false,
                    |_, id| super::rpc_bodies::transaction_status(id, &hash),
                )
            }
        }
    }

    /// The hash the confirmation checkpoints follow.
    pub(crate) fn target_hash(&self) -> Option<Felt> {
        match self.kind {
            Kind::Transfer(_) => self.work.invoke_hash,
            Kind::Deployment => self.work.deploy_hash,
            Kind::Refresh { hash } => Some(hash),
        }
    }

    /// Emits one JSON-RPC step under a fresh id.
    pub(crate) fn rpc(
        &mut self,
        expect: Expect,
        purpose: RpcPurpose,
        is_write: bool,
        body: impl FnOnce(&Self, u64) -> String,
    ) -> SendStep {
        self.work.next_id += 1;
        let id = self.work.next_id;
        let body = body(self, id);
        self.stage = Stage::Awaiting { id, expect };
        SendStep::Rpc {
            id,
            body,
            purpose,
            is_write,
        }
    }

    pub(crate) fn wait(&mut self, delay_ms: u32, after: AfterWait) -> SendStep {
        self.stage = Stage::Waiting(after);
        SendStep::Wait { delay_ms }
    }

    pub(crate) fn fail(&mut self, code: SendFailureCode, hash: Option<Felt>) -> SendStep {
        self.stage = Stage::Closed;
        SendStep::Failed {
            failure: SendFailure {
                code,
                hash: hash.map(|h| crate::felt::canonical(&h)),
                detail: None,
            },
        }
    }

    pub(crate) fn reviewed(&mut self, review: TransferReview) -> SendStep {
        self.stage = Stage::Reviewed;
        self.review = Some(review);
        SendStep::Review
    }

    pub(crate) fn broadcast(&mut self, hash: Felt) -> SendStep {
        self.stage = Stage::Broadcasted;
        SendStep::Broadcast {
            hash: crate::felt::canonical(&hash),
        }
    }

    pub(crate) fn finish(&mut self, status: TxStatus, hash: Felt) -> SendStep {
        self.stage = Stage::Finished(status);
        let hash = crate::felt::canonical(&hash);
        SendStep::Finished {
            status,
            explorer_url: crate::history::explorer::explorer_transaction_url(
                self.account.network,
                hash.clone(),
            ),
            hash,
        }
    }

    /// Starts (or restarts) the confirmation checkpoints at `index`.
    pub(crate) fn checkpoint(&mut self, index: usize) -> SendStep {
        let Some(hash) = self.target_hash() else {
            return self.fail(SendFailureCode::SubmissionIndeterminate, None);
        };
        match CONFIRMATION_DELAYS_MS.get(index) {
            Some(delay) => {
                self.work.checkpoint = index;
                self.wait(*delay, AfterWait::Checkpoint)
            }
            None => self.finish(TxStatus::Pending, hash),
        }
    }
}
