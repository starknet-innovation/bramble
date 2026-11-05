//! The discovery scan's advisory reads for a deployed candidate, reproducing the extension's
//! `argentSigningRestriction`, `braavosSigningRestriction` (issue 542) and
//! `strk20RegisteredElsewhere` (the privacy-pool note). Every read is at `latest`, as the
//! extension's scan reads.
//!
//! Advisory only: a read that fails or answers malformed leaves the row unlabelled and never
//! pauses the scan. A wrong or missing signer verdict can mislabel a row but never move funds,
//! because the send path (`plan_probe.rs`) re-checks authoritatively. The extension's privacy
//! path also refuses an account another wallet registered (`strk20RegistrationBlock`); mobile's
//! privacy path does not check that yet, so here the pool note is the only signal.

use std::collections::HashMap;

use serde_json::json;
use starknet_types_core::felt::Felt;

use crate::account_catalog::{catalog, class_entry, AccountFamily};
use crate::account_store::VaultPayload;
use crate::networks::{self, NetworkId};
use crate::privacy::config::route_for;
use crate::recovery::{Found, Restriction};
use crate::send::judge;
use crate::send::plan_probe::{self as probe, braavos_signers, selector, ARGENT_SIGNER_ARRAY};
use crate::{felt, kms, rpc};

/// The pool's `get_public_key(address)`: the viewing key registered for an account.
const GET_PUBLIC_KEY: &str = "0x1a35984e05126dbecb7c3bb9929e7dd9106d460c59b1633739a5c733a5fb13b";

/// One advisory `starknet_call`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Read {
    Owner,
    OwnerType,
    Guardian,
    Signers,
    Deferred,
    PoolKey,
}

/// What the reads gathered for one deployed candidate: its live class from the class-hash round,
/// and each read's felts, `None` where the read did not answer.
#[derive(Debug, Default)]
pub(crate) struct Gathered {
    pub live_class: Option<Felt>,
    pub reads: HashMap<Read, Option<Vec<Felt>>>,
}

impl Gathered {
    fn get(&self, read: Read) -> Option<&[Felt]> {
        self.reads.get(&read)?.as_deref()
    }
}

/// Whether this wallet signs for an account of `family` running `live_class`: Argent's signer
/// array (`requireAuthorizableArgentClass`) or a Braavos implementation (`isBraavosSigningClass`).
fn signs_for(family: AccountFamily, live_class: &Felt) -> bool {
    match family {
        AccountFamily::Argent => class_entry(live_class).is_some_and(|entry| {
            entry.family == AccountFamily::Argent
                && entry.info.authorization_shape == ARGENT_SIGNER_ARRAY
        }),
        AccountFamily::Braavos => catalog().braavos_signing.contains(live_class),
        AccountFamily::OpenZeppelin => false,
    }
}

/// The reads one deployed candidate needs: its signer views when its live class is one this
/// wallet signs for (otherwise the verdict is `Release` with no read), and the pool's key for its
/// address when the network has a pool.
pub(crate) fn reads(family: AccountFamily, live_class: &Felt, pool: bool) -> Vec<Read> {
    let mut reads = match family {
        _ if !signs_for(family, live_class) => Vec::new(),
        AccountFamily::Argent => vec![Read::Owner, Read::OwnerType, Read::Guardian],
        AccountFamily::Braavos => vec![Read::Signers, Read::Deferred],
        AccountFamily::OpenZeppelin => Vec::new(),
    };
    if pool {
        reads.push(Read::PoolKey);
    }
    reads
}

/// Whether the Braavos verdict turns on the latest block's timestamp: this wallet's key is the
/// first Stark signer, a strong signer is active, and its removal was requested.
pub(crate) fn needs_block(family: AccountFamily, gathered: &Gathered, public_key: &Felt) -> bool {
    let removal_requested = || {
        let (first_stark, strong) = braavos_signers(gathered.get(Read::Signers)?)?;
        let expire_at = gathered.get(Read::Deferred)?.first().copied();
        Some(
            first_stark == Some(*public_key)
                && strong
                && expire_at.is_some_and(|at| at != Felt::ZERO),
        )
    };
    family == AccountFamily::Braavos
        && gathered
            .live_class
            .is_some_and(|class| signs_for(family, &class))
        && removal_requested() == Some(true)
}

/// The `starknet_call` body for `read` at `latest`. `pool` is required for `Read::PoolKey`.
pub(crate) fn body(id: u64, read: Read, address: &Felt, pool: &Felt) -> String {
    let (contract, entry_point, calldata) = match read {
        Read::Owner => (address, probe::GET_OWNER, vec![]),
        Read::OwnerType => (address, probe::GET_OWNER_TYPE, vec![]),
        Read::Guardian => (address, probe::GET_GUARDIAN, vec![]),
        Read::Signers => (address, probe::GET_SIGNERS, vec![]),
        Read::Deferred => (address, probe::GET_DEFERRED_REMOVE_SIGNERS, vec![]),
        Read::PoolKey => (pool, GET_PUBLIC_KEY, vec![felt::canonical(address)]),
    };
    rpc::envelope(
        id,
        "starknet_call",
        json!({
            "block_id": "latest",
            "request": {
                "calldata": calldata,
                "contract_address": felt::canonical(contract),
                "entry_point_selector": felt::canonical(&selector(entry_point)),
            },
        }),
    )
}

