//! The account-state reads a plan makes before it estimates or signs, as the extension's
//! `isCompatibleAccountDeployed` makes them:
//!
//! - OpenZeppelin: `starknet_getClassHashAt` at `latest`; any class means deployed.
//! - Ready (Argent): the latest accepted block (`starknet_blockHashAndNumber`), then the class
//!   at that block. A deployed account must run a class whose authorization this wallet
//!   produces (`requireAuthorizableArgentClass`: Argent 0.4.0's signer array), and, at the same
//!   block, report this wallet's key as a Starknet-signer owner and no guardian
//!   (`requireCompatibleArgentSigner`). An account that fails any check is never signed for.
//! - Braavos: the same accepted block, then the class at that block, which must be an
//!   implementation this wallet signs for (`requireBraavosSigningClass`), then `get_signers`:
//!   this wallet's key must be the first Stark signer, and any 2FA signer must have a requested
//!   removal that expired before the block's timestamp (`requireCompatibleBraavosSigner`).
//!
//! Each read carries the `Probe` it belongs to, and `probed` hands the outcome to that step of
//! the review or submit path.

use starknet_types_core::felt::Felt;

use super::judge::{self, Answer, CallAnswer, ClassHashAnswer, ClassValue};
use super::plan::{Expect, Kind, PlanState};
use super::rpc_bodies;
use super::types::{RpcPurpose, SendFailure, SendFailureCode as Code, SendStep};
use crate::account_catalog::{catalog, class_entry, AccountFamily};

/// `get_owner`, `get_owner_type` and `get_guardian` (`starknet_keccak` of each name).
const GET_OWNER: &str = "0x3ee0bfaf5b124501fef19bbd1312e71f6966d186c42eeb91d1bff729b91d1d4";
const GET_OWNER_TYPE: &str = "0xae4c53adcf230c976273bd2a636233f06e97b1d4a68208d3d10a80d2f8a0a4";
const GET_GUARDIAN: &str = "0x24fd89f2d8a7798e705aa5361f39154ca43e03721c05188285138f16018955d";
/// Braavos's `get_signers` and `get_deferred_remove_signers`.
const GET_SIGNERS: &str = "0x2b8faca80de28f81027b46c4f3cb534c44616e721ae9f1e96539c6b54a1d932";
const GET_DEFERRED_REMOVE_SIGNERS: &str =
    "0x3f4c3fd98c1f85cfe943da13a3e1970248bf364130b9590071520aa2ec61e93";

/// The authorization shape this wallet produces for Ready accounts.
const ARGENT_SIGNER_ARRAY: &str = "argent-signer-array";

/// Which step of the plan an account-state read belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Probe {
    /// The review's deployment check (`getDeploymentStatus` / the invoke estimate's).
    Review,
    /// Ready only: `estimateAccountDeploymentFee` re-reads the account before estimating.
    ReviewDeploy,
    /// The confirmation's check (`submitInvokeTransaction` / `submitAccountDeployment`).
    Submit,
    /// `ensureAccountDeployed`, just before the automatic deployment.
    Deploy,
}

/// What an account-state read concluded.
pub(crate) enum Outcome {
    Deployed,
    Undeployed,
    /// Deployed, but not an account this wallet may sign for.
    Refused(SendFailure),
    NodeError,
    Unreadable,
}

fn refused(code: Code, detail: Option<String>) -> Outcome {
    Outcome::Refused(SendFailure {
        code,
        hash: None,
        detail,
    })
}

fn selector(hex: &str) -> Felt {
    Felt::from_hex(hex).expect("selector constant is a felt")
}

/// `requireAuthorizableArgentClass`: the live class must be a known Argent class whose
/// authorization is the signer array this wallet produces.
fn authorizable(class_hash: &Felt) -> Result<(), Outcome> {
    match class_entry(class_hash) {
        Some(entry) if entry.family == AccountFamily::Argent => {
            if entry.info.authorization_shape == ARGENT_SIGNER_ARRAY {
                Ok(())
            } else {
                Err(refused(
                    Code::AccountClassUnsupported,
                    Some(entry.info.label.clone()),
                ))
            }
        }
        _ => Err(refused(Code::AccountClassUnrecognised, None)),
    }
}

