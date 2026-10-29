//! The automatic (and standalone) account deployment inside a plan, as the extension's
//! `ensureAccountDeployed` / `submitAccountDeployment`: re-estimate against the separately
//! reviewed deployment fee, sign `compute_deploy_account_v3_hash` over the account's own
//! deployment (OpenZeppelin, Ready, or Braavos with its extended authorization), persist the
//! pending record,
//! broadcast once, then wait for ACCEPTED_ON_L2/L1 and the receipt like starknet.js
//! `waitForTransaction` (bounded at 200 attempts).

use starknet_types_core::felt::Felt;

use super::judge::{self, Answer, EstimateAnswer, Observation, WriteAnswer};
use super::plan::{AfterWait, Expect, PlanState, DEPLOY_POLL_ATTEMPTS, DEPLOY_POLL_INTERVAL_MS};
use super::plan_submit::{refusal_code, settle, Settled};
use super::rpc_bodies::{self, DeployTx};
use super::sign;
use super::types::{RpcPurpose, SendFailureCode as Code, SendStep, TxStatus};
use crate::account_catalog::catalog;
use crate::activity::store;
use crate::wallet::WalletCore;

impl PlanState {
    /// Braavos's extended deploy authorization (`braavosDeploySignature`): `[r, s, ...params,
    /// aux_r, aux_s]`, where `(aux_r, aux_s)` signs `poseidon(params)` with the same key. The
    /// parameters are signed first, as the extension signs them, so `hash` is the last signed.
    pub(super) fn braavos_deploy_signature(
        &mut self,
        core: &WalletCore,
        hash: &Felt,
        renew: bool,
    ) -> Result<Vec<Felt>, Code> {
        let params =
            sign::braavos_deploy_params(self.account.network, catalog().braavos_implementation);
        let aux = self.sign_renewing(core, &sign::braavos_params_hash(&params), renew)?;
        let mut signature = self.sign_renewing(core, hash, renew)?;
        signature.extend(params);
        signature.extend(aux);
        Ok(signature)
    }

    /// Emits the deployment estimate at the read nonce. Ready validates its query signature and
    /// OpenZeppelin skips validation; Braavos validates a real signature over the query-version
    /// hash, since its constructor checks the deploy authorization even in an estimate.
    pub(crate) fn estimate_deployment(&mut self, core: &WalletCore, expect: Expect) -> SendStep {
        let nonce = self.work.nonce;
        let (signature, skip) = match self.account.deployment.as_ref() {
            Some(deployment) if self.account.is_braavos() => {
                let hash = sign::deploy_query_hash(
                    self.account.network,
                    &self.account.address,
                    deployment,
                    &nonce,
                );
                // The review's estimate is passive; the confirmed re-estimate renews.
                let renew = expect != Expect::ReviewDeployEstimate;
                match self.braavos_deploy_signature(core, &hash, renew) {
                    Ok(signature) => (signature, false),
                    Err(code) => return self.fail(code, None),
                }
            }
            _ => (self.account.query_signature(), !self.account.is_argent()),
        };
        self.rpc(
            expect,
            RpcPurpose::EstimateDeploymentFee,
            false,
            move |s, id| {
                rpc_bodies::estimate(id, None, s.deploy_tx(&nonce, &signature).as_ref(), skip)
            },
        )
    }

    pub(super) fn on_deploy_estimate(
        &mut self,
        core: &WalletCore,
        answer: Option<Answer>,
    ) -> SendStep {
        // Inside `ensureAccountDeployed` a transport failure is "deployment status unknown" and
        // any other error "automatic deployment failed"; the standalone flow reports them as
        // any other write preparation does.
        let transfer = self.is_transfer();
        let (transport, node) = if transfer {
            (Code::DeploymentStatusUnknown, Code::AutoDeploymentFailed)
        } else {
            (Code::PreparationUnavailable, Code::NodeError)
        };
        let Some(reviewed) = self.work.reviewed_deploy_fee else {
            return self.fail(Code::ReviewedDeploymentFeeRequired, None);
        };
        let entries = match judge::estimate(answer) {
            EstimateAnswer::Entries(entries) => entries,
            EstimateAnswer::NodeError => return self.fail(node, None),
            EstimateAnswer::Unreadable => return self.fail(transport, None),
        };
        let bounds = match settle(
            entries.first(),
            &reviewed,
            Code::ReviewedDeploymentFeeExceeded,
            node,
        ) {
            Settled::Bounds(bounds) => bounds,
            Settled::Refused(Code::PreparationUnavailable) => return self.fail(transport, None),
            Settled::Refused(code) => return self.fail(code, None),
        };
        let account = &self.account;
        let Some(deployment) = account.deployment.as_ref() else {
            return self.fail(Code::AccountNotDeployable, None);
        };
        let hash = match sign::deploy_hash(account.network, &account.address, deployment, &bounds) {
            Ok(hash) => hash,
            Err(refusal) => return self.fail(refusal_code(refusal), None),
        };
        let signed = if self.account.is_braavos() {
            self.braavos_deploy_signature(core, &hash, true)
        } else {
            self.sign(core, &hash)
        };
        let signature = match signed {
            Ok(signature) => signature,
            Err(code) => return self.fail(code, None),
        };
        self.work.deploy_hash = Some(hash);
        self.persist_pending(core, &hash, false);
        self.rpc(
            Expect::DeployWrite,
            RpcPurpose::AddDeployAccount,
            true,
            |s, id| {
                let zero = Felt::ZERO;
                let unsigned = s
                    .deploy_tx(&zero, &signature)
                    .expect("a signed deployment has its parameters");
                rpc_bodies::add_deploy(
                    id,
                    &DeployTx {
                        bounds: Some(&bounds),
                        ..unsigned
                    },
                )
            },
        )
    }

