//! Account groups ("folders"), reproducing `features/settings/src/groups.ts`: a user-named,
//! icon-tagged folder; an account is in at most one; ids are a deterministic slug of the name with
//! a `-2`, `-3`, … collision suffix. Pure functions over the sealed vault's group list.
//!
//! One deliberate tightening: the extension slices the slug to 64 units *after* trimming edge
//! dashes, so a 64th-character dash survives into an id its own validator then refuses. Mobile
//! trims again after the slice, so every id it writes passes the validator it reads with.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::account_catalog::catalog;
use crate::account_names::{js_trim, utf16_len};
use crate::CoreError;

const MAX_GROUP_NAME_UNITS: usize = 64;
const MAX_GROUP_ID_LENGTH: usize = 80;
const MAX_SLUG_LENGTH: usize = 64;
/// Groups one vault may hold (mobile policy, bounding vault size).
pub(crate) const MAX_GROUPS: usize = 128;

/// One stored group, in the extension's field names.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StoredGroup {
    pub account_ids: Vec<String>,
    pub icon: String,
    pub id: String,
    pub name: String,
}

/// A group as the UI renders it.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct AccountGroup {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub account_ids: Vec<String>,
}

impl From<&StoredGroup> for AccountGroup {
    fn from(group: &StoredGroup) -> Self {
        Self {
            id: group.id.clone(),
            name: group.name.clone(),
            icon: group.icon.clone(),
            account_ids: group.account_ids.clone(),
        }
    }
}

fn invalid(reason: &str) -> CoreError {
    CoreError::InvalidInput {
        reason: reason.into(),
    }
}

fn is_group_name(name: &str) -> bool {
    (1..=MAX_GROUP_NAME_UNITS).contains(&utf16_len(js_trim(name)))
}

fn is_group_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_GROUP_ID_LENGTH
        && id.split('-').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        })
}

fn is_group_icon(icon: &str) -> bool {
    catalog().group_icons.iter().any(|known| known == icon)
}

/// Lowercase, non-alphanumeric runs to one dash, edge dashes trimmed, at most 64, else "group".
fn slugify(name: &str) -> String {
    let mut slug = String::new();
    for c in js_trim(name).to_lowercase().chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            slug.push(c);
        } else if !slug.ends_with('-') {
            slug.push('-');
        }
    }
    let slug = slug.trim_matches('-');
    let slug = slug[..slug.len().min(MAX_SLUG_LENGTH)].trim_end_matches('-');
    if slug.is_empty() {
        "group".into()
    } else {
        slug.into()
    }
}

fn derive_id(groups: &[StoredGroup], name: &str) -> String {
    let base = slugify(name);
    let taken = |id: &str| groups.iter().any(|group| group.id == id);
    if !taken(&base) {
        return base;
    }
    (2..)
        .map(|suffix| format!("{base}-{suffix}"))
        .find(|id| !taken(id))
        .expect("an unused suffix exists")
}

fn checked_name_and_icon(name: &str, icon: &str) -> Result<String, CoreError> {
    if !is_group_name(name) {
        return Err(invalid("invalid group name"));
    }
    if !is_group_icon(icon) {
        return Err(invalid("invalid group icon"));
    }
    Ok(js_trim(name).to_string())
}

fn position(groups: &[StoredGroup], id: &str) -> Result<usize, CoreError> {
    groups
        .iter()
        .position(|group| group.id == id)
        .ok_or_else(|| invalid("unknown group"))
}

/// `createGroup`: appends a group with a collision-free id; returns its index.
pub(crate) fn create(
    groups: &mut Vec<StoredGroup>,
    name: &str,
    icon: &str,
) -> Result<usize, CoreError> {
    let name = checked_name_and_icon(name, icon)?;
    if groups.len() >= MAX_GROUPS {
        return Err(invalid("group limit reached"));
    }
    let id = derive_id(groups, &name);
    groups.push(StoredGroup {
        account_ids: Vec::new(),
        icon: icon.into(),
        id,
        name,
    });
    Ok(groups.len() - 1)
}