/// `parseBraavosSigners`: `get_signers` serialises three felt arrays, `[stark_len, ...stark,
/// secp256r1_len, ...secp256r1, webauthn_len, ...webauthn]`. Returns the first Stark signer and
/// whether any strong (2FA) signer exists; `None` when a length overruns the result.
fn braavos_signers(result: &[Felt]) -> Option<(Option<Felt>, bool)> {
    let mut lists = Vec::with_capacity(3);
    let mut offset = 0;
    for _ in 0..3 {
        let length = usize::try_from(
            result
                .get(offset)
                .copied()
                .unwrap_or(Felt::ZERO)
                .to_biguint(),
        )
        .ok()?;
        let values =
            result.get(offset + 1..length.checked_add(1).and_then(|n| offset.checked_add(n))?)?;
        lists.push(values);
        offset += 1 + length;
    }
    Some((
        lists[0].first().copied(),
        lists[1].len() + lists[2].len() > 0,
    ))
}

impl PlanState {
    /// Starts the account-state reads for `probe`.
    pub(crate) fn probe(&mut self, probe: Probe) -> SendStep {
        let address = self.account.address;
        if !self.account.is_argent() && !self.account.is_braavos() {
            return self.rpc(
                Expect::Class(probe),
                RpcPurpose::ClassHashAt,
                false,
                |_, id| rpc_bodies::class_hash_at(id, &address),
            );
        }
        self.rpc(
            Expect::Block(probe),
            RpcPurpose::AcceptedBlock,
            false,
            |_, id| rpc_bodies::block_hash_and_number(id),
        )
    }

    fn signer_read(&mut self, expect: Expect, name: &str) -> SendStep {
        let (address, block, selector) = (self.account.address, self.work.block, selector(name));
        self.rpc(expect, RpcPurpose::AccountSigner, false, |_, id| {
            rpc_bodies::call_at_block(id, &address, &selector, &block)
        })
    }

