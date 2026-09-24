//! `WalletCore`: the one object the native apps hold. It owns the recovery phrase and the vault's
//! data-encryption key for the length of an unlocked session and never hands key material across
//! the FFI boundary. The phrase leaves the core in exactly two places, both for the user to write
//! down: once at creation, and on an explicit reveal that re-checks the password.
//!
//! Concurrency: three mutexes, always taken in this order — `attempts` (one passphrase attempt at
//! a time, held across the KDF), `session`, then `file` (every read-modify-write of `vault.json`).
//! `lock()` only takes `session`, so it is never held up behind a KDF, and it bumps `lock_epoch`
//! so an unlock already in flight cannot reinstall a session after it.
//!
//! `lock_epoch` is also the session generation a transfer plan binds to (the extension's
//! `captureSessionAuthorization`): it advances on every lock and wallet deletion and whenever a
//! new session is installed, always under the `session` mutex, so a plan prepared in one session
//! can never sign in another, however the first one ended (lock, idle lock, re-unlock).

use std::fs;
use std::io::ErrorKind;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use zeroize::Zeroizing;

use crate::clock::{ClockReading, HostClock};
use crate::container::{self, Dek, Randomness, StoredVault, VaultFile, VaultPayload, MAX_ACCOUNTS};
use crate::files::{storage, write_atomic};
use crate::migrations::{open_stored, Opened};
use crate::networks::NetworkId;
pub use crate::records::{
    AccountInfo, RecoveryPhrase, SecurityStatus, StarkSignature, WalletStatus,
};
use crate::security;
use crate::vault::{self, Envelope, SealingKey};
use crate::{kms, CoreError};

pub(crate) const VAULT_FILE: &str = "vault.json";
/// The extension's rolling unlock window (`DEFAULT_TTL_MS`, `core/generated/policy.json`).
pub const IDLE_LOCK_MS: u64 = 1_800_000;

pub(crate) struct Session {
    pub payload: VaultPayload,
    pub dek: Dek,
    /// The passphrase slot the DEK came from; a payload write refuses a file with another one.
    pub password_slot: Envelope,
    /// A migrated container that could not be written yet; the next payload write commits it.
    pub pending: Option<VaultFile>,
    pub last_activity: ClockReading,
}

/// Key custody and vault lifecycle. Thread-safe; every method takes `&self`.
#[derive(uniffi::Object)]
pub struct WalletCore {
    pub(crate) data_dir: PathBuf,
    clock: Arc<dyn HostClock>,
    session: Mutex<Option<Session>>,
    attempts: Mutex<()>,
    file: Mutex<()>,
    pub(crate) lock_epoch: AtomicU64,
}

fn guard<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Drops the session when it has been idle for `IDLE_LOCK_MS`, when the boot changed, or when the
/// clock went backwards. Returns the time left on a live session.
pub(crate) fn expire(slot: &mut Option<Session>, now: &ClockReading) -> Option<u64> {
    let session = slot.as_ref()?;
    let last = &session.last_activity;
    match now.elapsed_since(&last.boot_id, last.monotonic_ms) {
        Some(elapsed) if elapsed < IDLE_LOCK_MS => Some(IDLE_LOCK_MS - elapsed),
        _ => {
            *slot = None;
            None
        }
    }
}

impl WalletCore {
    fn vault_path(&self) -> PathBuf {
        self.data_dir.join(VAULT_FILE)
    }

    pub(crate) fn now(&self) -> ClockReading {
        ClockReading::read(self.clock.as_ref())
    }

