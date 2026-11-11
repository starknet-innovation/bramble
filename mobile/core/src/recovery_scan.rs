//! The discovery scan's mobile side. The scan itself is `wallet_core::accounts::scan`: it derives
//! each batch's candidate addresses and hands the host JSON-RPC bodies, the host POSTs them
//! through its chain-verified client and passes the bodies back, and the core judges them,
//! reading balances for undeployed candidates and the advisory signer and privacy-pool reads for
//! deployed ones. State lives only in the unlocked session and is dropped on lock, as the
//! extension's `recovery-cache.ts` is keyed by (fingerprint, network).
//!
//! What stays here is Bramble's: the `ScanConfig` (the catalog's shapes in order with their
//! creatable rule, `RECOVERY_SCAN_LIMITS`, the reserved agent index, the classes this wallet signs
//! for, the network's tokens and privacy pool), the UniFFI step record, and the status lines.

use wallet_core::accounts::scan::{Scan, ScanConfig, ScanLimits, ScanStep};

use crate::account_catalog::{catalog, send_authorization, AccountFamily};
use crate::account_store::VaultPayload;
use crate::networks::{self, NetworkId};
use crate::privacy::config::route_for;
use crate::recovery::{candidate, scan_shapes, RecoveryCandidate};
use crate::rpc_request::{RpcRequest, RpcResponse};
use crate::{felt, CoreError};

/// Where the scan stands after a call.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct RecoveryScanStep {
    /// Bodies to POST and return through `recovery_scan_submit`; empty once a batch is judged.
    pub requests: Vec<RpcRequest>,
    pub candidates: Vec<RecoveryCandidate>,
    /// Indices checked so far (the extension's `nextIndex`).
    pub checked: u32,
    pub complete: bool,
    pub status: String,
}

/// One scan's in-memory state: the core's scan and the network it was last started on, whose
/// configuration its responses are judged with.
pub(crate) struct ScanState {
    scan: Scan,
    network: NetworkId,
}

/// Bramble's scan of `payload`'s phrase on `network`. A phrase opened with a BIP-39 passphrase
/// has no Ready accounts, so their shapes are left out rather than failing the scan.
fn config(payload: &VaultPayload, network: NetworkId) -> Result<ScanConfig, CoreError> {
    let catalog = catalog();
    let limits = catalog.limits;
    let tokens = networks::info(network)
        .tokens
        .iter()
        .map(|token| {
            felt::parse_non_zero(&token.address).ok_or_else(|| CoreError::Rpc {
                reason: "token is not an address".into(),
            })
        })
        .collect::<Result<_, _>>()?;
    Ok(ScanConfig {
        network,
        shapes: scan_shapes(payload.mnemonic_passphrase.is_none(), network)?,
        limits: ScanLimits {
            batch_size: limits.batch_size,
            default_count: limits.default_count,
            max_index: limits.max_index,
            max_scanned_indexes: limits.max_scanned_indexes,
        },
        reserved_indexes: vec![catalog.reserved_agent_index],
        tokens,
        privacy_pool: route_for(network).map(|route| route.pool),
        authorizations: [AccountFamily::Argent, AccountFamily::Braavos]
            .into_iter()
            .map(send_authorization)
            .collect(),
    })
}

/// The core's step, worded for the discovery screen.
fn worded(step: ScanStep) -> RecoveryScanStep {
    let status = if !step.requests.is_empty() && step.checked == 0 {
        "Searching every account type…".to_string()
    } else if step.complete {
        format!(
            "Search complete. Checked {} indices across every account type.",
            step.checked
        )
    } else {
        format!("Checked {} of {} indices…", step.checked, step.target)
    };
    RecoveryScanStep {
        requests: step.requests,
        candidates: step.candidates.iter().map(candidate).collect(),
        checked: step.checked,
        complete: step.complete,
        status,
    }
}

/// Starts (or restarts) the next batch: the next four indices, or one manual index. Another
/// phrase or network starts a new scan.
pub(crate) fn next(
    state: &mut Option<ScanState>,
    payload: &VaultPayload,
    network: NetworkId,
    manual_index: Option<u32>,
) -> Result<RecoveryScanStep, CoreError> {
    let config = config(payload, network)?;
    let state = state.get_or_insert_with(|| ScanState {
        scan: Scan::new(),
        network,
    });
    state.network = network;
    let step = state.scan.next(
        &payload.mnemonic,
        payload.mnemonic_passphrase.as_deref(),
        &config,
        manual_index,
    )?;
    Ok(worded(step))
}

/// Judges the host's responses. Returns the second round's requests after the class-hash round,
/// then the latest block when a Braavos verdict needs it, or the finished batch.
pub(crate) fn submit(
    state: &mut Option<ScanState>,
    payload: &VaultPayload,
    responses: &[RpcResponse],
) -> Result<RecoveryScanStep, CoreError> {
    let state = state.as_mut().ok_or_else(|| CoreError::InvalidInput {
        reason: "no account search in progress".into(),
    })?;
    let config = config(payload, state.network)?;
    let step = state.scan.submit(
        &payload.mnemonic,
        payload.mnemonic_passphrase.as_deref(),
        &config,
        responses,
    )?;
    Ok(worded(step))
}

#[cfg(test)]
mod tests {
    use crate::account_catalog::catalog;
    use crate::account_store::is_usable_account_index;

    #[test]
    fn the_reserved_agent_index_is_never_usable() {
        let reserved = catalog().reserved_agent_index;
        assert_eq!(reserved, 0x4147_4e54);
        assert!(!is_usable_account_index(reserved));
        assert!(is_usable_account_index(reserved - 1));
        assert!(catalog().limits.max_scanned_indexes < reserved);
    }
}