    pub(crate) fn on_probe_reply(&mut self, expect: Expect, answer: Option<Answer>) -> SendStep {
        match expect {
            Expect::Block(probe) => match judge::accepted_block(answer) {
                Ok(block) => {
                    self.work.block = block;
                    let address = self.account.address;
                    self.rpc(
                        Expect::Class(probe),
                        RpcPurpose::ClassHashAt,
                        false,
                        |_, id| rpc_bodies::class_hash_at_block(id, &address, &block),
                    )
                }
                Err(true) => self.probed(probe, Outcome::NodeError),
                Err(false) => self.probed(probe, Outcome::Unreadable),
            },
            Expect::Class(probe) if !self.account.is_argent() && !self.account.is_braavos() => {
                let outcome = match judge::class_hash(answer) {
                    ClassHashAnswer::Deployed => Outcome::Deployed,
                    ClassHashAnswer::Undeployed => Outcome::Undeployed,
                    ClassHashAnswer::NodeError => Outcome::NodeError,
                    ClassHashAnswer::Unreadable => Outcome::Unreadable,
                };
                self.probed(probe, outcome)
            }
            Expect::Class(probe) => match judge::class_value(answer) {
                // The standalone deployment only needs to know it has nothing to deploy.
                ClassValue::Class(_)
                    if probe == Probe::Review && matches!(self.kind, Kind::Deployment) =>
                {
                    self.probed(probe, Outcome::Deployed)
                }
                ClassValue::Class(class) if self.account.is_braavos() => {
                    if catalog().braavos_signing.contains(&class) {
                        self.signer_read(Expect::Signers(probe), GET_SIGNERS)
                    } else {
                        self.probed(probe, refused(Code::BraavosClassUnrecognised, None))
                    }
                }
                ClassValue::Class(class) => match authorizable(&class) {
                    Ok(()) => self.signer_read(Expect::Owner(probe), GET_OWNER),
                    Err(outcome) => self.probed(probe, outcome),
                },
                ClassValue::Undeployed => self.probed(probe, Outcome::Undeployed),
                ClassValue::NodeError => self.probed(probe, Outcome::NodeError),
                ClassValue::Unreadable => self.probed(probe, Outcome::Unreadable),
            },
            Expect::Owner(probe) => {
                self.work.owner = Some(judge::single_felt(answer));
                self.signer_read(Expect::OwnerType(probe), GET_OWNER_TYPE)
            }
            Expect::OwnerType(probe) => {
                let owner = self.work.owner.take().unwrap_or(CallAnswer::Unreadable);
                let owner_type = judge::single_felt(answer);
                match (owner, owner_type) {
                    (CallAnswer::NodeError, _) => self.probed(probe, Outcome::NodeError),
                    (CallAnswer::Unreadable, _) => self.probed(probe, Outcome::Unreadable),
                    (_, CallAnswer::NodeError) => self.probed(probe, Outcome::NodeError),
                    (_, CallAnswer::Unreadable) => self.probed(probe, Outcome::Unreadable),
                    (CallAnswer::Value(owner), _) if owner != Some(self.account.public_key) => {
                        self.probed(probe, refused(Code::AccountOwnerMismatch, None))
                    }
                    (_, CallAnswer::Value(kind)) if kind != Some(Felt::ZERO) => {
                        self.probed(probe, refused(Code::AccountOwnerTypeUnsupported, None))
                    }
                    _ => self.signer_read(Expect::Guardian(probe), GET_GUARDIAN),
                }
            }
            Expect::Guardian(probe) => {
                let outcome = match judge::single_felt(answer) {
                    CallAnswer::Value(Some(guardian)) if guardian == Felt::ZERO => {
                        Outcome::Deployed
                    }
                    CallAnswer::Value(_) => refused(Code::AccountGuardianUnsupported, None),
                    CallAnswer::NodeError => Outcome::NodeError,
                    CallAnswer::Unreadable => Outcome::Unreadable,
                };
                self.probed(probe, outcome)
            }
            Expect::Signers(probe) => match judge::call_felts(answer) {
                Ok(result) => match braavos_signers(&result) {
                    Some((first, _)) if first != Some(self.account.public_key) => {
                        self.probed(probe, refused(Code::BraavosOwnerMismatch, None))
                    }
                    Some((_, false)) => self.probed(probe, Outcome::Deployed),
                    Some((_, true)) => self
                        .signer_read(Expect::DeferredRemoval(probe), GET_DEFERRED_REMOVE_SIGNERS),
                    // A length that overruns the result. An RPC error took the `Err` arm above.
                    None => self.probed(probe, refused(Code::BraavosSignerListMalformed, None)),
                },
                Err(node) => self.probed(probe, Self::read_failed(node)),
            },
            // A 2FA signer counts as removed only once its requested removal has expired by the
            // block's own timestamp; no request at all leaves it active.
            Expect::DeferredRemoval(probe) => match judge::call_felts(answer) {
                Ok(result) => match result.first().copied().unwrap_or(Felt::ZERO) {
                    expire_at if expire_at == Felt::ZERO => {
                        self.probed(probe, refused(Code::BraavosStrongSigner, None))
                    }
                    expire_at => {
                        self.work.expire_at = expire_at;
                        let block = self.work.block;
                        self.rpc(
                            Expect::BlockTime(probe),
                            RpcPurpose::AccountSigner,
                            false,
                            |_, id| rpc_bodies::block_at(id, &block),
                        )
                    }
                },
                Err(node) => self.probed(probe, Self::read_failed(node)),
            },
            Expect::BlockTime(probe) => match judge::block_timestamp(answer) {
                Ok(timestamp) if Felt::from(timestamp) > self.work.expire_at => {
                    self.probed(probe, Outcome::Deployed)
                }
                Ok(_) => self.probed(probe, refused(Code::BraavosStrongSigner, None)),
                Err(node) => self.probed(probe, Self::read_failed(node)),
            },
            _ => self.fail(Code::NodeError, None),
        }
    }