    /// A poisoned session lock means a panic mid-operation; clearing the session fails closed.
    pub(crate) fn lock_session(&self) -> MutexGuard<'_, Option<Session>> {
        self.session.lock().unwrap_or_else(|poisoned| {
            let mut guard = poisoned.into_inner();
            *guard = None;
            guard
        })
    }

    pub(crate) fn lock_file(&self) -> MutexGuard<'_, ()> {
        guard(&self.file)
    }

    pub(crate) fn read_vault(&self) -> Result<StoredVault, CoreError> {
        let text = match fs::read_to_string(self.vault_path()) {
            Ok(text) => text,
            Err(error) if error.kind() == ErrorKind::NotFound => return Err(CoreError::NoWallet),
            Err(_) => return Err(storage("read vault")),
        };
        container::parse(&text)
    }

    /// Call with the file lock held.
    pub(crate) fn write_vault(&self, file: &VaultFile) -> Result<(), CoreError> {
        let body = serde_json::to_vec(file).map_err(|_| storage("serialise vault"))?;
        write_atomic(&self.data_dir, VAULT_FILE, &body)
    }

    /// One throttled, counted passphrase attempt, with `then` run under the same attempt mutex.
    /// A missing or unreadable vault is reported before the counter moves (no guess was possible).
    pub(crate) fn passphrase_attempt<T>(
        &self,
        password: &str,
        then: impl FnOnce(Opened) -> Result<T, CoreError>,
    ) -> Result<T, CoreError> {
        let _attempt = guard(&self.attempts);
        let now = self.now();
        let state = security::check(&self.data_dir, &now)?;
        let stored = self.read_vault()?;
        security::begin_attempt(&self.data_dir, &state, &now)?;
        let opened = open_stored(stored, password)?;
        // A reset that cannot be written leaves the owner throttled longer, never less.
        let _ = security::reset(&self.data_dir, &self.now());
        then(opened)
    }

    /// Installs a session unless `lock()` ran since `epoch` was read (lock always wins).
    pub(crate) fn install(
        &self,
        epoch: u64,
        opened: Opened,
        pending: Option<VaultFile>,
    ) -> Result<(), CoreError> {
        let mut session = self.lock_session();
        if self.lock_epoch.load(Ordering::SeqCst) != epoch {
            return Err(CoreError::Locked);
        }
        *session = Some(Session {
            payload: opened.payload,
            dek: opened.dek,
            password_slot: opened.container.password_slot.clone(),
            pending,
            last_activity: self.now(),
        });
        // A new session is a new generation: a plan from an idle-expired session stays void.
        self.lock_epoch.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    /// Runs `f` on a live session. `renew` marks a user-initiated operation (the extension's
    /// `getPassphrase` paths); reads pass `false` and never extend the idle window.
    pub(crate) fn with_session<T>(
        &self,
        renew: bool,
        f: impl FnOnce(&mut Session) -> Result<T, CoreError>,
    ) -> Result<T, CoreError> {
        let mut slot = self.lock_session();
        let now = self.now();
        expire(&mut slot, &now);
        match slot.as_mut() {
            Some(session) => {
                let result = f(session)?;
                if renew {
                    session.last_activity = now;
                }
                Ok(result)
            }
            None if self.vault_path().exists() => Err(CoreError::Locked),
            None => Err(CoreError::NoWallet),
        }
    }

    /// Re-seals the session payload under its DEK (no KDF), keeping the file's slots.
    fn persist_payload(&self, session: &mut Session) -> Result<(), CoreError> {
        let _file = self.lock_file();
        let base = match self.read_vault()? {
            StoredVault::V2(file) if file.password_slot == session.password_slot => *file,
            StoredVault::V1(_) => session
                .pending
                .clone()
                .ok_or_else(|| storage("vault changed on disk"))?,
            StoredVault::V2(_) => return Err(storage("vault changed on disk")),
        };
        self.write_vault(&base.with_payload(&session.dek, &session.payload)?)?;
        session.pending = None;
        Ok(())
    }

    pub(crate) fn account(
        session: &Session,
        index: u32,
        network: NetworkId,
    ) -> Result<AccountInfo, CoreError> {
        let derived = kms::derive_account(
            &session.payload.mnemonic,
            session.payload.mnemonic_passphrase.as_deref(),
            index,
            network.chain(),
        )?;
        Ok(AccountInfo {
            index,
            address: derived.address,
            public_key: derived.public_key,
            class_hash: derived.class_hash,
            network,
        })
    }

    fn create_vault(
        &self,
        password: &str,
        mnemonic: Zeroizing<String>,
        passphrase: Option<String>,
    ) -> Result<(), CoreError> {
        let epoch = self.lock_epoch.load(Ordering::SeqCst);
        let payload = VaultPayload {
            account_count: 1,
            mnemonic: mnemonic.to_string(),
            mnemonic_passphrase: passphrase,
            version: container::CONTAINER_VERSION,
        };
        let key = SealingKey::create(password)?;
        let dek = container::new_dek()?;
        let file = container::seal_new(&key, &dek, &payload, &Randomness::draw()?)?;
        {
            let _file = self.lock_file();
            if self.vault_path().exists() {
                return Err(CoreError::WalletExists);
            }
            self.write_vault(&file)?;
        }
        // A new wallet starts with a clean counter; a leftover one belonged to a deleted vault.
        security::remove(&self.data_dir)?;
        let opened = Opened {
            payload,
            dek,
            container: file,
            migrated: false,
        };
        self.install(epoch, opened, None)
    }
}

