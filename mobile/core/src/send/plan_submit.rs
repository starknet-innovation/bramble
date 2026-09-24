//! The submit half of a plan, in the extension's order (`submitInvokeTransaction`,
//! `ensureAccountDeployed`, `submitAccountDeployment`): prove the chain again, re-read deployment
//! state and nonce, re-estimate against the reviewed ceilings, deploy when still needed, sign,
//! broadcast once, then confirm. Every write is preceded by a persisted pending activity record
//! keyed by its signed hash.

use starknet_types_core::felt::Felt;

use super::fees::{self, Bounds, FeeQuote, FeeRefusal};
use super::judge::{
    self, Answer, ChainAnswer, ClassHashAnswer, EstimateAnswer, Observation, WriteAnswer,
};
use super::plan::{AfterWait, Expect, Kind, PlanState};
use super::plan_review::DEPLOY_SUMMARY;
use super::rpc_bodies::{self, InvokeTx};
use super::sign;
use super::types::{
    ActivityKind, ReviewFlag, RpcPurpose, SendError, SendFailureCode as Code, SendStep, TxStatus,
};
use crate::activity::store::{self, Entry};
use crate::felt;
use crate::wallet::WalletCore;
use crate::CoreError;

/// What a re-estimate at submit produced.
pub(super) enum Settled {
    Bounds(Bounds),
    Refused(Code),
}

pub(super) fn refusal_code(refusal: FeeRefusal) -> Code {
    match refusal {
        FeeRefusal::BoundsOutOfRange => Code::BoundsOutOfRange,
        FeeRefusal::UnrecognisedUnit => Code::UnrecognisedFeeUnit,
        // A malformed estimate throws a non-RPC error in starknet.js, which `withRpcWrite`
        // reports as a preparation failure.
        FeeRefusal::Malformed => Code::PreparationUnavailable,
    }
}

/// `settledResourceBounds` / `checkedDeploymentBounds`: the entry's bounds, only when the spend
/// they authorise is within 3/2 of the reviewed spend in the same unit.
pub(super) fn settle(
    entry: Option<&serde_json::Value>,
    reviewed: &FeeQuote,
    exceeded: Code,
    missing: Code,
) -> Settled {
    let Some(entry) = entry else {
        return Settled::Refused(missing);
    };
    match fees::quote(entry) {
        Ok((_, quoted)) if fees::exceeds_reviewed(reviewed, &quoted) => Settled::Refused(exceeded),
        Ok((bounds, _)) => match fees::krusty_bounds(&bounds) {
            Ok(_) => Settled::Bounds(bounds),
            Err(refusal) => Settled::Refused(refusal_code(refusal)),
        },
        Err(FeeRefusal::BoundsOutOfRange) => Settled::Refused(exceeded),
        Err(refusal) => Settled::Refused(refusal_code(refusal)),
    }
}

impl PlanState {
    pub(super) fn is_transfer(&self) -> bool {
        matches!(self.kind, Kind::Transfer(_))
    }

    /// `Confirm`: refuse a poisoned recipient and a moved session before anything else.
    pub(crate) fn confirm(&mut self, core: &WalletCore) -> Result<SendStep, SendError> {
        if let Kind::Transfer(transfer) = &self.kind {
            if transfer.flags.contains(&ReviewFlag::AddressPoisoning) {
                return Ok(self.fail(Code::PoisonedRecipient, None));
            }
        }
        if core.unlocked_generation() != Some(self.generation) {
            return Ok(self.fail(Code::Locked, None));
        }
        if !self.can_confirm() {
            return Err(SendError::OutOfOrder);
        }
        self.work.reviewed_fee = self.work.fee;
        self.work.reviewed_deploy_fee = self.work.deploy_fee;
        self.work.attempts = 0;
        Ok(
            self.rpc(Expect::SubmitChain, RpcPurpose::ChainId, false, |_, id| {
                crate::rpc::chain_id_request(id)
            }),
        )
    }

    /// A failure after an accepted automatic deployment names the deployment
    /// ("Account deployment … completed, but the following transaction could not be confirmed").
    fn after_deployment(&mut self, code: Code, hash: Option<Felt>) -> SendStep {
        if self.work.deployment_accepted {
            let deploy = self.work.deploy_hash;
            return self.fail(Code::DeploymentThenInvokeUnconfirmed, deploy);
        }
        self.fail(code, hash)
    }

    fn read_nonce(&mut self, expect: Expect) -> SendStep {
        self.rpc(expect, RpcPurpose::Nonce, false, |s, id| {
            rpc_bodies::nonce(id, &s.account.address)
        })
    }