    pub(super) fn on_deploy_write(
        &mut self,
        core: &WalletCore,
        answer: Option<Answer>,
    ) -> SendStep {
        let Some(hash) = self.work.deploy_hash else {
            return self.fail(Code::SubmissionIndeterminate, None);
        };
        let verdict = judge::write(answer, &hash);
        if verdict == WriteAnswer::NodeError {
            // A determinate refusal: the deployment never existed; drop its pending record.
            store::discard(&core.data_dir, &self.account.account_id, &hash);
        }
        if !self.is_transfer() {
            return match verdict {
                WriteAnswer::Accepted => self.broadcast(hash),
                WriteAnswer::Mismatch => self.fail(Code::HashMismatch, Some(hash)),
                WriteAnswer::Indeterminate => self.fail(Code::SubmissionIndeterminate, Some(hash)),
                WriteAnswer::NodeError => self.fail(Code::NodeError, None),
            };
        }
        match verdict {
            WriteAnswer::Accepted => self.wait(DEPLOY_POLL_INTERVAL_MS, AfterWait::DeployStatus),
            WriteAnswer::Mismatch | WriteAnswer::Indeterminate => {
                self.fail(Code::DeploymentStatusUnknown, Some(hash))
            }
            WriteAnswer::NodeError => self.fail(Code::AutoDeploymentFailed, None),
        }
    }

    pub(crate) fn poll_deployment(&mut self) -> SendStep {
        let Some(hash) = self.work.deploy_hash else {
            return self.fail(Code::DeploymentStatusUnknown, None);
        };
        self.rpc(
            Expect::DeployStatus,
            RpcPurpose::TransactionStatus,
            false,
            |_, id| rpc_bodies::transaction_status(id, &hash),
        )
    }

    pub(crate) fn read_deploy_receipt(&mut self) -> SendStep {
        let Some(hash) = self.work.deploy_hash else {
            return self.fail(Code::DeploymentStatusUnknown, None);
        };
        self.rpc(
            Expect::DeployReceipt,
            RpcPurpose::TransactionReceipt,
            false,
            |_, id| rpc_bodies::transaction_receipt(id, &hash),
        )
    }

    /// One more deploy-wait attempt, or `DeploymentUnconfirmed` once the budget is spent.
    pub(super) fn retry_deploy_wait(&mut self, after: AfterWait) -> SendStep {
        self.work.attempts += 1;
        if self.work.attempts >= DEPLOY_POLL_ATTEMPTS {
            let hash = self.work.deploy_hash;
            return self.fail(Code::DeploymentUnconfirmed, hash);
        }
        self.wait(DEPLOY_POLL_INTERVAL_MS, after)
    }

    pub(super) fn on_deploy_status(
        &mut self,
        core: &WalletCore,
        answer: Option<Answer>,
    ) -> SendStep {
        let Some(hash) = self.work.deploy_hash else {
            return self.fail(Code::DeploymentStatusUnknown, None);
        };
        let observation = judge::status(answer);
        store::observe(&core.data_dir, &self.account.account_id, &hash, observation);
        match observation {
            Observation::Found {
                accepted_finality: true,
                ..
            } => self.read_deploy_receipt(),
            Observation::Found {
                status: TxStatus::Rejected,
                ..
            } => self.fail(Code::DeploymentUnconfirmed, Some(hash)),
            _ => self.retry_deploy_wait(AfterWait::DeployStatus),
        }
    }
}
