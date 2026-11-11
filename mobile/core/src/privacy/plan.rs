//! `PrivacyReadPlan`: mobile's FFI object around `wallet_core::privacy::plan::PrivacyReadPlan`,
//! the core-owned state machine for one private-balance read, in the extension's `stateResponse`
//! order (docs/privacy.md §3): chain id, preflight, note discovery when registered, pool fee. The
//! host relays opaque bodies and replies; it cannot pick a URL, reorder a step, or see the viewing
//! key, which is re-derived for every `Post` and never stored here.
//!
//! The wrapper holds what ties a read to this wallet: the vault record it reads for, the session
//! generation it was prepared in, and the plan's `PrivacyHost` (`impl PrivacyHost for
//! PrivacyReadPlan` below), which derives the key through `WalletCore::plan_viewing_key`.

use std::sync::{Arc, Mutex, MutexGuard, Weak};

use wallet_core::privacy::plan::{PrivacyHost, PrivacyReadPlan as Plan};
use wallet_core::SecretFelt;

use super::types::{PrivacyError, PrivacyReply, PrivacyStep};
use crate::wallet::WalletCore;

/// One read. Closed on lock, backgrounding, or a scope change; a new read means a new plan.
#[derive(uniffi::Object)]
pub struct PrivacyReadPlan {
    core: Weak<WalletCore>,
    /// The vault record id; the viewing key is derived from this record only.
    account_id: String,
    /// The session generation (`lock_epoch`) the plan was prepared in.
    generation: u64,
    plan: Mutex<Plan>,
}

impl PrivacyReadPlan {
    pub(crate) fn new(
        core: &Arc<WalletCore>,
        account_id: String,
        generation: u64,
        plan: Plan,
    ) -> Arc<Self> {
        Arc::new(Self {
            core: Arc::downgrade(core),
            account_id,
            generation,
            plan: Mutex::new(plan),
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
}

#[uniffi::export]
impl PrivacyReadPlan {
    /// Feeds the last reply and returns the next step. A reply whose id is not the one outstanding,
    /// or a reply kind the current step does not expect, returns `OutOfOrder` and closes the plan.
    /// `Finished` and `Failed` close it too.
    pub fn advance(&self, reply: PrivacyReply) -> Result<PrivacyStep, PrivacyError> {
        let mut plan = self.lock_plan();
        if self.core.upgrade().is_none() {
            plan.close();
            return Err(PrivacyError::PlanClosed);
        }
        plan.advance(self, reply)
            .map(PrivacyStep::from)
            .map_err(PrivacyError::from)
    }

    /// Stops the plan and drops its cursor and totals. Idempotent.
    ///
    /// Exported as `cancel`: Kotlin's generated `AutoCloseable.close()` (which frees the handle)
    /// would otherwise clash with it.
    #[uniffi::method(name = "cancel")]
    pub fn close(&self) {
        self.lock_plan().close();
    }
}

/// The wallet behind the read. Every call re-reads the wallet through the weak reference; a
/// dropped wallet is a moved session, and the plan fails `Locked`.
impl PrivacyHost for PrivacyReadPlan {
    fn viewing_key(&self, chain_id: &str, pool_address: &str) -> Option<SecretFelt> {
        self.core
            .upgrade()?
            .plan_viewing_key(self.generation, &self.account_id, chain_id, pool_address)
            .ok()
    }
}
