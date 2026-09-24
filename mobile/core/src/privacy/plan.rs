//! `PrivacyReadPlan`: one private-balance read as a core-owned state machine, in the extension's
//! `stateResponse` order (docs/privacy.md §3): chain id, preflight, note discovery when registered,
//! pool fee. The host relays opaque bodies and replies; it cannot pick a URL, reorder a step, or
//! see the viewing key, which is re-derived for every `Post` and never stored here.
//!
//! Reply handling for each read lives in `plan_steps`.

use std::sync::{Arc, Mutex, MutexGuard, Weak};

use starknet_types_core::felt::Felt;

use super::bodies::BlockRef;
use super::config::{Limits, Route};
use super::json::Ordered;
use super::notes::Totals;
use super::types::{PrivacyError, PrivacyFailure, PrivacyReply, PrivacyStep};
use crate::networks::{NetworkId, TokenInfo};
use crate::wallet::WalletCore;

/// Mobile-only bound on discovery pages (the SDK has none).
pub const MAX_DISCOVERY_PAGES: u32 = 256;

/// The read a reply or a pause belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Read {
    Chain,
    Preflight,
    Discovery,
    PoolFee,
}

#[derive(Debug)]
pub(crate) enum Stage {
    Fresh,
    Awaiting { id: u64, read: Read },
    Waiting(Read),
    Closed,
}

/// Discovery progress within one attempt; dropped when the attempt restarts.
#[derive(Debug, Default)]
pub(crate) struct Discovery {
    pub totals: Totals,
    pub cursor: Option<Ordered>,
    pub block: Option<BlockRef>,
    pub pages: u32,
}

pub(crate) struct ReadState {
    pub network: NetworkId,
    pub account_index: u32,
    pub address: Felt,
    pub route: Route,
    pub limits: &'static Limits,
    pub tokens: &'static [TokenInfo],
    pub generation: u64,
    pub stage: Stage,
    pub next_id: u64,
    /// 1-based attempt of the current read.
    pub attempt: u32,
    /// Host time the current attempt began, for the discovery budget.
    pub attempt_started_ms: u64,
    pub registered: bool,
    pub discovery: Discovery,
}

/// One read. Closed on lock, backgrounding, or a scope change; a new read means a new plan.
#[derive(uniffi::Object)]
pub struct PrivacyReadPlan {
    core: Weak<WalletCore>,
    state: Mutex<ReadState>,
}

impl PrivacyReadPlan {
    pub(crate) fn new(core: &Arc<WalletCore>, state: ReadState) -> Arc<Self> {
        Arc::new(Self {
            core: Arc::downgrade(core),
            state: Mutex::new(state),
        })
    }

    fn lock_state(&self) -> MutexGuard<'_, ReadState> {
        self.state.lock().unwrap_or_else(|poisoned| {
            let mut guard = poisoned.into_inner();
            guard.stage = Stage::Closed;
            guard
        })
    }
}

#[uniffi::export]
impl PrivacyReadPlan {
    /// Feeds the last reply and returns the next step. A reply whose id is not the one outstanding,
    /// or a reply kind the current step does not expect, returns `OutOfOrder` and closes the plan.
    /// `Finished` and `Failed` close it too.
    pub fn advance(&self, reply: PrivacyReply) -> Result<PrivacyStep, PrivacyError> {
        let mut state = self.lock_state();
        if matches!(state.stage, Stage::Closed) {
            return Err(PrivacyError::PlanClosed);
        }
        let Some(core) = self.core.upgrade() else {
            state.stage = Stage::Closed;
            return Err(PrivacyError::PlanClosed);
        };
        let result = state.step(&core, reply);
        if !matches!(
            result,
            Ok(PrivacyStep::Post { .. } | PrivacyStep::Rpc { .. } | PrivacyStep::Wait { .. })
        ) {
            state.stage = Stage::Closed;
            state.discovery = Discovery::default();
        }
        result
    }

