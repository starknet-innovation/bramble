//! The account surface of `WalletCore` (`docs/accounts.md` §3.3): records, selection, the network
//! switch, adding accounts, labels, groups, discovery, restore, and signing by record. Every
//! mutation re-seals the vault with the session key and rolls back in memory if the write fails,
//! so a failed write never leaves the session ahead of the disk.

use crate::account_catalog::{authorization_shape, type_label, AccountFamily};
use crate::account_names::{display_name, normalise_label, short_label};
use crate::account_store::{StoredAccount, VaultPayload, MAX_ACCOUNT_INDEX, MAX_ACCOUNT_RECORDS};
use crate::groups::{self, AccountGroup};
use crate::networks::NetworkId;
use crate::recovery::{derive_selections, RecoverySelection};
use crate::recovery_scan::{self, RecoveryScanStep, RpcResponse};
use crate::vault;
use crate::wallet::{RecoveryPhrase, Session, StarkSignature, WalletCore};
use crate::{kms, CoreError};

/// One account as the UI renders it. Public data only; safe to render and log.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct AccountRecord {
    /// `"<SN_MAIN|SN_SEPOLIA>:<canonical address>"`.
    pub id: String,
    pub network: NetworkId,
    pub family: AccountFamily,
    pub class_hash: String,
    pub account_index: u32,
    pub address: String,
    pub public_key: String,
    /// Set for Argent and Braavos, absent for OpenZeppelin.
    pub deployment_salt: Option<String>,
    pub label: Option<String>,
    /// The label, else the friendly nickname.
    pub display_name: String,
    /// `accountLabel(address)`, 6…4.
    pub short_address: String,
    /// `knownAccountType`, e.g. "Ready Account (Argent 0.3.1)".
    pub type_label: Option<String>,
    /// "stark-pair" or "argent-signer-array".
    pub authorization_shape: String,
    pub group_id: Option<String>,
    /// Braavos: restored to be seen, never signed for (§2.7).
    pub view_only: bool,
    pub active: bool,
}

fn invalid(reason: &str) -> CoreError {
    CoreError::InvalidInput {
        reason: reason.into(),
    }
}

fn unknown_account() -> CoreError {
    invalid("unknown account")
}

fn render(payload: &VaultPayload, record: &StoredAccount) -> AccountRecord {
    let label = payload.labels.get(&record.id).cloned();
    let class_hash = record.class_felt();
    AccountRecord {
        id: record.id.clone(),
        network: record.network(),
        family: record.family(),
        class_hash: record.class_hash.clone(),
        account_index: record.account_index,
        address: record.address.clone(),
        public_key: record.public_key.clone(),
        deployment_salt: record.deployment_salt.clone(),
        display_name: display_name(&record.address, label.as_deref()),
        label,
        short_address: short_label(&record.address),
        type_label: type_label(record.family(), &class_hash),
        authorization_shape: authorization_shape(record.family(), &class_hash),
        group_id: groups::group_of(&payload.groups, &record.id).map(|group| group.id.clone()),
        view_only: record.view_only(),
        active: payload.active_account_id.as_deref() == Some(record.id.as_str()),
    }
}

fn require_record<'a>(
    payload: &'a VaultPayload,
    account_id: &str,
) -> Result<&'a StoredAccount, CoreError> {
    payload.record(account_id).ok_or_else(unknown_account)
}

// Lowest unused account index on `network` (`nextAccountIndex`): every family occupies its index.
fn next_account_index(payload: &VaultPayload, network: NetworkId) -> Result<u32, CoreError> {
    (0..=MAX_ACCOUNT_INDEX)
        .find(|index| {
            !payload
                .accounts
                .iter()
                .any(|record| record.network() == network && record.account_index == *index)
        })
        .ok_or_else(|| invalid("account limit reached"))
}

fn push_active(payload: &mut VaultPayload, record: StoredAccount) -> Result<(), CoreError> {
    if payload.record(&record.id).is_some() {
        return Err(invalid("account already exists"));
    }
    if payload.accounts.len() >= MAX_ACCOUNT_RECORDS {
        return Err(invalid("account limit reached"));
    }
    payload.active_account_id = Some(record.id.clone());
    payload.accounts.push(record);
    Ok(())
}

impl WalletCore {
    /// Applies `change` to the payload and re-seals it; on any failure the session is restored.
    fn commit<T>(
        &self,
        session: &mut Session,
        change: impl FnOnce(&mut VaultPayload) -> Result<T, CoreError>,
    ) -> Result<T, CoreError> {
        let before = session.payload.snapshot();
        let outcome = change(&mut session.payload)
            .and_then(|value| self.write_session(session).map(|()| value));
        if outcome.is_err() {
            session.payload.restore(before);
        }
        outcome
    }
}

