//! UniFFI surface for Nostr coordination (`docs/nostr-multisig.md` §3.4): relay selection, and one
//! "Check for updates" as a sans-IO plan the host drives with its WebSockets. Gift-wrap plaintext
//! and raw events stay in the core; only counts come back.

use std::collections::HashSet;
use std::sync::Arc;

use crate::coordination::{self, Checkpoint, Held};
use crate::nostr_relay::{self, RelayStep, SyncJudge};
use crate::{contacts, multisig_constants, multisig_store, nostr, CoreError, WalletCore};

/// Relay selection and the timeouts the host enforces (`RELAY_TIMEOUT_MS` for connect and sync).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct RelayPolicy {
    pub relay_urls: Vec<String>,
    pub connect_timeout_ms: u32,
    pub request_timeout_ms: u32,
    pub is_custom: bool,
}

/// What one "Check for updates" found. `imported` stays 0 until intent import lands.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct CoordinationSyncOutcome {
    pub received: u32,
    pub trusted: u32,
    pub held: u32,
    pub imported: u32,
}

/// One coordination sync: the host opens a socket per relay, sends `open_frame`, forwards every
/// frame to `accept_frame`, and reports timeouts, errors and closes through `relay_ended`.
#[derive(uniffi::Object)]
pub struct NostrSyncPlan {
    judge: SyncJudge,
    record_id: String,
    now: u64,
    seen: HashSet<String>,
}

#[uniffi::export]
impl NostrSyncPlan {
    /// The relays to open, in order.
    pub fn relay_urls(&self) -> Vec<String> {
        self.judge.relay_urls()
    }

    /// The subscription frame to send once relay `relay` is connected.
    pub fn open_frame(&self, relay: u32) -> String {
        let _ = relay;
        self.judge.open_frame()
    }

    /// Judges one text frame from relay `relay`.
    pub fn accept_frame(&self, relay: u32, frame: String) -> RelayStep {
        self.judge.accept_frame(relay as usize, &frame)
    }

    /// Relay `relay` timed out, errored, or closed.
    pub fn relay_ended(&self, relay: u32) {
        self.judge.relay_ended(relay as usize);
    }
}

fn not_found() -> CoreError {
    CoreError::InvalidInput {
        reason: "shared account not found".into(),
    }
}

#[uniffi::export]
impl WalletCore {
    /// The relays coordination uses and the timeouts the host enforces.
    pub fn relay_policy(&self) -> Result<RelayPolicy, CoreError> {
        self.require_unlocked()?;
        let file = coordination::load(self.data_dir())?;
        let timeout = multisig_constants::get().relays.timeout_ms;
        Ok(RelayPolicy {
            relay_urls: coordination::relay_urls(&file),
            connect_timeout_ms: timeout,
            request_timeout_ms: timeout,
            is_custom: file.relay_url.is_some(),
        })
    }

    /// Saves a custom relay (it replaces the defaults) or, when empty, restores the defaults.
    pub fn set_nostr_relay_url(&self, raw: String) -> Result<Option<String>, CoreError> {
        self.require_unlocked()?;
        let url = nostr_relay::normalize_relay_url(&raw)?;
        let mut file = coordination::load(self.data_dir())?;
        file.relay_url = url.clone();
        coordination::store(self.data_dir(), &file)?;
        Ok(url)
    }

    /// Starts a coordination sync for one shared account at the host clock `now` (Unix seconds).
    pub fn coordination_sync_begin(
        &self,
        multisig_id: String,
        now: u64,
    ) -> Result<Arc<NostrSyncPlan>, CoreError> {
        let own = self.nostr_public_key()?;
        let file = multisig_store::load(self.data_dir())?;
        let record = file
            .records
            .iter()
            .find(|record| record.id == multisig_id)
            .ok_or_else(not_found)?;
        let coordination_file = coordination::load(self.data_dir())?;
        let relays = coordination::relay_urls(&coordination_file);
        let checkpoint = coordination::checkpoint(&coordination_file, &record.id, &relays);
        let since = coordination::sync_since(now, checkpoint.map(|c| c.synced_at));
        let seen = checkpoint
            .map(|c| c.event_ids.iter().cloned().collect())
            .unwrap_or_default();
        Ok(Arc::new(NostrSyncPlan {
            judge: SyncJudge::new(&own, since, relays)?,
            record_id: record.id.clone(),
            now,
            seen,
        }))
    }

    /// Opens the unseen candidates, judges trust, and records the checkpoint. A lock between items
    /// stops the batch with `Locked`; every authenticated id is marked seen and `syncedAt` advances.
    pub fn coordination_sync_finish(
        &self,
        plan: Arc<NostrSyncPlan>,
    ) -> Result<CoordinationSyncOutcome, CoreError> {
        let candidates = plan.judge.candidates()?;
        let file = multisig_store::load(self.data_dir())?;
        let record = file
            .records
            .iter()
            .find(|record| record.id == plan.record_id)
            .ok_or_else(not_found)?;
        let authority = multisig_store::authority(&file, record);
        let saved = contacts::load(self.data_dir())?;
        let mut verified: Vec<String> = Vec::new();
        let mut held: Vec<Held> = Vec::new();
        for event in candidates
            .iter()
            .filter(|event| !plan.seen.contains(&event.id))
        {
            let Some(opened) = self.with_phrase(|mnemonic, _| Ok(nostr::open(mnemonic, event)))?
            else {
                continue;
            };
            if !verified.contains(&event.id) {
                verified.push(event.id.clone());
            }
            if coordination::is_trusted(&opened, &saved, record, authority.as_ref())
                && !held.iter().any(|entry| entry.event_id == event.id)
            {
                held.push(Held {
                    account_id: record.id.clone(),
                    created_at: event.created_at,
                    event_id: event.id.clone(),
                });
            }
        }
        self.require_unlocked()?;
        let outcome = CoordinationSyncOutcome {
            received: verified.len() as u32,
            trusted: held.len() as u32,
            held: held.len() as u32,
            imported: 0,
        };
        // As the extension, a checkpoint write failure does not fail the sync.
        if let Ok(mut coordination_file) = coordination::load(self.data_dir()) {
            coordination::record_sync(
                &mut coordination_file,
                Checkpoint {
                    account_id: record.id.clone(),
                    event_ids: verified,
                    relay_urls: plan.judge.relay_urls(),
                    synced_at: plan.now,
                },
            );
            coordination::record_held(&mut coordination_file, held, plan.now);
            let _ = coordination::store(self.data_dir(), &coordination_file);
        }
        Ok(outcome)
    }
}