    pub(crate) fn on_submit_reply(
        &mut self,
        core: &WalletCore,
        expect: Expect,
        answer: Option<Answer>,
    ) -> SendStep {
        let address = self.account.address;
        match expect {
            Expect::SubmitChain => match judge::chain(answer, self.account.network) {
                ChainAnswer::Match => self.rpc(
                    Expect::SubmitClass,
                    RpcPurpose::ClassHashAt,
                    false,
                    |_, id| rpc_bodies::class_hash_at(id, &address),
                ),
                ChainAnswer::Mismatch => self.fail(Code::WrongChain, None),
                ChainAnswer::Unreadable => self.fail(Code::PreparationUnavailable, None),
            },
            Expect::SubmitClass => {
                let verdict = judge::class_hash(answer);
                match verdict {
                    ClassHashAnswer::Deployed if !self.is_transfer() => {
                        self.fail(Code::AlreadyDeployed, None)
                    }
                    ClassHashAnswer::Deployed | ClassHashAnswer::Undeployed => {
                        self.work.submit_deployed = verdict == ClassHashAnswer::Deployed;
                        self.read_nonce(Expect::SubmitNonce)
                    }
                    ClassHashAnswer::NodeError => self.fail(Code::NodeError, None),
                    ClassHashAnswer::Unreadable => self.fail(Code::PreparationUnavailable, None),
                }
            }
            Expect::SubmitNonce => match judge::nonce(answer) {
                Some(nonce) => {
                    self.work.nonce = nonce;
                    if self.is_transfer() {
                        let deployed = self.work.submit_deployed;
                        self.rpc(
                            Expect::SubmitEstimate,
                            RpcPurpose::EstimateFee,
                            false,
                            |s, id| s.invoke_estimate_body(id, deployed),
                        )
                    } else {
                        self.rpc(
                            Expect::DeployEstimate,
                            RpcPurpose::EstimateDeploymentFee,
                            false,
                            |s, id| s.deploy_estimate_body(id),
                        )
                    }
                }
                None => self.fail(Code::PreparationUnavailable, None),
            },
            Expect::SubmitEstimate => self.on_invoke_estimate(answer),
            Expect::DeployClass => match judge::class_hash(answer) {
                ClassHashAnswer::Deployed => self.read_nonce(Expect::InvokeNonce),
                ClassHashAnswer::Undeployed if self.work.reviewed_deploy_fee.is_none() => {
                    self.fail(Code::ReviewedDeploymentFeeRequired, None)
                }
                ClassHashAnswer::Undeployed => self.read_nonce(Expect::DeployNonce),
                ClassHashAnswer::NodeError => self.fail(Code::NodeError, None),
                ClassHashAnswer::Unreadable => self.fail(Code::PreparationUnavailable, None),
            },
            Expect::DeployNonce => match judge::nonce(answer) {
                Some(nonce) => {
                    self.work.nonce = nonce;
                    self.rpc(
                        Expect::DeployEstimate,
                        RpcPurpose::EstimateDeploymentFee,
                        false,
                        |s, id| s.deploy_estimate_body(id),
                    )
                }
                None => self.fail(Code::DeploymentStatusUnknown, None),
            },
            Expect::DeployEstimate => self.on_deploy_estimate(core, answer),
            Expect::DeployWrite => self.on_deploy_write(core, answer),
            Expect::DeployStatus => self.on_deploy_status(core, answer),
            Expect::DeployReceipt => {
                if judge::receipt(answer) {
                    self.work.deployment_accepted = true;
                    self.work.attempts = 0;
                    self.read_nonce(Expect::InvokeNonce)
                } else {
                    self.retry_deploy_wait(AfterWait::DeployReceipt)
                }
            }
            Expect::InvokeNonce => match judge::nonce(answer) {
                Some(nonce) => self.sign_and_send_invoke(core, nonce),
                None => self.after_deployment(Code::PreparationUnavailable, None),
            },
            Expect::InvokeWrite => self.on_invoke_write(core, answer),
            Expect::ConfirmStatus | Expect::RefreshStatus => {
                self.on_confirm_status(core, expect, answer)
            }
            _ => self.fail(Code::NodeError, None),
        }
    }

    fn on_invoke_estimate(&mut self, answer: Option<Answer>) -> SendStep {
        let deployed = self.work.submit_deployed;
        let Some(reviewed) = self.work.reviewed_fee else {
            return self.fail(Code::ReviewedFeeRequired, None);
        };
        let entries = match judge::estimate(answer) {
            EstimateAnswer::Entries(entries) => entries,
            EstimateAnswer::NodeError => return self.fail(Code::NodeError, None),
            EstimateAnswer::Unreadable => return self.fail(Code::PreparationUnavailable, None),
        };
        let entry = entries.get(usize::from(!deployed));
        match settle(entry, &reviewed, Code::ReviewedFeeExceeded, Code::NodeError) {
            Settled::Refused(code) => self.fail(code, None),
            Settled::Bounds(bounds) => {
                self.work.invoke_bounds = Some(bounds);
                if deployed {
                    self.read_nonce(Expect::InvokeNonce)
                } else {
                    let address = self.account.address;
                    self.rpc(
                        Expect::DeployClass,
                        RpcPurpose::ClassHashAt,
                        false,
                        |_, id| rpc_bodies::class_hash_at(id, &address),
                    )
                }
            }
        }
    }