#[uniffi::export]
impl WalletCore {
    /// Creates a wallet with its first account (OZ index 0) on `network` and leaves it unlocked.
    /// The returned phrase is shown once for backup and dropped.
    pub fn create_wallet_on_network(
        &self,
        password: String,
        word_count: u8,
        network: NetworkId,
    ) -> Result<RecoveryPhrase, CoreError> {
        vault::check_password(&password)?;
        let mnemonic = kms::generate_mnemonic(word_count)?;
        let words = mnemonic.split(' ').map(str::to_string).collect();
        self.install(&password, mnemonic, None, Some(network))?;
        Ok(RecoveryPhrase { words })
    }

    /// Whether an imported wallet still waits for discovery. The host routes to "Find your
    /// accounts" while this is true; there is no way into the wallet with zero accounts.
    pub fn recovery_pending(&self) -> Result<bool, CoreError> {
        self.with_session(|session| Ok(session.payload.recovery_pending))
    }

    /// The accounts on `network`, in the order they were added.
    pub fn account_records(&self, network: NetworkId) -> Result<Vec<AccountRecord>, CoreError> {
        self.with_session(|session| {
            let payload = &session.payload;
            Ok(payload
                .accounts
                .iter()
                .filter(|record| record.network() == network)
                .map(|record| render(payload, record))
                .collect())
        })
    }

    /// Every account on every network (the groups editor spans networks).
    pub fn all_account_records(&self) -> Result<Vec<AccountRecord>, CoreError> {
        self.with_session(|session| {
            let payload = &session.payload;
            Ok(payload
                .accounts
                .iter()
                .map(|record| render(payload, record))
                .collect())
        })
    }

    /// The active account, if any.
    pub fn active_account(&self) -> Result<Option<AccountRecord>, CoreError> {
        self.with_session(|session| {
            let payload = &session.payload;
            Ok(payload
                .active_account_id
                .as_deref()
                .and_then(|id| payload.record(id))
                .map(|record| render(payload, record)))
        })
    }

    /// Makes one stored account active.
    pub fn select_account(&self, account_id: String) -> Result<(), CoreError> {
        self.with_session(|session| {
            require_record(&session.payload, &account_id)?;
            self.commit(session, |payload| {
                payload.active_account_id = Some(account_id);
                Ok(())
            })
        })
    }

    /// The network switch (`accountForNetwork` + `ensureNetworkAccount`): keeps the active account
    /// if it is on `network`; else selects the first account there; else projects the active
    /// account (same family, index, class for non-OZ, salt) onto `network`, derived here, and
    /// stores it. None only for a vault with no accounts yet.
    pub fn ensure_network_account(
        &self,
        network: NetworkId,
    ) -> Result<Option<AccountRecord>, CoreError> {
        self.with_session(|session| {
            let payload = &session.payload;
            let active = payload
                .active_account_id
                .as_deref()
                .and_then(|id| payload.record(id));
            let Some(source) = active.or_else(|| payload.accounts.first()).cloned() else {
                return Ok(None);
            };
            if source.network() == network && active.is_some() {
                return Ok(Some(render(payload, &source)));
            }
            let target = match payload.accounts.iter().find(|r| r.network() == network) {
                Some(existing) => {
                    let id = existing.id.clone();
                    self.commit(session, |payload| {
                        payload.active_account_id = Some(id.clone());
                        Ok(id)
                    })?
                }
                None => {
                    let family = source.family();
                    let class_hash =
                        (family != AccountFamily::OpenZeppelin).then(|| source.class_felt());
                    let projected = payload.derive(
                        family,
                        source.account_index,
                        class_hash.as_ref(),
                        source.salt_felt().as_ref(),
                        network,
                    )?;
                    let id = projected.id.clone();
                    self.commit(session, |payload| push_active(payload, projected))?;
                    id
                }
            };
            let payload = &session.payload;
            Ok(payload
                .record(&target)
                .map(|record| render(payload, record)))
        })
    }

    /// "Regular account": OpenZeppelin at the lowest unused index on `network`, made active.
    pub fn add_regular_account(&self, network: NetworkId) -> Result<AccountRecord, CoreError> {
        self.with_session(|session| {
            if session.payload.recovery_pending {
                return Err(invalid("finish finding your accounts first"));
            }
            let index = next_account_index(&session.payload, network)?;
            let record =
                session
                    .payload
                    .derive(AccountFamily::OpenZeppelin, index, None, None, network)?;
            let id = record.id.clone();
            self.commit(session, |payload| push_active(payload, record))?;
            let payload = &session.payload;
            Ok(render(payload, require_record(payload, &id)?))
        })
    }

    /// Signs a hash for one stored account. Refuses view-only (Braavos) records and any vault
    /// still waiting for discovery; the key is derived from the record's index, used, and wiped
    /// inside this call. See `docs/accounts.md` §2.7 for what this can and cannot guarantee.
    pub fn sign_hash_for_account(
        &self,
        account_id: String,
        message_hash: String,
    ) -> Result<StarkSignature, CoreError> {
        self.with_session(|session| {
            let payload = &session.payload;
            if payload.recovery_pending {
                return Err(unknown_account());
            }
            let record = require_record(payload, &account_id)?;
            if record.view_only() {
                return Err(invalid("this account is view only"));
            }
            let signature = kms::sign_hash(
                &payload.mnemonic,
                payload.mnemonic_passphrase.as_deref(),
                record.account_index,
                &message_hash,
            )?;
            if signature.public_key != record.public_key {
                return Err(CoreError::Kms {
                    operation: "sign".into(),
                });
            }
            Ok(StarkSignature {
                public_key: signature.public_key,
                r: signature.r,
                s: signature.s,
            })
        })
    }