/// `renameGroup` then `setGroupIcon`, as the extension's edit form saves both.
pub(crate) fn update(
    groups: &mut [StoredGroup],
    id: &str,
    name: &str,
    icon: &str,
) -> Result<usize, CoreError> {
    let name = checked_name_and_icon(name, icon)?;
    let at = position(groups, id)?;
    groups[at].name = name;
    groups[at].icon = icon.into();
    Ok(at)
}

/// `removeGroup`.
pub(crate) fn remove(groups: &mut Vec<StoredGroup>, id: &str) -> Result<(), CoreError> {
    let at = position(groups, id)?;
    groups.remove(at);
    Ok(())
}

/// Files an account into exactly one group, or none. Filing into a group removes it from every
/// other (`setAccountInGroup(..., true)`); `None` clears its current folder (the picker's "None").
pub(crate) fn set_membership(
    groups: &mut [StoredGroup],
    account_id: &str,
    group_id: Option<&str>,
) -> Result<(), CoreError> {
    if let Some(group_id) = group_id {
        position(groups, group_id)?;
    }
    for group in groups.iter_mut() {
        let target = Some(group.id.as_str()) == group_id;
        let has = group.account_ids.iter().any(|id| id == account_id);
        if target && !has {
            group.account_ids.push(account_id.into());
        } else if !target && has {
            group.account_ids.retain(|id| id != account_id);
        }
    }
    Ok(())
}

/// The one group an account is filed under (`accountGroup`).
pub(crate) fn group_of<'a>(groups: &'a [StoredGroup], account_id: &str) -> Option<&'a StoredGroup> {
    groups
        .iter()
        .find(|group| group.account_ids.iter().any(|id| id == account_id))
}

/// Whether a stored group list satisfies every invariant: valid unique ids, trimmed valid names,
/// known icons, and each member an existing account in exactly one group.
pub(crate) fn is_valid(groups: &[StoredGroup], account_ids: &HashSet<&str>) -> bool {
    let mut ids = HashSet::new();
    let mut members = HashSet::new();
    groups.len() <= MAX_GROUPS
        && groups.iter().all(|group| {
            is_group_id(&group.id)
                && ids.insert(group.id.as_str())
                && is_group_name(&group.name)
                && js_trim(&group.name) == group.name
                && is_group_icon(&group.icon)
                && group
                    .account_ids
                    .iter()
                    .all(|id| account_ids.contains(id.as_str()) && members.insert(id.as_str()))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs_and_suffixes() {
        let mut groups = Vec::new();
        for name in ["Long term", "Long term", "long-term"] {
            create(&mut groups, name, "folder").unwrap();
        }
        let ids: Vec<_> = groups.iter().map(|g| g.id.as_str()).collect();
        assert_eq!(ids, ["long-term", "long-term-2", "long-term-3"]);
        assert_eq!(slugify("🔥🔥"), "group");
        assert_eq!(slugify(&format!("{} y", "x".repeat(63))), "x".repeat(63));
        assert!(create(&mut groups, "  ", "folder").is_err());
        assert!(create(&mut groups, "Ok", "not-an-icon").is_err());
    }

    #[test]
    fn membership_is_exclusive() {
        let mut groups = Vec::new();
        create(&mut groups, "A", "folder").unwrap();
        create(&mut groups, "B", "star").unwrap();
        set_membership(&mut groups, "SN_MAIN:0x1", Some("a")).unwrap();
        set_membership(&mut groups, "SN_MAIN:0x1", Some("b")).unwrap();
        assert!(groups[0].account_ids.is_empty());
        assert_eq!(group_of(&groups, "SN_MAIN:0x1").unwrap().id, "b");
        set_membership(&mut groups, "SN_MAIN:0x1", None).unwrap();
        assert!(group_of(&groups, "SN_MAIN:0x1").is_none());
        assert!(set_membership(&mut groups, "SN_MAIN:0x1", Some("zzz")).is_err());
        let known = HashSet::from(["SN_MAIN:0x1"]);
        assert!(is_valid(&groups, &known));
        groups[0].account_ids.push("SN_MAIN:0x1".into());
        groups[1].account_ids.push("SN_MAIN:0x1".into());
        assert!(!is_valid(&groups, &known), "two groups for one account");
    }
}
