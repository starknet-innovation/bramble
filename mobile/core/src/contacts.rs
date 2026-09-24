//! The address book (`contacts.json`), stored as the extension's `AddressBookEntry` values: a
//! padded canonical address, an id of `<networkId>:<address>`, a trimmed 1–64 character label, and
//! optional public signer and coordination keys. Coordination trusts only saved contacts, so this
//! file is what decides whose gift wraps can count as co-signer updates.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::contact_card::{canonical_address, js_trim, lenient_hex_felt};
use crate::networks::NetworkId;
use crate::{felt, nostr, public_store, CoreError};

/// The extension's address book has no count limit; mobile bounds the file.
const MAX_CONTACTS: usize = 200;

/// A saved contact; every field is public.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Contact {
    pub id: String,
    pub label: String,
    pub network: NetworkId,
    pub address: String,
    pub public_key_x: Option<String>,
    pub nostr_public_key: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Entry {
    pub address: String,
    pub id: String,
    pub label: String,
    pub network_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nostr_public_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub public_key_x: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct File {
    version: u32,
    entries: Vec<Entry>,
}

fn invalid() -> CoreError {
    CoreError::InvalidInput {
        reason: "invalid address book entry".into(),
    }
}

/// The catalog id the extension stores for a network.
pub fn network_catalog_id(network: NetworkId) -> &'static str {
    network.catalog_id()
}

/// The network for a stored catalog id.
pub fn network_from_catalog_id(id: &str) -> Option<NetworkId> {
    [NetworkId::Mainnet, NetworkId::Sepolia]
        .into_iter()
        .find(|network| network.catalog_id() == id)
}

/// `isLabel`: 1–64 UTF-16 code units once trimmed.
pub fn is_label(value: &str) -> bool {
    let length = nostr::utf16_length(js_trim(value));
    (1..=64).contains(&length)
}

/// `isAddressBookEntry`, including the derived id and strict canonical spellings.
fn is_entry(entry: &Entry) -> bool {
    network_from_catalog_id(&entry.network_id).is_some()
        && canonical_address(&entry.address).as_deref() == Some(entry.address.as_str())
        && is_label(&entry.label)
        && entry.id == format!("{}:{}", entry.network_id, entry.address)
        && entry
            .nostr_public_key
            .as_deref()
            .is_none_or(nostr::is_public_key)
        && entry.public_key_x.as_deref().is_none_or(|key| {
            felt::parse_non_zero(key).is_some_and(|value| felt::canonical(&value) == key)
        })
}

/// Every stored entry, validated; an invalid file fails closed.
pub fn load(dir: &Path) -> Result<Vec<Entry>, CoreError> {
    let Some(file) = public_store::read::<File>(dir, public_store::CONTACTS)? else {
        return Ok(Vec::new());
    };
    let unique = file.entries.iter().enumerate().all(|(index, entry)| {
        file.entries[..index]
            .iter()
            .all(|other| other.id != entry.id)
    });
    if file.version != 1
        || file.entries.len() > MAX_CONTACTS
        || !unique
        || !file.entries.iter().all(is_entry)
    {
        return Err(CoreError::Storage {
            reason: format!("{} unreadable", public_store::CONTACTS),
        });
    }
    Ok(file.entries)
}

fn store(dir: &Path, entries: Vec<Entry>) -> Result<(), CoreError> {
    public_store::write(
        dir,
        public_store::CONTACTS,
        &File {
            version: 1,
            entries,
        },
    )
}

/// The public projection handed to the UI.
pub fn view(entry: &Entry) -> Option<Contact> {
    Some(Contact {
        id: entry.id.clone(),
        label: entry.label.clone(),
        network: network_from_catalog_id(&entry.network_id)?,
        address: entry.address.clone(),
        public_key_x: entry.public_key_x.clone(),
        nostr_public_key: entry.nostr_public_key.clone(),
    })
}

/// Contacts on one network, in saved order.
pub fn list(dir: &Path, network: NetworkId) -> Result<Vec<Contact>, CoreError> {
    Ok(load(dir)?
        .iter()
        .filter(|entry| entry.network_id == network_catalog_id(network))
        .filter_map(view)
        .collect())
}

