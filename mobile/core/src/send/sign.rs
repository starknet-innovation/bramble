//! Transaction hashes through Krusty 0.11.0 (`compute_invoke_v3_hash`,
//! `compute_deploy_account_v3_hash`) over exactly the fields `rpc_bodies` sends, with the chain
//! id taken from `NetworkId` and never from a node. Signing itself happens in
//! `WalletCore::plan_sign`, which refuses once the session generation has moved.
//!
//! Braavos is the one exception. Its constructor checks the deploy signature even when the
//! deployment is only estimated, so the estimate is signed for real over the query-version
//! hash, which can never be broadcast. Krusty hashes only version 3, so `deploy_query_hash`
//! composes the same fields with the query version; a test pins it to Krusty at version 3.

use krusty_kms::{compute_deploy_account_v3_hash, compute_invoke_v3_hash, DaMode};
use starknet_types_core::felt::Felt;
use starknet_types_core::hash::{Poseidon, StarkHash};

use super::fees::{krusty_bounds, Bound, Bounds, FeeRefusal};
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

/// `"deploy_account"`, the DEPLOY_ACCOUNT hash prefix.
const DEPLOY_ACCOUNT_PREFIX: Felt = Felt::from_hex_unchecked("0x6465706c6f795f6163636f756e74");
/// Version 3 with the query bit (2^128) set: what an estimate carries.
const QUERY_VERSION_3: Felt = Felt::from_hex_unchecked("0x100000000000000000000000000000003");

const TWO_POW_128: Felt = Felt::from_hex_unchecked("0x100000000000000000000000000000000");
const TWO_POW_192: Felt =
    Felt::from_hex_unchecked("0x1000000000000000000000000000000000000000000000000");

/// `resource_name * 2^192 + max_amount * 2^128 + max_price_per_unit`.
fn packed(name: &[u8], bound: &Bound) -> Felt {
    Felt::from_bytes_be_slice(name) * TWO_POW_192
        + Felt::from(bound.max_amount) * TWO_POW_128
        + Felt::from(bound.max_price_per_unit)
}

/// The DEPLOY_ACCOUNT hash at `version`, composed as Krusty composes it: tip 0, no paymaster
/// data, L1 data availability for nonce and fee.
fn deploy_hash_at(
    version: Felt,
    network: NetworkId,
    address: &Felt,
    deployment: &Deployment,
    nonce: &Felt,
    bounds: &Bounds,
) -> Felt {
    let fee_hash = Poseidon::hash_array(&[
        Felt::ZERO,
        packed(b"L1_GAS", &bounds.l1_gas),
        packed(b"L2_GAS", &bounds.l2_gas),
        packed(b"L1_DATA", &bounds.l1_data_gas),
    ]);
    Poseidon::hash_array(&[
        DEPLOY_ACCOUNT_PREFIX,
        version,
        *address,
        fee_hash,
        Poseidon::hash_array(&[]),
        network.chain().as_felt(),
        *nonce,
        Felt::ZERO,
        Poseidon::hash_array(&deployment.constructor_calldata),
        deployment.class_hash,
        deployment.salt,
    ])
}

/// The query-version DEPLOY_ACCOUNT hash of the estimate `rpc_bodies::estimate` sends: zero
/// resource bounds, at `nonce`. Signed only for a Braavos estimate; never broadcastable.
pub fn deploy_query_hash(
    network: NetworkId,
    address: &Felt,
    deployment: &Deployment,
    nonce: &Felt,
) -> Felt {
    let zero = Bound {
        max_amount: 0,
        max_price_per_unit: 0,
    };
    let bounds = Bounds {
        l1_gas: zero,
        l2_gas: zero,
        l1_data_gas: zero,
    };
    deploy_hash_at(
        QUERY_VERSION_3,
        network,
        address,
        deployment,
        nonce,
        &bounds,
    )
}

