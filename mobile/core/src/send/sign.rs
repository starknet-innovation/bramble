//! Transaction hashes through Krusty 0.11.0 (`compute_invoke_v3_hash`,
//! `compute_deploy_account_v3_hash`) over exactly the fields `rpc_bodies` sends, with the chain
//! id taken from `NetworkId` and never from a node. Signing itself happens in
//! `WalletCore::plan_sign`, which refuses once the session generation has moved.

use krusty_kms::{compute_deploy_account_v3_hash, compute_invoke_v3_hash, DaMode};
use starknet_types_core::felt::Felt;

use super::fees::{krusty_bounds, Bounds, FeeRefusal};
use crate::networks::NetworkId;

/// The v3 INVOKE hash: tip 0, no paymaster or deployment data, L1 data availability.
pub fn invoke_hash(
    network: NetworkId,
    sender: &Felt,
    calldata: &[Felt],
    nonce: &Felt,
    bounds: &Bounds,
) -> Result<Felt, FeeRefusal> {
    let (l1, l2, data) = krusty_bounds(bounds)?;
    Ok(compute_invoke_v3_hash(
        sender,
        calldata,
        &network.chain().as_felt(),
        nonce,
        &[],
        0,
        &l1,
        &l2,
        &data,
        &[],
        DaMode::L1,
        DaMode::L1,
    ))
}

/// The v3 DEPLOY_ACCOUNT hash for an OpenZeppelin account: salt 0, the public key as the only
/// constructor argument, nonce 0 (starknet.js `deployAccount`).
pub fn deploy_hash(
    network: NetworkId,
    address: &Felt,
    class_hash: &Felt,
    public_key: &Felt,
    bounds: &Bounds,
) -> Result<Felt, FeeRefusal> {
    let (l1, l2, data) = krusty_bounds(bounds)?;
    Ok(compute_deploy_account_v3_hash(
        address,
        class_hash,
        &[*public_key],
        &Felt::ZERO,
        &network.chain().as_felt(),
        &Felt::ZERO,
        0,
        &l1,
        &l2,
        &data,
        &[],
        DaMode::L1,
        DaMode::L1,
    ))
}