/// `saveAddress`: canonicalises, validates, and keeps previously saved keys a re-save omits.
pub fn save(
    dir: &Path,
    network: NetworkId,
    label: &str,
    address: &str,
    public_key_x: Option<&str>,
    nostr_public_key: Option<&str>,
) -> Result<Contact, CoreError> {
    let address = canonical_address(address).ok_or_else(invalid)?;
    let public_key_x = match public_key_x.map(js_trim).filter(|key| !key.is_empty()) {
        Some(key) => Some(felt::canonical(&lenient_hex_felt(key).ok_or_else(invalid)?)),
        None => None,
    };
    let nostr_public_key = nostr_public_key.map(js_trim).filter(|key| !key.is_empty());
    if nostr_public_key.is_some_and(|key| !nostr::is_public_key(key)) {
        return Err(invalid());
    }
    let network_id = network_catalog_id(network);
    let mut entry = Entry {
        id: format!("{network_id}:{address}"),
        address,
        label: js_trim(label).to_string(),
        network_id: network_id.to_string(),
        nostr_public_key: nostr_public_key.map(str::to_string),
        public_key_x,
    };
    if !is_entry(&entry) {
        return Err(invalid());
    }
    let mut entries = load(dir)?;
    if let Some(previous) = entries.iter().find(|stored| stored.id == entry.id) {
        entry.nostr_public_key = entry
            .nostr_public_key
            .or_else(|| previous.nostr_public_key.clone());
        entry.public_key_x = entry.public_key_x.or_else(|| previous.public_key_x.clone());
    } else if entries.len() >= MAX_CONTACTS {
        return Err(CoreError::InvalidInput {
            reason: "address book is full".into(),
        });
    }
    entries.retain(|stored| stored.id != entry.id);
    entries.push(entry.clone());
    store(dir, entries)?;
    view(&entry).ok_or_else(invalid)
}

/// Removes one contact by id; removing an unknown id is not an error.
pub fn remove(dir: &Path, id: &str) -> Result<(), CoreError> {
    let mut entries = load(dir)?;
    let before = entries.len();
    entries.retain(|entry| entry.id != id);
    if entries.len() != before {
        store(dir, entries)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_canonical_entries_and_keeps_keys_on_resave() {
        let dir = tempfile::tempdir().unwrap();
        let saved = save(
            dir.path(),
            NetworkId::Sepolia,
            "  Ada ",
            "0xABC ",
            Some("0x0456"),
            Some(&"11".repeat(32)),
        )
        .unwrap();
        assert_eq!(saved.label, "Ada");
        assert_eq!(saved.address, format!("0x{}abc", "0".repeat(61)));
        assert_eq!(saved.id, format!("SN_SEPOLIA:{}", saved.address));
        assert_eq!(saved.public_key_x.as_deref(), Some("0x456"));
        let resaved = save(dir.path(), NetworkId::Sepolia, "Ada L", "0xabc", None, None).unwrap();
        assert_eq!(resaved.public_key_x.as_deref(), Some("0x456"));
        assert_eq!(resaved.nostr_public_key, saved.nostr_public_key);
        assert_eq!(list(dir.path(), NetworkId::Sepolia).unwrap().len(), 1);
        assert!(list(dir.path(), NetworkId::Mainnet).unwrap().is_empty());
        remove(dir.path(), &saved.id).unwrap();
        assert!(list(dir.path(), NetworkId::Sepolia).unwrap().is_empty());
    }

    #[test]
    fn refuses_invalid_input_and_invalid_files() {
        let dir = tempfile::tempdir().unwrap();
        assert!(save(dir.path(), NetworkId::Sepolia, " ", "0x1", None, None).is_err());
        assert!(save(dir.path(), NetworkId::Sepolia, "a", "0x0", None, None).is_err());
        assert!(save(
            dir.path(),
            NetworkId::Sepolia,
            "a",
            "0x1",
            None,
            Some("0x11")
        )
        .is_err());
        assert!(save(
            dir.path(),
            NetworkId::Sepolia,
            &"x".repeat(65),
            "0x1",
            None,
            None
        )
        .is_err());
        std::fs::write(
            dir.path().join("contacts.json"),
            r#"{"version":2,"entries":[]}"#,
        )
        .unwrap();
        assert!(matches!(
            list(dir.path(), NetworkId::Sepolia),
            Err(CoreError::Storage { .. })
        ));
        std::fs::write(
            dir.path().join("contacts.json"),
            r#"{"version":1,"entries":[],"x":1}"#,
        )
        .unwrap();
        assert!(list(dir.path(), NetworkId::Sepolia).is_err());
    }
}