/// The `AdditionalDeploymentParams` a Braavos deployment carries in its signature (the layout
/// braavos-account-cairo pins): the implementation to install, no secp256r1 signer (type and two
/// u256 limbs), no multisig threshold, no withdrawal limit or fee rates, then the chain id.
pub fn braavos_deploy_params(network: NetworkId, implementation: Felt) -> Vec<Felt> {
    let mut params = vec![implementation];
    params.extend([Felt::ZERO; 9]);
    params.push(network.chain().as_felt());
    params
}

/// The hash the deployment parameters are signed over: `poseidon(params)`.
pub fn braavos_params_hash(params: &[Felt]) -> Felt {
    Poseidon::hash_array(params)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deploy_hash_composition_is_krustys_at_version_3() {
        let bound = |amount: u128, price: u128| Bound {
            max_amount: amount,
            max_price_per_unit: price,
        };
        let deployment = Deployment {
            class_hash: Felt::from(0xc1a55u32),
            salt: Felt::from(0x5a17u32),
            constructor_calldata: vec![Felt::from(7u8), Felt::from(9u8)],
        };
        let address = Felt::from(0xaddu32);
        for bounds in [
            Bounds {
                l1_gas: bound(0, 0),
                l2_gas: bound(0, 0),
                l1_data_gas: bound(0, 0),
            },
            Bounds {
                l1_gas: bound(1, u128::MAX),
                l2_gas: bound(u128::from(u64::MAX), 0xb2d05e00),
                l1_data_gas: bound(0x1e0, 0x5a0),
            },
        ] {
            for network in [NetworkId::Mainnet, NetworkId::Sepolia] {
                // A non-zero nonce pins its position (nonce and DA mode are both zero above).
                let nonce = Felt::from(0x2au8);
                let (l1, l2, data) = krusty_bounds(&bounds).unwrap();
                assert_eq!(
                    deploy_hash_at(
                        Felt::from(3u8),
                        network,
                        &address,
                        &deployment,
                        &nonce,
                        &bounds
                    ),
                    compute_deploy_account_v3_hash(
                        &address,
                        &deployment.class_hash,
                        &deployment.constructor_calldata,
                        &deployment.salt,
                        &network.chain().as_felt(),
                        &nonce,
                        0,
                        &l1,
                        &l2,
                        &data,
                        &[],
                        DaMode::L1,
                        DaMode::L1,
                    )
                );
                assert_eq!(
                    deploy_hash_at(
                        Felt::from(3u8),
                        network,
                        &address,
                        &deployment,
                        &Felt::ZERO,
                        &bounds
                    ),
                    deploy_hash(network, &address, &deployment, &bounds).unwrap()
                );
            }
        }
    }

    #[test]
    fn deploy_query_hash_is_the_version_3_hash_with_the_query_bit() {
        let deployment = Deployment {
            class_hash: Felt::from(0xc1a55u32),
            salt: Felt::from(0x5a17u32),
            constructor_calldata: vec![Felt::from(7u8)],
        };
        let address = Felt::from(0xaddu32);
        let zero = Bound {
            max_amount: 0,
            max_price_per_unit: 0,
        };
        let bounds = Bounds {
            l1_gas: zero,
            l2_gas: zero,
            l1_data_gas: zero,
        };
        for network in [NetworkId::Mainnet, NetworkId::Sepolia] {
            for nonce in [Felt::ZERO, Felt::from(0x2au8)] {
                let query = deploy_query_hash(network, &address, &deployment, &nonce);
                assert_eq!(
                    query,
                    deploy_hash_at(
                        QUERY_VERSION_3,
                        network,
                        &address,
                        &deployment,
                        &nonce,
                        &bounds
                    )
                );
                // Dropping the query bit would sign a broadcastable v3 hash at review.
                assert_ne!(
                    query,
                    deploy_hash_at(
                        Felt::from(3u8),
                        network,
                        &address,
                        &deployment,
                        &nonce,
                        &bounds
                    )
                );
            }
        }
    }
}