#[uniffi::export]
impl WalletCore {
    /// Opens the core over an app-private directory. The host chooses a directory excluded from
    /// backups and protected at rest (iOS complete file protection; Android `noBackupFilesDir`),
    /// and supplies the monotonic clock every time rule is measured on.
    #[uniffi::constructor]
    pub fn new(data_dir: String, clock: Arc<dyn HostClock>) -> Result<Arc<Self>, CoreError> {
        let data_dir = PathBuf::from(data_dir);
        fs::create_dir_all(&data_dir).map_err(|_| storage("data directory is not writable"))?;
        Ok(Arc::new(Self {
            data_dir,
            clock,
            session: Mutex::new(None),
            attempts: Mutex::new(()),
            file: Mutex::new(()),
            lock_epoch: AtomicU64::new(0),
        }))
    }

    /// Current lifecycle state. Passive: applies the idle lock, never renews.
    pub fn status(&self) -> WalletStatus {
        let mut slot = self.lock_session();
        expire(&mut slot, &self.now());
        match (slot.is_some(), self.vault_path().exists()) {
            (true, _) => WalletStatus::Unlocked,
            (false, true) => WalletStatus::Locked,
            (false, false) => WalletStatus::NoWallet,
        }
    }

    /// Creates a wallet from fresh entropy and leaves it unlocked. The returned phrase is the
    /// only copy the UI ever receives unprompted; it must be shown once for backup and dropped.
    pub fn create_wallet(
        &self,
        password: String,
        word_count: u8,
    ) -> Result<RecoveryPhrase, CoreError> {
        let password = Zeroizing::new(password);
        vault::check_password(&password)?;
        let mnemonic = kms::generate_mnemonic(word_count)?;
        let words = mnemonic.split(' ').map(str::to_string).collect();
        self.create_vault(&password, mnemonic, None)?;
        Ok(RecoveryPhrase { words })
    }

    /// Imports an existing phrase (and optional BIP-39 passphrase) and leaves the wallet unlocked.
    pub fn import_wallet(
        &self,
        password: String,
        phrase: String,
        passphrase: Option<String>,
    ) -> Result<(), CoreError> {
        let password = Zeroizing::new(password);
        vault::check_password(&password)?;
        let mnemonic = kms::normalise_phrase(&Zeroizing::new(phrase));
        if !kms::validate_mnemonic(&mnemonic) {
            return Err(CoreError::InvalidInput {
                reason: "invalid recovery phrase".into(),
            });
        }
        self.create_vault(&password, mnemonic, passphrase.filter(|p| !p.is_empty()))
    }

    /// Decrypts the vault into memory: throttled and counted, and the first successful unlock of
    /// a v1 vault migrates it to v2 (a failed write keeps v1 and retries on the next write).
    pub fn unlock(&self, password: String) -> Result<(), CoreError> {
        let password = Zeroizing::new(password);
        let epoch = self.lock_epoch.load(Ordering::SeqCst);
        let (opened, pending) = self.passphrase_attempt(&password, |opened| {
            if !opened.migrated {
                return Ok((opened, None));
            }
            let _file = self.lock_file();
            let written = matches!(self.read_vault(), Ok(StoredVault::V1(_)))
                && self.write_vault(&opened.container).is_ok();
            let pending = (!written).then(|| opened.container.clone());
            Ok((opened, pending))
        })?;
        self.install(epoch, opened, pending)
    }