    fn sign_and_send_invoke(&mut self, core: &WalletCore, nonce: Felt) -> SendStep {
        let (Some(bounds), Kind::Transfer(transfer)) = (self.work.invoke_bounds, &self.kind) else {
            return self.fail(Code::ReviewedFeeRequired, None);
        };
        let hash = match sign::invoke_hash(
            self.account.network,
            &self.account.address,
            &transfer.calldata,
            &nonce,
            &bounds,
        ) {
            Ok(hash) => hash,
            Err(refusal) => return self.after_deployment(refusal_code(refusal), None),
        };
        let signature = match self.sign(core, &hash) {
            Ok(signature) => signature,
            Err(code) => return self.after_deployment(code, None),
        };
        self.work.invoke_hash = Some(hash);
        self.persist_pending(core, &hash, true);
        self.rpc(Expect::InvokeWrite, RpcPurpose::AddInvoke, true, |s, id| {
            let unsigned = s.invoke_tx(&nonce).expect("transfer plan has an invoke");
            rpc_bodies::add_invoke(
                id,
                &InvokeTx {
                    bounds: Some(&bounds),
                    signature: Some(&signature),
                    ..unsigned
                },
            )
        })
    }

    fn on_invoke_write(&mut self, core: &WalletCore, answer: Option<Answer>) -> SendStep {
        let Some(hash) = self.work.invoke_hash else {
            return self.fail(Code::SubmissionIndeterminate, None);
        };
        match judge::write(answer, &hash) {
            WriteAnswer::Accepted => self.broadcast(hash),
            WriteAnswer::Mismatch => self.after_deployment(Code::HashMismatch, Some(hash)),
            WriteAnswer::Indeterminate => {
                self.after_deployment(Code::SubmissionIndeterminate, Some(hash))
            }
            WriteAnswer::NodeError => {
                // A determinate refusal: the transaction never existed, so its pending record
                // goes (the extension records activity only after an accepted write).
                store::discard(core.data_dir(), &self.account.account_id, &hash);
                self.after_deployment(Code::NodeError, None)
            }
        }
    }

    fn on_confirm_status(
        &mut self,
        core: &WalletCore,
        expect: Expect,
        answer: Option<Answer>,
    ) -> SendStep {
        let Some(hash) = self.target_hash() else {
            return self.fail(Code::SubmissionIndeterminate, None);
        };
        let observation = judge::status(answer);
        let recorded = store::observe(
            core.data_dir(),
            &self.account.account_id,
            &hash,
            observation,
        );
        let status = recorded.unwrap_or(match observation {
            Observation::Found { status, .. } => status,
            _ => TxStatus::Pending,
        });
        if expect == Expect::RefreshStatus || status != TxStatus::Pending {
            return self.finish(status, hash);
        }
        let next = self.work.checkpoint + 1;
        self.checkpoint(next)
    }

    /// Signs under the plan's session generation. The public key must be the account's.
    pub(super) fn sign(&mut self, core: &WalletCore, hash: &Felt) -> Result<[Felt; 2], Code> {
        let signature = core
            .plan_sign(self.generation, self.account.index, hash)
            .map_err(|error| match error {
                CoreError::Locked | CoreError::NoWallet => Code::Locked,
                _ => Code::SigningFailed,
            })?;
        let parsed = (
            felt::parse(&signature.public_key),
            felt::parse(&signature.r),
            felt::parse(&signature.s),
        );
        match parsed {
            (Some(public_key), Some(r), Some(s)) if public_key == self.account.public_key => {
                self.signatures += 1;
                Ok([r, s])
            }
            _ => Err(Code::SigningFailed),
        }
    }

    /// Persists the pending record for a write about to leave the core. Best effort, as the
    /// extension's `recordSubmittedActivity`: a storage failure never blocks or rewrites a send.
    pub(super) fn persist_pending(&self, core: &WalletCore, hash: &Felt, invoke: bool) {
        let network_id = super::plan::network_id_text(self.account.network);
        let (kind, summary, amount, counterparty, token) = match (&self.kind, invoke) {
            (Kind::Transfer(t), true) => (
                store::kind_text(ActivityKind::Transfer),
                t.summary.clone(),
                Some(t.amount_text.clone()),
                Some(felt::canonical(&t.recipient)),
                Some(t.symbol.clone()),
            ),
            _ => (
                store::kind_text(ActivityKind::Deploy),
                DEPLOY_SUMMARY.to_string(),
                None,
                None,
                None,
            ),
        };
        store::record(
            core.data_dir(),
            Entry {
                account_id: self.account.account_id.clone(),
                amount,
                counterparty,
                finalized_on_l1: None,
                hash: felt::canonical(hash),
                kind: kind.into(),
                network_id: network_id.into(),
                not_found_count: None,
                status: "pending".into(),
                submitted_at: self.work.now_ms,
                summary,
                token,
            },
        );
    }
}