    /// Stops the plan and drops its cursor and totals. Idempotent.
    pub fn close(&self) {
        let mut state = self.lock_state();
        state.stage = Stage::Closed;
        state.discovery = Discovery::default();
    }
}

impl ReadState {
    fn step(
        &mut self,
        core: &WalletCore,
        reply: PrivacyReply,
    ) -> Result<PrivacyStep, PrivacyError> {
        let stage = std::mem::replace(&mut self.stage, Stage::Closed);
        match (stage, reply) {
            (Stage::Fresh, PrivacyReply::Start { now_ms }) => {
                Ok(self.begin(core, Read::Chain, now_ms))
            }
            (
                Stage::Awaiting { id, read },
                PrivacyReply::Http {
                    id: got,
                    status,
                    body,
                    now_ms,
                },
            ) if id == got && matches!(read, Read::Preflight | Read::Discovery) => {
                Ok(self.on_http(core, read, status, &body, now_ms))
            }
            (
                Stage::Awaiting { id, read },
                PrivacyReply::Rpc {
                    id: got,
                    body,
                    now_ms,
                },
            ) if id == got && matches!(read, Read::Chain | Read::PoolFee) => {
                Ok(self.on_rpc(core, read, id, &body, now_ms))
            }
            (Stage::Awaiting { id, read }, PrivacyReply::TransportFailure { id: got, now_ms })
                if id == got =>
            {
                Ok(self.on_transport_failure(read, now_ms))
            }
            (Stage::Waiting(read), PrivacyReply::WaitElapsed { now_ms }) => {
                self.attempt += 1;
                Ok(self.start_attempt(core, read, now_ms))
            }
            _ => Err(PrivacyError::OutOfOrder),
        }
    }

    /// Starts a read at its first attempt.
    pub(crate) fn begin(&mut self, core: &WalletCore, read: Read, now_ms: u64) -> PrivacyStep {
        self.attempt = 1;
        self.start_attempt(core, read, now_ms)
    }

    /// Starts (or restarts) the current attempt of a read: discovery restarts from page one.
    fn start_attempt(&mut self, core: &WalletCore, read: Read, now_ms: u64) -> PrivacyStep {
        self.attempt_started_ms = now_ms;
        match read {
            Read::Chain => self.rpc(Read::Chain, |_, id| crate::rpc::chain_id_request(id)),
            Read::Preflight => self.post_preflight(core),
            Read::Discovery => {
                self.discovery = Discovery::default();
                self.post_incoming(core)
            }
            Read::PoolFee => self.rpc(Read::PoolFee, |state, id| {
                super::bodies::pool_fee(id, &state.route.pool_address)
            }),
        }
    }

    pub(crate) fn next_id(&mut self) -> u64 {
        self.next_id += 1;
        self.next_id
    }

    pub(crate) fn rpc(
        &mut self,
        read: Read,
        body: impl FnOnce(&Self, u64) -> String,
    ) -> PrivacyStep {
        let id = self.next_id();
        let body = body(self, id);
        self.stage = Stage::Awaiting { id, read };
        PrivacyStep::Rpc {
            id,
            body,
            purpose: super::plan_steps::purpose(read),
        }
    }

    /// Pauses `attempt × 1 s` before the next attempt of `read`, or fails with `last` when the
    /// attempts are spent.
    pub(crate) fn retry_or(&mut self, read: Read, last: PrivacyFailure) -> PrivacyStep {
        if self.attempt >= self.limits.max_service_attempts {
            return self.fail(last);
        }
        self.stage = Stage::Waiting(read);
        PrivacyStep::Wait {
            delay_ms: self.attempt.saturating_mul(1_000),
        }
    }

    pub(crate) fn fail(&mut self, failure: PrivacyFailure) -> PrivacyStep {
        self.stage = Stage::Closed;
        PrivacyStep::Failed { failure }
    }
}