    /// Wipes the session; the phrase and the vault key are zeroized as they drop.
    pub fn lock(&self) {
        let mut session = self.lock_session();
        self.lock_epoch.fetch_add(1, Ordering::SeqCst);
        *session = None;
    }

    /// Every account on `network`. Passive: never renews the idle window.
    pub fn accounts(&self, network: NetworkId) -> Result<Vec<AccountInfo>, CoreError> {
        self.with_session(false, |session| {
            (0..session.payload.account_count)
                .map(|index| Self::account(session, index, network))
                .collect()
        })
    }

    /// Derives the next account and persists the new count (no KDF). Renews the idle window.
    pub fn add_account(&self, network: NetworkId) -> Result<AccountInfo, CoreError> {
        self.with_session(true, |session| {
            let index = session.payload.account_count;
            if index >= MAX_ACCOUNTS {
                return Err(CoreError::InvalidInput {
                    reason: "account limit reached".into(),
                });
            }
            let account = Self::account(session, index, network)?;
            session.payload.account_count += 1;
            if let Err(error) = self.persist_payload(session) {
                session.payload.account_count -= 1;
                return Err(error);
            }
            Ok(account)
        })
    }

    /// Signs a transaction or message hash for one account. The host computes the hash from the
    /// reviewed request; the key is derived, used, and wiped inside this call. Renews.
    pub fn sign_hash(
        &self,
        account_index: u32,
        message_hash: String,
    ) -> Result<StarkSignature, CoreError> {
        self.with_session(true, |session| {
            if account_index >= session.payload.account_count {
                return Err(CoreError::InvalidInput {
                    reason: "unknown account".into(),
                });
            }
            let signature = kms::sign_hash(
                &session.payload.mnemonic,
                session.payload.mnemonic_passphrase.as_deref(),
                account_index,
                &message_hash,
            )?;
            Ok(StarkSignature {
                public_key: signature.public_key,
                r: signature.r,
                s: signature.s,
            })
        })
    }

    /// Re-checks the password against the vault on disk (throttled and counted; biometrics never
    /// reveal), then returns the phrase for display. Renews a live session.
    pub fn reveal_recovery_phrase(&self, password: String) -> Result<RecoveryPhrase, CoreError> {
        let password = Zeroizing::new(password);
        let words = self.passphrase_attempt(&password, |opened| {
            Ok(opened
                .payload
                .mnemonic
                .split(' ')
                .map(str::to_string)
                .collect())
        })?;
        let mut slot = self.lock_session();
        let now = self.now();
        if expire(&mut slot, &now).is_some() {
            if let Some(session) = slot.as_mut() {
                session.last_activity = now;
            }
        }
        Ok(RecoveryPhrase { words })
    }

    /// Deletes the vault and its backoff state after re-checking the password (throttled and
    /// counted). Irreversible without the phrase.
    pub fn delete_wallet(&self, password: String) -> Result<(), CoreError> {
        let password = Zeroizing::new(password);
        self.passphrase_attempt(&password, |opened| {
            drop(opened);
            let mut session = self.lock_session();
            self.lock_epoch.fetch_add(1, Ordering::SeqCst);
            *session = None;
            let _file = self.lock_file();
            fs::remove_file(self.vault_path()).map_err(|_| storage("remove vault"))?;
            crate::activity::store::remove(&self.data_dir);
            security::remove(&self.data_dir)
        })
    }

    /// Lock and backoff state for the UI. Passive: never renews and never writes.
    pub fn security_status(&self) -> SecurityStatus {
        let now = self.now();
        let session_remaining_ms = expire(&mut self.lock_session(), &now);
        let (failed_attempts, retry_after_ms) = security::status(&self.data_dir, &now);
        let biometric_enabled = matches!(
            self.read_vault(),
            Ok(StoredVault::V2(file)) if file.biometric_slot.is_some()
        );
        SecurityStatus {
            biometric_enabled,
            retry_after_ms,
            failed_attempts,
            idle_lock_ms: IDLE_LOCK_MS,
            session_remaining_ms,
        }
    }

    /// Time left before the idle lock, for the host's UI timer; `None` while locked. Passive.
    pub fn session_remaining_ms(&self) -> Option<u64> {
        expire(&mut self.lock_session(), &self.now())
    }
}
