//! On-chain consumer of SNIP-36 proofs made with `PqAuthProbe`.
//!
//! `apply` succeeds only in a transaction whose proof facts (already verified by the
//! sequencer: proof, virtual OS program hash, base block hash, config hash) prove exactly one
//! message: the probe's approval of `user` and `payload`. Mirrors the privacy pool's
//! `validate_proof`. Each payload can be applied once; callers include a nonce in it.

#[starknet::interface]
pub trait IPqAuthConsumer<TState> {
    /// Records `payload` as approved by `user`, if this transaction's proof says so.
    fn apply(ref self: TState, user: starknet::ContractAddress, payload: Span<felt252>);
    /// How many payloads `user` has had applied.
    fn applied_count(self: @TState, user: starknet::ContractAddress) -> u64;
    /// Whether a payload (by Poseidon hash) has been applied.
    fn is_applied(self: @TState, payload_hash: felt252) -> bool;
}

#[starknet::contract]
pub mod PqAuthConsumer {
    use core::poseidon::poseidon_hash_span;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::syscalls::get_execution_info_v3_syscall;
    use starknet::{ContractAddress, SyscallResultTrait};
    use crate::snip36::proof_facts::{
        ProofFacts, VIRTUAL_SNOS, VIRTUAL_SNOS0, message_hash, message_payload,
    };

    #[storage]
    struct Storage {
        probe: ContractAddress,
        validity_blocks: u64,
        applied: Map<felt252, bool>,
        count: Map<ContractAddress, u64>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Applied: Applied,
    }

    /// A payload approved by `user` inside a proof based on `base_block_number`.
    #[derive(Drop, starknet::Event)]
    pub struct Applied {
        #[key]
        pub user: ContractAddress,
        pub payload_hash: felt252,
        pub base_block_number: u64,
    }

    /// `probe` is the only message sender accepted; proofs expire `validity_blocks` after their
    /// base block.
    #[constructor]
    fn constructor(ref self: ContractState, probe: ContractAddress, validity_blocks: u64) {
        self.probe.write(probe);
        self.validity_blocks.write(validity_blocks);
    }

    #[abi(embed_v0)]
    impl ConsumerImpl of super::IPqAuthConsumer<ContractState> {
        fn apply(ref self: ContractState, user: ContractAddress, payload: Span<felt252>) {
            let info = get_execution_info_v3_syscall().unwrap_syscall().unbox();
            let mut facts_span = info.tx_info.unbox().proof_facts;
            assert(!facts_span.is_empty(), 'EMPTY_PROOF_FACTS');
            let facts: ProofFacts = Serde::deserialize(ref facts_span).expect('BAD_PROOF_FACTS');
            assert(facts_span.is_empty(), 'TRAILING_PROOF_FACTS');
            assert(facts.program_variant == VIRTUAL_SNOS, 'NOT_VIRTUAL_SNOS');
            assert(facts.starknet_os_output_version == VIRTUAL_SNOS0, 'BAD_OS_OUTPUT_VERSION');

            let current = info.block_info.unbox().block_number;
            assert(facts.base_block_number < current, 'BASE_BLOCK_NOT_PAST');
            assert(current <= facts.base_block_number + self.validity_blocks.read(), 'PROOF_EXPIRED');

            let expected = message_hash(self.probe.read(), message_payload(user, payload).span());
            assert(facts.message_to_l1_hashes == array![expected].span(), 'PROOF_MESSAGE_MISMATCH');

            let payload_hash = poseidon_hash_span(payload);
            assert(!self.applied.read(payload_hash), 'ALREADY_APPLIED');
            self.applied.write(payload_hash, true);
            self.count.write(user, self.count.read(user) + 1);
            self.emit(Applied { user, payload_hash, base_block_number: facts.base_block_number });
        }

        fn applied_count(self: @ContractState, user: ContractAddress) -> u64 {
            self.count.read(user)
        }

        fn is_applied(self: @ContractState, payload_hash: felt252) -> bool {
            self.applied.read(payload_hash)
        }
    }
}
