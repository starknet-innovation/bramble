//! Coordination metadata (`coordination.json`) and the co-signer trust judgement, mirroring
//! `packages/features/multisig/src/coordination.ts` and `multisig-coordination-ops.ts`.
//!
//! Checkpoints keep the extension's semantics exactly: every sync that reaches the open step
//! advances `syncedAt` and marks every authenticated event id seen. The `held` list is mobile-only:
//! intent import is deferred, so trusted packages are counted and their ids remembered (bounded,
//! within the lookback window) instead of imported. It never freezes the checkpoint.

use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::argent_multisig;
use crate::contacts;
use crate::multisig_store::{self, Authority, Record};
use crate::nostr::{self, ApplicationData};
use crate::nostr_relay::is_relay_url;
use crate::{multisig_constants, public_store, CoreError};

/// Held packages remembered across all shared accounts.
const MAX_HELD: usize = 50;
const INTENT_PACKAGE_KIND: &str = "bramble.argent-multisig-intent";

/// `NostrSyncCheckpoint`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Checkpoint {
    pub account_id: String,
    pub event_ids: Vec<String>,
    pub relay_urls: Vec<String>,
    pub synced_at: u64,
}

/// One trusted package received while import is deferred. Ids only, never content.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Held {
    pub account_id: String,
    pub created_at: u64,
    pub event_id: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct File {
    pub version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relay_url: Option<String>,
    pub checkpoints: Vec<Checkpoint>,
    pub held: Vec<Held>,
}

fn is_relay_selection(urls: &[String]) -> bool {
    !urls.is_empty()
        && urls.len() <= 2
        && urls
            .iter()
            .enumerate()
            .all(|(i, url)| !urls[..i].contains(url))
        && urls.iter().all(|url| is_relay_url(url))
}

fn is_account_id(value: &str) -> bool {
    value
        .split_once(':')
        .and_then(|(network, address)| {
            multisig_store::record_id(contacts::network_from_catalog_id(network)?, address).ok()
        })
        .is_some_and(|id| id == value)
}

/// `isCheckpoint`.
pub fn is_checkpoint(checkpoint: &Checkpoint) -> bool {
    let c = &multisig_constants::get().coordination;
    let ids = &checkpoint.event_ids;
    is_account_id(&checkpoint.account_id)
        && ids.len() <= c.max_seen_event_ids
        && ids
            .iter()
            .enumerate()
            .all(|(i, id)| nostr::is_public_key(id) && !ids[..i].contains(id))
        && is_relay_selection(&checkpoint.relay_urls)
        && checkpoint.synced_at <= c.max_sync_seconds
}

fn is_held(held: &Held) -> bool {
    is_account_id(&held.account_id) && nostr::is_public_key(&held.event_id)
}

/// Reads and validates the file; missing means empty, invalid fails closed.
pub fn load(dir: &Path) -> Result<File, CoreError> {
    let Some(file) = public_store::read::<File>(dir, public_store::COORDINATION)? else {
        return Ok(File {
            version: 1,
            ..File::default()
        });
    };
    let valid = file.version == 1
        && file.relay_url.as_deref().is_none_or(is_relay_url)
        && file.checkpoints.len() <= multisig_constants::get().coordination.max_checkpoints
        && file.checkpoints.iter().all(is_checkpoint)
        && file.held.len() <= MAX_HELD
        && file.held.iter().all(is_held);
    if !valid {
        return Err(CoreError::Storage {
            reason: format!("{} unreadable", public_store::COORDINATION),
        });
    }
    Ok(file)
}

/// Writes the file.
pub fn store(dir: &Path, file: &File) -> Result<(), CoreError> {
    public_store::write(dir, public_store::COORDINATION, file)
}

/// `coordinationRelayUrls`: one custom relay replaces the reviewed defaults.
pub fn relay_urls(file: &File) -> Vec<String> {
    match &file.relay_url {
        Some(url) => vec![url.clone()],
        None => multisig_constants::get().relays.defaults.clone(),
    }
}

/// `getCheckpoint`: the account's checkpoint for exactly this relay selection.
pub fn checkpoint<'a>(
    file: &'a File,
    account_id: &str,
    relays: &[String],
) -> Option<&'a Checkpoint> {
    file.checkpoints
        .iter()
        .find(|checkpoint| checkpoint.account_id == account_id && checkpoint.relay_urls == relays)
}

/// `nostrSyncSince`: 30 days back on a first sync, else three days behind the last checkpoint.
pub fn sync_since(now: u64, synced_at: Option<u64>) -> u64 {
    let c = &multisig_constants::get().coordination;
    match synced_at {
        Some(synced_at) if synced_at <= now => {
            synced_at.saturating_sub(c.incremental_lookback_seconds)
        }
        _ => now.saturating_sub(c.sync_lookback_seconds),
    }
}

