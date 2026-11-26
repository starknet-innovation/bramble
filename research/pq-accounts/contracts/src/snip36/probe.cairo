//! Sender of the virtual transaction that a SNIP-36 proof covers.
//!
//! Mirrors the STRK20 privacy pool's account surface: `__validate__` accepts only protocol
//! calls with zero fees and tip (proving is client-side and charges nothing), and
//! `__execute__` authenticates the user through their account's `is_valid_signature` over
//! this transaction's hash. The signature check therefore runs in the execute phase, under
//! the 1.11B L2-gas execute cap rather than the 100M validate cap. On success it sends one
//! message, `[user, poseidon(payload)]`, which the proof facts commit to.
//!
//! Anyone can send transactions from this contract; it holds nothing, and on a real network
//! a transaction from it cannot pay fees. It is only meant to be proven, never sent.

#[starknet::interface]
pub trait IPqAuthProbe<TState> {
    /// Entry the virtual transaction calls (through `__execute__`) with the user and payload.
    fn authorize(ref self: TState, user: starknet::ContractAddress, payload: Span<felt252>);
}

#[starknet::contract(account)]
pub mod PqAuthProbe {
    use core::num::traits::Zero;
    use starknet::account::Call;
    use starknet::syscalls::send_message_to_l1_syscall;
    use starknet::{ContractAddress, SyscallResultTrait, get_contract_address, get_tx_info};
    use crate::snip36::proof_facts::message_payload;
    use crate::utils::execution::assert_protocol_caller;
    use crate::utils::interface::{IPqAccountDispatcher, IPqAccountDispatcherTrait};

    #[storage]
    struct Storage {}

    #[abi(per_item)]
    #[generate_trait]
    impl AccountEntrypoints of AccountEntrypointsTrait {
        /// Accepts protocol calls with zero tip and zero prices, like the privacy pool.
        #[external(v0)]
        fn __validate__(self: @ContractState, calls: Array<Call>) -> felt252 {
            let _ = calls;
            assert_protocol_caller();
            let tx_info = get_tx_info().unbox();
            assert(tx_info.tip.is_zero(), 'NON_ZERO_TIP');
            for bounds in tx_info.resource_bounds {
                assert((*bounds.max_price_per_unit).is_zero(), 'NON_ZERO_RESOURCE_PRICE');
            }
            starknet::VALIDATED
        }

        /// Runs exactly one `authorize` call on this contract.
        #[external(v0)]
        fn __execute__(ref self: ContractState, calls: Array<Call>) {
            assert_protocol_caller();
            assert(calls.len() == 1, 'ONE_CALL_ONLY');
            let call = calls.at(0);
            assert(*call.to == get_contract_address(), 'CALL_SELF_ONLY');
            assert(*call.selector == selector!("authorize"), 'AUTHORIZE_ONLY');
            let mut calldata = *call.calldata;
            let user: ContractAddress = Serde::deserialize(ref calldata).expect('BAD_USER');
            let payload: Span<felt252> = Serde::deserialize(ref calldata).expect('BAD_PAYLOAD');
            assert(calldata.is_empty(), 'TRAILING_CALLDATA');
            authorize_and_send(user, payload);
        }
    }

    #[abi(embed_v0)]
    impl ProbeImpl of super::IPqAuthProbe<ContractState> {
        /// Only reachable from `__execute__`: rejects any other caller.
        fn authorize(ref self: ContractState, user: ContractAddress, payload: Span<felt252>) {
            assert_protocol_caller();
            authorize_and_send(user, payload);
        }
    }

    /// Asks `user` to approve this transaction's hash with this transaction's signature, then
    /// sends the message the consumer will look for in the proof facts.
    fn authorize_and_send(user: ContractAddress, payload: Span<felt252>) {
        let tx_info = get_tx_info().unbox();
        let verdict = IPqAccountDispatcher { contract_address: user }
            .is_valid_signature(tx_info.transaction_hash, tx_info.signature.into());
        assert(verdict == starknet::VALIDATED, 'INVALID_SIGNATURE');
        send_message_to_l1_syscall(Zero::zero(), message_payload(user, payload).span())
            .unwrap_syscall();
    }
}
