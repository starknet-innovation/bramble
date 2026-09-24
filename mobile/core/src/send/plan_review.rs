//! The review half of a plan: prove the chain, read deployment state and nonce, estimate the
//! invoke (bulk with the deployment when undeployed) and the deployment, then build the review.
//! Mirrors `reviewWalletFundedFees` + `estimateInvokeFee` + `estimateAccountDeploymentFee`.

use serde_json::Value;
use starknet_types_core::felt::Felt;

use super::fees::{self, FeeQuote};
use super::judge::{self, Answer, ChainAnswer, ClassHashAnswer, EstimateAnswer};
use super::plan::{Expect, Kind, PlanState};
use super::rpc_bodies::{self, DeployTx, InvokeTx};
use super::types::{
    FeeAffordability, ReviewFlag, RpcPurpose, SendFailureCode, SendStep, TransferReview,
};
use crate::felt;

/// The standalone Deploy account summary (`deployment-ops.ts`).
pub const DEPLOY_SUMMARY: &str = "Deploy account contract";

/// A quote from the estimate entry at `index`, or `None` when absent or unusable.
pub(crate) fn entry_quote(entries: &[Value], index: usize) -> Option<FeeQuote> {
    fees::quote(entries.get(index)?)
        .ok()
        .map(|(_, quote)| quote)
}

impl PlanState {
    /// The INVOKE this plan estimates or signs, at `nonce`.
    pub(crate) fn invoke_tx<'a>(&'a self, nonce: &'a Felt) -> Option<InvokeTx<'a>> {
        match &self.kind {
            Kind::Transfer(transfer) => Some(InvokeTx {
                sender: &self.account.address,
                calldata: &transfer.calldata,
                nonce,
                bounds: None,
                signature: None,
            }),
            _ => None,
        }
    }

    /// The DEPLOY_ACCOUNT this plan estimates or signs, at `nonce`.
    pub(crate) fn deploy_tx<'a>(&'a self, nonce: &'a Felt) -> DeployTx<'a> {
        DeployTx {
            class_hash: &self.account.class_hash,
            public_key: &self.account.public_key,
            nonce,
            bounds: None,
            signature: None,
        }
    }

    /// `[INVOKE]` when deployed, `[DEPLOY_ACCOUNT nonce, INVOKE nonce + 1]` when not.
    pub(crate) fn invoke_estimate_body(&self, id: u64, deployed: bool) -> String {
        let nonce = self.work.nonce;
        if deployed {
            return rpc_bodies::estimate(id, self.invoke_tx(&nonce).as_ref(), None);
        }
        let next = nonce + Felt::ONE;
        rpc_bodies::estimate(
            id,
            self.invoke_tx(&next).as_ref(),
            Some(&self.deploy_tx(&nonce)),
        )
    }

    pub(crate) fn deploy_estimate_body(&self, id: u64) -> String {
        let nonce = self.work.nonce;
        rpc_bodies::estimate(id, None, Some(&self.deploy_tx(&nonce)))
    }

    fn read_deploy_nonce(&mut self) -> SendStep {
        self.rpc(
            Expect::ReviewDeployNonce,
            RpcPurpose::Nonce,
            false,
            |s, id| rpc_bodies::nonce(id, &s.account.address),
        )
    }

    pub(crate) fn on_review_reply(&mut self, expect: Expect, answer: Option<Answer>) -> SendStep {
        let address = self.account.address;
        match expect {
            Expect::ReviewChain => match judge::chain(answer, self.account.network) {
                ChainAnswer::Match => self.rpc(
                    Expect::ReviewClass,
                    RpcPurpose::ClassHashAt,
                    false,
                    |_, id| rpc_bodies::class_hash_at(id, &address),
                ),
                ChainAnswer::Mismatch => self.fail(SendFailureCode::WrongChain, None),
                ChainAnswer::Unreadable => self.review_unknown(),
            },
            Expect::ReviewClass => match judge::class_hash(answer) {
                ClassHashAnswer::Deployed => {
                    self.work.deployed = Some(true);
                    if matches!(self.kind, Kind::Deployment) {
                        self.work.already_deployed = true;
                        return self.review();
                    }
                    self.rpc(Expect::ReviewNonce, RpcPurpose::Nonce, false, |_, id| {
                        rpc_bodies::nonce(id, &address)
                    })
                }
                ClassHashAnswer::Undeployed => {
                    self.work.deployed = Some(false);
                    self.work.requires_deployment = true;
                    if matches!(self.kind, Kind::Deployment) {
                        return self.read_deploy_nonce();
                    }
                    self.rpc(Expect::ReviewNonce, RpcPurpose::Nonce, false, |_, id| {
                        rpc_bodies::nonce(id, &address)
                    })
                }
                ClassHashAnswer::NodeError | ClassHashAnswer::Unreadable => self.review_unknown(),
            },
            Expect::ReviewNonce => {
                let deployed = self.work.deployed == Some(true);
                match judge::nonce(answer) {
                    Some(nonce) => {
                        self.work.nonce = nonce;
                        self.rpc(
                            Expect::ReviewEstimate,
                            RpcPurpose::EstimateFee,
                            false,
                            |s, id| s.invoke_estimate_body(id, deployed),
                        )
                    }
                    None if deployed => self.review(),
                    None => self.read_deploy_nonce(),
                }
            }
            Expect::ReviewEstimate => {
                let deployed = self.work.deployed == Some(true);
                if let EstimateAnswer::Entries(entries) = judge::estimate(answer) {
                    self.work.fee = entry_quote(&entries, usize::from(!deployed));
                }
                if deployed {
                    self.review()
                } else {
                    self.read_deploy_nonce()
                }
            }
            Expect::ReviewDeployNonce => match judge::nonce(answer) {
                Some(nonce) => {
                    self.work.nonce = nonce;
                    self.rpc(
                        Expect::ReviewDeployEstimate,
                        RpcPurpose::EstimateDeploymentFee,
                        false,
                        |s, id| s.deploy_estimate_body(id),
                    )
                }
                None => self.review(),
            },
            Expect::ReviewDeployEstimate => {
                if let EstimateAnswer::Entries(entries) = judge::estimate(answer) {
                    self.work.deploy_fee = entry_quote(&entries, 0);
                }
                self.review()
            }
            _ => self.fail(SendFailureCode::NodeError, None),
        }
    }

