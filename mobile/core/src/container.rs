//! The vault container (vault versions 2 to 5), from `wallet_core::container`: a random
//! data-encryption key (DEK) seals the payload, and the DEK is itself sealed in slots: under the
//! passphrase (PBKDF2) and, optionally, under a device-held biometric secret. Byte-compatible
//! with every file an earlier mobile core wrote.
//!
//! The shared core takes the vault version as an argument; here it is always
//! `migrations::VAULT_VERSION`, and it must equal the `version` of the payload a container seals:
//! a version-2 container holds vault-security's account-count payload, a version-3, -4 or -5
//! container the account records (`account_store.rs`; version 4 adds `backupPending`, version 5
//! each record's `ladder`). The payload is opaque bytes there; `migrations.rs` parses and
//! upgrades it. The DEK is generated, wrapped, unwrapped and zeroized in the shared core and never
//! crosses the FFI.

pub(crate) use wallet_core::container::*;