/// `starknet_getBlockWithTxHashes` at `latest`, for its timestamp.
pub(crate) fn block_body(id: u64) -> String {
    rpc::envelope(
        id,
        "starknet_getBlockWithTxHashes",
        json!({ "block_id": "latest" }),
    )
}

/// A call's felts, or `None` for an error, a malformed reply or a foreign id.
pub(crate) fn judge_call(body: &str, id: u64) -> Option<Vec<Felt>> {
    judge::call_felts(judge::answer(body, id)).ok()
}

/// A block's timestamp, or `None` when the reply is unusable.
pub(crate) fn judge_block(body: &str, id: u64) -> Option<u64> {
    judge::block_timestamp(judge::answer(body, id)).ok()
}

/// `argentSigningRestriction` / `braavosSigningRestriction`: the first reason this wallet could
/// not sign for the account, or `None` when it could or a read did not answer.
pub(crate) fn restriction(
    family: AccountFamily,
    gathered: &Gathered,
    public_key: &Felt,
    block_time: Option<u64>,
) -> Option<Restriction> {
    let live_class = gathered.live_class.as_ref()?;
    if family == AccountFamily::OpenZeppelin {
        return None;
    }
    if !signs_for(family, live_class) {
        return Some(Restriction::Release);
    }
    if family == AccountFamily::Argent {
        let (owner, owner_type, guardian) = (
            gathered.get(Read::Owner)?,
            gathered.get(Read::OwnerType)?,
            gathered.get(Read::Guardian)?,
        );
        return if owner != [*public_key] {
            Some(Restriction::OwnerChanged)
        } else if owner_type != [Felt::ZERO] {
            Some(Restriction::OwnerType)
        } else if guardian != [Felt::ZERO] {
            Some(Restriction::Guardian)
        } else {
            None
        };
    }
    let (first_stark, strong) = braavos_signers(gathered.get(Read::Signers)?)?;
    if first_stark != Some(*public_key) {
        return Some(Restriction::OwnerChanged);
    }
    if !strong {
        return None;
    }
    // `braavosSignerVerdict`: a requested removal counts only once the block is strictly after
    // `expire_at`.
    let expire_at = gathered
        .get(Read::Deferred)?
        .first()
        .copied()
        .unwrap_or(Felt::ZERO);
    if expire_at == Felt::ZERO {
        return Some(Restriction::StrongSigner);
    }
    let expired = Felt::from(block_time?).to_biguint() > expire_at.to_biguint();
    (!expired).then_some(Restriction::StrongSigner)
}

/// `strk20RegisteredElsewhere`: the pool holds a non-zero key for the address that is not the
/// one this wallet would register. `own` is derived only then; a failed derivation answers false.
pub(crate) fn registered_elsewhere(
    gathered: &Gathered,
    own: impl FnOnce() -> Option<Felt>,
) -> bool {
    match gathered.get(Read::PoolKey) {
        Some([registered]) if *registered != Felt::ZERO => {
            own().is_some_and(|own| own != *registered)
        }
        _ => false,
    }
}

