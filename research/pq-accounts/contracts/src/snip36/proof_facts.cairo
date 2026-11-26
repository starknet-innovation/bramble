//! Proof-facts layout and L2-to-L1 message hashing for SNIP-36 proofs.
//!
//! The layout and the message hash mirror the STRK20 privacy pool's `ProofFacts` and
//! `compute_message_hash`, which consume the same proofs on mainnet.

use core::poseidon::poseidon_hash_span;
use starknet::ContractAddress;

/// Program variant of proofs produced by the virtual Starknet OS.
pub const VIRTUAL_SNOS: felt252 = 'VIRTUAL_SNOS';
/// Output version of the virtual Starknet OS.
pub const VIRTUAL_SNOS0: felt252 = 'VIRTUAL_SNOS0';

/// The proof facts a SNIP-36 transaction carries, in their serialized order.
#[derive(Drop, Serde)]
pub struct ProofFacts {
    pub proof_version: felt252,
    pub program_variant: felt252,
    pub virtual_program_hash: felt252,
    pub starknet_os_output_version: felt252,
    pub base_block_number: u64,
    pub base_block_hash: felt252,
    pub starknet_os_config_hash: felt252,
    pub message_to_l1_hashes: Span<felt252>,
}

/// The payload of the probe's message: the user whose account approved, then the payload hash.
pub fn message_payload(user: ContractAddress, payload: Span<felt252>) -> Array<felt252> {
    array![user.into(), poseidon_hash_span(payload)]
}

/// Hash of the L2-to-L1 message `from` sends to address zero with `payload`, as the OS lists it
/// in the proof facts: Poseidon over `[from, to, payload_len, ...payload]`.
pub fn message_hash(from: ContractAddress, payload: Span<felt252>) -> felt252 {
    let mut data: Array<felt252> = array![from.into(), 0];
    payload.serialize(ref data);
    poseidon_hash_span(data.span())
}