    fn read_failed(node: bool) -> Outcome {
        if node {
            Outcome::NodeError
        } else {
            Outcome::Unreadable
        }
    }

    /// Hands a finished account-state read to the step it belongs to.
    fn probed(&mut self, probe: Probe, outcome: Outcome) -> SendStep {
        match probe {
            Probe::Review => self.review_probed(outcome),
            Probe::ReviewDeploy => self.review_deploy_probed(outcome),
            Probe::Submit => self.submit_probed(outcome),
            Probe::Deploy => self.deploy_probed(outcome),
        }
    }

    /// Ends the plan with an account refusal.
    pub(crate) fn refuse(&mut self, failure: SendFailure) -> SendStep {
        let step = self.fail(failure.code, None);
        match step {
            SendStep::Failed { failure: mut out } => {
                out.detail = failure.detail;
                SendStep::Failed { failure: out }
            }
            other => other,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selectors_are_starknet_keccak() {
        use sha3::{Digest, Keccak256};
        for (name, expected) in [
            ("get_owner", GET_OWNER),
            ("get_owner_type", GET_OWNER_TYPE),
            ("get_guardian", GET_GUARDIAN),
            ("get_signers", GET_SIGNERS),
            ("get_deferred_remove_signers", GET_DEFERRED_REMOVE_SIGNERS),
        ] {
            let mut digest: [u8; 32] = Keccak256::digest(name.as_bytes()).into();
            digest[0] &= 0x03;
            assert_eq!(Felt::from_bytes_be(&digest), selector(expected), "{name}");
        }
    }

    #[test]
    fn only_the_signer_array_class_is_authorizable() {
        let catalog = crate::account_catalog::catalog();
        assert!(authorizable(&catalog.argent_default).is_ok());
        for entry in crate::account_catalog::deployment_classes(AccountFamily::Argent) {
            let verdict = authorizable(&entry.class_hash);
            if entry.info.authorization_shape == ARGENT_SIGNER_ARRAY {
                assert!(verdict.is_ok());
            } else {
                let Err(Outcome::Refused(failure)) = verdict else {
                    panic!("{} accepted", entry.info.label);
                };
                assert_eq!(failure.code, Code::AccountClassUnsupported);
                assert_eq!(failure.detail.as_deref(), Some(entry.info.label.as_str()));
            }
        }
        for foreign in [Felt::from(0x1234u32), catalog.open_zeppelin_class] {
            assert!(matches!(
                authorizable(&foreign),
                Err(Outcome::Refused(SendFailure {
                    code: Code::AccountClassUnrecognised,
                    ..
                }))
            ));
        }
    }

    #[test]
    fn braavos_signer_lists_parse_like_the_extension() {
        let f = |values: &[u64]| values.iter().map(|v| Felt::from(*v)).collect::<Vec<_>>();
        assert_eq!(
            braavos_signers(&f(&[1, 9, 0, 0])),
            Some((Some(Felt::from(9u8)), false))
        );
        assert_eq!(
            braavos_signers(&f(&[1, 9, 4, 1, 2, 3, 4, 0])),
            Some((Some(Felt::from(9u8)), true))
        );
        assert_eq!(
            braavos_signers(&f(&[1, 9, 0, 1, 5])),
            Some((Some(Felt::from(9u8)), true))
        );
        assert_eq!(braavos_signers(&f(&[0, 0, 0])), Some((None, false)));
        // A length that overruns the result is malformed, as is a missing list.
        assert_eq!(braavos_signers(&f(&[2, 9, 0, 0])), None);
        assert_eq!(braavos_signers(&f(&[1, 9])), None);
        // A length near usize::MAX (from a hostile node) is malformed, never an overflow.
        assert_eq!(braavos_signers(&f(&[u64::MAX, 9])), None);
    }
}