/// `recordSync`: merge seen ids when the relay set is unchanged, newest checkpoint first.
/// Returns `false` (and changes nothing) for an invalid checkpoint, as the extension does.
pub fn record_sync(file: &mut File, checkpoint: Checkpoint) -> bool {
    if !is_checkpoint(&checkpoint) {
        return false;
    }
    let c = &multisig_constants::get().coordination;
    let mut event_ids = checkpoint.event_ids.clone();
    if let Some(existing) = file
        .checkpoints
        .iter()
        .find(|stored| stored.account_id == checkpoint.account_id)
    {
        if existing.relay_urls == checkpoint.relay_urls {
            event_ids.extend(existing.event_ids.iter().cloned());
        }
    }
    let mut unique: Vec<String> = Vec::new();
    for id in event_ids {
        if !unique.contains(&id) {
            unique.push(id);
        }
    }
    unique.truncate(c.max_seen_event_ids);
    let next = Checkpoint {
        event_ids: unique,
        ..checkpoint
    };
    file.checkpoints
        .retain(|stored| stored.account_id != next.account_id);
    file.checkpoints.insert(0, next);
    file.checkpoints.truncate(c.max_checkpoints);
    true
}

/// Adds held packages, dropping duplicates and anything older than the 30-day lookback, keeping at
/// most 50, newest first.
pub fn record_held(file: &mut File, held: Vec<Held>, now: u64) {
    let oldest = now.saturating_sub(multisig_constants::get().coordination.sync_lookback_seconds);
    let mut all = held;
    all.append(&mut file.held);
    let mut kept: Vec<Held> = Vec::new();
    for entry in all {
        if entry.created_at >= oldest && !kept.iter().any(|k| k.event_id == entry.event_id) {
            kept.push(entry);
        }
    }
    kept.sort_by(|a, b| {
        b.created_at
            .cmp(&a.created_at)
            .then_with(|| a.event_id.cmp(&b.event_id))
    });
    kept.truncate(MAX_HELD);
    file.held = kept;
}

/// Whether a stored value is a canonical non-zero felt, as `canonicalNonZeroFelt`.
fn canonical_non_zero(value: &Value) -> Option<String> {
    let text = value.as_str()?;
    crate::felt::parse_non_zero(text).filter(|f| crate::felt::canonical(f) == text)?;
    Some(text.to_string())
}

/// `isConfigSnapshot`: pinned class, 1..=32 ascending canonical GUIDs, threshold in `1..=n`.
fn config_snapshot(value: &Value) -> Option<Authority> {
    let object = value.as_object()?;
    if !object
        .keys()
        .all(|key| ["classHash", "signerGuids", "threshold"].contains(&key.as_str()))
    {
        return None;
    }
    if object.get("classHash")?.as_str()? != argent_multisig::class_hash() {
        return None;
    }
    let signer_guids = object
        .get("signerGuids")?
        .as_array()?
        .iter()
        .map(canonical_non_zero)
        .collect::<Option<Vec<String>>>()?;
    let threshold =
        u32::try_from(nostr::safe_non_negative_integer(object.get("threshold")?)?).ok()?;
    multisig_store::is_authority(&signer_guids, threshold).then_some(Authority {
        threshold,
        signer_guids,
    })
}

const INTENT_KEYS: [&str; 8] = [
    "accountId",
    "broadcastTransactionHash",
    "configSnapshot",
    "id",
    "prepared",
    "signatures",
    "state",
    "summary",
];

/// The package's account id and snapshot, checked structurally (full intent validation needs the
/// invoke-v3 re-hash and Stark signature verification, deferred with import).
fn package_authority(content: &str) -> Option<(String, Authority)> {
    let package: Value = serde_json::from_str(content).ok()?;
    let object = package.as_object()?;
    if !object
        .keys()
        .all(|key| ["intent", "kind", "version"].contains(&key.as_str()))
        || object.get("kind")?.as_str()? != INTENT_PACKAGE_KIND
        || nostr::safe_non_negative_integer(object.get("version")?)? != 1
    {
        return None;
    }
    let intent = object.get("intent")?.as_object()?;
    if !intent.keys().all(|key| INTENT_KEYS.contains(&key.as_str())) {
        return None;
    }
    let account_id = intent.get("accountId")?.as_str()?.to_string();
    Some((account_id, config_snapshot(intent.get("configSnapshot")?)?))
}

/// Whether an authenticated package is a trusted co-signer update for `record`.
///
/// As `trustedSharedIntent`: the identifier is `bramble.multisig`, the package names this record,
/// and the sender is a saved same-network contact whose Stark key GUID is in the snapshot. Because
/// mobile holds packages instead of importing them, it also runs the comparison import would run:
/// the snapshot must equal the record's stored authority. Without that, any saved contact could
/// forge a snapshot listing itself.
pub fn is_trusted(
    opened: &ApplicationData,
    contacts: &[contacts::Entry],
    record: &Record,
    authority: Option<&Authority>,
) -> bool {
    if opened.identifier != multisig_constants::get().coordination.identifier
        || !nostr::is_public_key(&opened.sender_public_key)
    {
        return false;
    }
    let Some((account_id, snapshot)) = package_authority(&opened.content) else {
        return false;
    };
    let Some(authority) = authority else {
        return false;
    };
    account_id == record.id
        && snapshot == *authority
        && contacts.iter().any(|contact| {
            contact.network_id == record.network_id
                && contact.nostr_public_key.as_deref() == Some(opened.sender_public_key.as_str())
                && contact
                    .public_key_x
                    .as_deref()
                    .and_then(|key| argent_multisig::signer_guid_hex(key).ok())
                    .is_some_and(|guid| snapshot.signer_guids.contains(&guid))
        })
}