    /// Sets (trimmed, 1-64) or clears (empty) an account's label; returns what is stored.
    pub fn set_account_label(
        &self,
        account_id: String,
        label: String,
    ) -> Result<Option<String>, CoreError> {
        let label = normalise_label(&label)?;
        self.with_session(|session| {
            require_record(&session.payload, &account_id)?;
            self.commit(session, |payload| {
                match &label {
                    Some(label) => payload.labels.insert(account_id, label.clone()),
                    None => payload.labels.remove(&account_id),
                };
                Ok(label)
            })
        })
    }

    /// Every group, in creation order.
    pub fn account_groups(&self) -> Result<Vec<AccountGroup>, CoreError> {
        self.with_session(|session| Ok(session.payload.groups.iter().map(Into::into).collect()))
    }

    /// Creates a group (name 1-64 trimmed, icon from `group_icons()`).
    pub fn create_account_group(
        &self,
        name: String,
        icon: String,
    ) -> Result<AccountGroup, CoreError> {
        self.with_session(|session| {
            self.commit(session, |payload| {
                let at = groups::create(&mut payload.groups, &name, &icon)?;
                Ok(AccountGroup::from(&payload.groups[at]))
            })
        })
    }

    /// Renames and re-icons a group.
    pub fn update_account_group(
        &self,
        group_id: String,
        name: String,
        icon: String,
    ) -> Result<AccountGroup, CoreError> {
        self.with_session(|session| {
            self.commit(session, |payload| {
                let at = groups::update(&mut payload.groups, &group_id, &name, &icon)?;
                Ok(AccountGroup::from(&payload.groups[at]))
            })
        })
    }

    /// Deletes a group; its accounts become ungrouped.
    pub fn delete_account_group(&self, group_id: String) -> Result<(), CoreError> {
        self.with_session(|session| {
            self.commit(session, |payload| {
                groups::remove(&mut payload.groups, &group_id)
            })
        })
    }

    /// Files an account into exactly one group, or none (`None`).
    pub fn set_account_group(
        &self,
        account_id: String,
        group_id: Option<String>,
    ) -> Result<(), CoreError> {
        self.with_session(|session| {
            require_record(&session.payload, &account_id)?;
            self.commit(session, |payload| {
                groups::set_membership(&mut payload.groups, &account_id, group_id.as_deref())
            })
        })
    }

    /// Starts the next discovery batch (the next four indices), or checks one manual index.
    /// Returns the JSON-RPC bodies to POST; see `recovery_scan.rs`.
    pub fn recovery_scan_next(
        &self,
        network: NetworkId,
        manual_index: Option<u32>,
    ) -> Result<RecoveryScanStep, CoreError> {
        self.with_session(|session| {
            if !session.payload.recovery_pending {
                return Err(invalid("no account recovery is pending"));
            }
            recovery_scan::next(&mut session.scan, &session.payload, network, manual_index)
        })
    }

    /// Judges the responses to the last requests. A failure pauses the scan; calling
    /// `recovery_scan_next` again retries the same batch.
    pub fn recovery_scan_submit(
        &self,
        responses: Vec<RpcResponse>,
    ) -> Result<RecoveryScanStep, CoreError> {
        self.with_session(|session| recovery_scan::submit(&mut session.scan, &responses))
    }

    /// Forgets the scan (new phrase, new network, or the user left the screen).
    pub fn recovery_scan_reset(&self) {
        // Locked or missing: there is no scan to forget.
        let _ = self.with_session(|session| {
            session.scan = None;
            Ok(())
        });
    }

    /// Restores the chosen coordinates in one atomic vault write: each is re-derived here, the
    /// first becomes active, and `recovery_pending` clears. The host never supplies an address.
    pub fn restore_recovered_accounts(
        &self,
        network: NetworkId,
        selections: Vec<RecoverySelection>,
    ) -> Result<Vec<AccountRecord>, CoreError> {
        self.with_session(|session| {
            if !session.payload.recovery_pending {
                return Err(invalid("no account recovery is pending"));
            }
            let records = derive_selections(&session.payload, network, &selections)?;
            self.commit(session, |payload| {
                payload.active_account_id = records.first().map(|record| record.id.clone());
                payload.accounts = records;
                payload.recovery_pending = false;
                Ok(())
            })?;
            session.scan = None;
            let payload = &session.payload;
            Ok(payload
                .accounts
                .iter()
                .map(|record| render(payload, record))
                .collect())
        })
    }
}