/// Settles one deployed candidate's advisory verdicts. The own viewing key is derived only for
/// an account the pool holds a non-zero key for.
pub(crate) fn settle(
    found: &mut Found,
    gathered: &Gathered,
    public_key: &Felt,
    block_time: Option<u64>,
    payload: &VaultPayload,
    network: NetworkId,
) {
    found.restriction = restriction(found.family, gathered, public_key, block_time);
    let Some(pool) = route_for(network).map(|route| felt::canonical(&route.pool)) else {
        return;
    };
    let (ladder, account_index) = (found.ladder, found.account_index);
    found.privacy_elsewhere = registered_elsewhere(gathered, || {
        kms::scoped_viewing_public_key(
            &payload.mnemonic,
            payload.mnemonic_passphrase.as_deref(),
            ladder,
            account_index,
            &networks::info(network).chain_id,
            &pool,
        )
        .ok()
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: Felt = Felt::from_hex_unchecked("0x77");

    fn gathered(family: AccountFamily, reads: &[(Read, Option<Vec<Felt>>)]) -> Gathered {
        let live_class = match family {
            AccountFamily::Argent => catalog().argent_default,
            AccountFamily::Braavos => catalog().braavos_signing[0],
            AccountFamily::OpenZeppelin => catalog().open_zeppelin_class,
        };
        Gathered {
            live_class: Some(live_class),
            reads: reads.iter().cloned().collect(),
        }
    }

    fn argent(owner: Felt, owner_type: Felt, guardian: Felt) -> Option<Restriction> {
        let reads = [
            (Read::Owner, Some(vec![owner])),
            (Read::OwnerType, Some(vec![owner_type])),
            (Read::Guardian, Some(vec![guardian])),
        ];
        restriction(
            AccountFamily::Argent,
            &gathered(AccountFamily::Argent, &reads),
            &KEY,
            None,
        )
    }

    #[test]
    fn argent_verdicts_follow_the_extensions_order() {
        let one = Felt::ONE;
        assert_eq!(argent(KEY, Felt::ZERO, Felt::ZERO), None);
        assert_eq!(argent(one, one, one), Some(Restriction::OwnerChanged));
        assert_eq!(argent(KEY, one, one), Some(Restriction::OwnerType));
        assert_eq!(argent(KEY, Felt::ZERO, one), Some(Restriction::Guardian));
        // A read that did not answer is no verdict, never a guess.
        let partial = gathered(AccountFamily::Argent, &[(Read::Owner, Some(vec![one]))]);
        assert_eq!(
            restriction(AccountFamily::Argent, &partial, &KEY, None),
            None
        );
        // A live class this wallet cannot authorize for needs no read.
        let mut old = gathered(AccountFamily::Argent, &[]);
        old.live_class = Some(Felt::from(5u8));
        assert_eq!(
            restriction(AccountFamily::Argent, &old, &KEY, None),
            Some(Restriction::Release)
        );
        assert!(reads(AccountFamily::Argent, &Felt::from(5u8), false).is_empty());
    }

    fn braavos(
        signers: Vec<Felt>,
        deferred: Option<Felt>,
        block: Option<u64>,
    ) -> Option<Restriction> {
        let reads = [
            (Read::Signers, Some(signers)),
            (Read::Deferred, Some(deferred.into_iter().collect())),
        ];
        restriction(
            AccountFamily::Braavos,
            &gathered(AccountFamily::Braavos, &reads),
            &KEY,
            block,
        )
    }

    #[test]
    fn the_block_is_read_only_for_a_requested_2fa_removal() {
        let needs = |signers: Vec<Felt>, deferred: Option<Felt>| {
            let reads = [
                (Read::Signers, Some(signers)),
                (Read::Deferred, Some(deferred.into_iter().collect())),
            ];
            needs_block(
                AccountFamily::Braavos,
                &gathered(AccountFamily::Braavos, &reads),
                &KEY,
            )
        };
        let with_2fa = vec![Felt::ONE, KEY, Felt::ONE, Felt::from(9u8), Felt::ZERO];
        let expire = Some(Felt::from(100u8));
        assert!(needs(with_2fa.clone(), expire));
        assert!(!needs(with_2fa, None), "no removal requested");
        assert!(
            !needs(vec![Felt::ONE, KEY, Felt::ZERO, Felt::ZERO], expire),
            "no 2FA"
        );
        assert!(
            !needs(vec![Felt::ONE, Felt::TWO, Felt::ZERO, Felt::ZERO], expire),
            "not ours"
        );
    }

    #[test]
    fn braavos_verdicts_follow_the_extensions_order() {
        let felts = |values: &[u64]| values.iter().map(|v| Felt::from(*v)).collect::<Vec<_>>();
        let stark_only = vec![Felt::ONE, KEY, Felt::ZERO, Felt::ZERO];
        let with_2fa = vec![Felt::ONE, KEY, Felt::ONE, Felt::from(9u8), Felt::ZERO];
        assert_eq!(braavos(stark_only, None, None), None);
        assert_eq!(
            braavos(felts(&[1, 5, 0, 0]), None, None),
            Some(Restriction::OwnerChanged)
        );
        assert_eq!(
            braavos(with_2fa.clone(), None, None),
            Some(Restriction::StrongSigner)
        );
        let expire = Some(Felt::from(100u8));
        assert_eq!(braavos(with_2fa.clone(), expire, Some(101)), None);
        assert_eq!(
            braavos(with_2fa.clone(), expire, Some(100)),
            Some(Restriction::StrongSigner)
        );
        assert_eq!(
            braavos(with_2fa, expire, None),
            None,
            "no block, no verdict"
        );
        assert_eq!(braavos(felts(&[3, 1]), None, None), None, "malformed list");
    }

    #[test]
    fn the_pool_note_needs_a_foreign_non_zero_key() {
        let pool =
            |key: Option<Vec<Felt>>| gathered(AccountFamily::OpenZeppelin, &[(Read::PoolKey, key)]);
        assert!(registered_elsewhere(&pool(Some(vec![Felt::TWO])), || Some(
            KEY
        )));
        assert!(!registered_elsewhere(&pool(Some(vec![KEY])), || Some(KEY)));
        assert!(!registered_elsewhere(
            &pool(Some(vec![Felt::ZERO])),
            || panic!("not derived")
        ));
        assert!(!registered_elsewhere(&pool(None), || panic!("not derived")));
        assert!(!registered_elsewhere(&pool(Some(vec![Felt::TWO])), || None));
    }

    #[test]
    fn get_public_key_is_starknet_keccak() {
        use sha3::{Digest, Keccak256};
        let mut digest: [u8; 32] = Keccak256::digest(b"get_public_key").into();
        digest[0] &= 0x03;
        assert_eq!(Felt::from_bytes_be(&digest), selector(GET_PUBLIC_KEY));
    }
}
