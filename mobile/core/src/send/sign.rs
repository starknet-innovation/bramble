//! Transaction hashes through Krusty 0.11.0 (`compute_invoke_v3_hash`,
//! `compute_deploy_account_v3_hash`) over exactly the fields `rpc_bodies` sends, with the chain
//! id taken from `NetworkId` and never from a node. Signing itself happens in
//! `WalletCore::plan_sign`, which refuses once the session generation has moved.

use krusty_kms::{compute_deploy_account_v3_hash, compute_invoke_v3_hash, DaMode};
use starknet_types_core::felt::Felt;

use super::fees::{krusty_bounds, Bounds, FeeRefusal};
use super::plan::Deployment;
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

/// The v3 DEPLOY_ACCOUNT hash for the account's own deployment (`plan::Deployment`): nonce 0
/// (starknet.js `deployAccount`), the class, salt and constructor calldata the address commits to.
pub fn deploy_hash(
    network: NetworkId,
    address: &Felt,
    deployment: &Deployment,
    bounds: &Bounds,
) -> Result<Felt, FeeRefusal> {
    let (l1, l2, data) = krusty_bounds(bounds)?;
    Ok(compute_deploy_account_v3_hash(
        address,
        &deployment.class_hash,
        &deployment.constructor_calldata,
        &deployment.salt,
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