    /// Deployment state unknown: both fees fail closed, as `reviewWalletFundedFees` does.
    fn review_unknown(&mut self) -> SendStep {
        self.work.requires_deployment = true;
        self.work.fee = None;
        self.work.deploy_fee = None;
        self.review()
    }

    /// Whether the reviewed state lets `Confirm` proceed.
    pub(crate) fn can_confirm(&self) -> bool {
        let work = &self.work;
        match &self.kind {
            Kind::Transfer(transfer) => {
                !transfer.flags.contains(&ReviewFlag::AddressPoisoning)
                    && work.fee.is_some()
                    && (!work.requires_deployment || work.deploy_fee.is_some())
            }
            Kind::Deployment => !work.already_deployed && work.deploy_fee.is_some(),
            Kind::Refresh { .. } => false,
        }
    }

    // `resolveFeeAffordability`: FRI fees only; the amount counts when STRK is sent.
    fn affordability(&self) -> FeeAffordability {
        let Kind::Transfer(transfer) = &self.kind else {
            return FeeAffordability::Unknown;
        };
        let total = match (
            self.work.requires_deployment,
            &self.work.fee,
            &self.work.deploy_fee,
        ) {
            (false, Some(fee), _) => Some(*fee),
            (true, Some(fee), Some(deploy)) => fees::sum(fee, deploy),
            _ => None,
        };
        let (Some(total), Some(balance)) = (total, transfer.fee_balance) else {
            return FeeAffordability::Unknown;
        };
        if total.unit != super::types::FeeUnit::Fri {
            return FeeAffordability::Unknown;
        }
        let required = if transfer.is_strk {
            total.spend.checked_add(transfer.amount)
        } else {
            Some(total.spend)
        };
        match required {
            Some(required) if balance >= required => FeeAffordability::Sufficient,
            _ => FeeAffordability::Insufficient,
        }
    }

    pub(crate) fn review(&mut self) -> SendStep {
        let work = &self.work;
        let requires_deployment = work.requires_deployment && !work.already_deployed;
        let review = match &self.kind {
            Kind::Transfer(transfer) => {
                let recipient = felt::canonical(&transfer.recipient);
                TransferReview {
                    summary: transfer.summary.clone(),
                    recipient_short: crate::account_names::short_label(&recipient),
                    recipient,
                    amount_display: transfer.amount_text.clone(),
                    token_symbol: transfer.symbol.clone(),
                    fee: work.fee.as_ref().map(fees::fee_amount),
                    fee_estimate_failed: work.fee.is_none(),
                    deployment_fee: work.deploy_fee.as_ref().map(fees::fee_amount),
                    deployment_fee_estimate_failed: requires_deployment
                        && work.deploy_fee.is_none(),
                    requires_deployment,
                    already_deployed: false,
                    affordability: self.affordability(),
                    flags: transfer.flags.clone(),
                    can_confirm: self.can_confirm(),
                }
            }
            _ => {
                let address = felt::canonical(&self.account.address);
                TransferReview {
                    summary: DEPLOY_SUMMARY.into(),
                    recipient_short: crate::account_names::short_label(&address),
                    recipient: address,
                    amount_display: String::new(),
                    token_symbol: String::new(),
                    fee: None,
                    fee_estimate_failed: false,
                    deployment_fee: work.deploy_fee.as_ref().map(fees::fee_amount),
                    deployment_fee_estimate_failed: !work.already_deployed
                        && work.deploy_fee.is_none(),
                    requires_deployment,
                    already_deployed: work.already_deployed,
                    affordability: FeeAffordability::Unknown,
                    flags: Vec::new(),
                    can_confirm: self.can_confirm(),
                }
            }
        };
        self.reviewed(review)
    }
}
