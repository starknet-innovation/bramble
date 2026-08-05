use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_block_number,
};
use starknet::{ContractAddress, SyscallResult};

#[starknet::interface]
trait IMultisig<TContractState> {
    fn submit_transaction(
        ref self: TContractState,
        to: ContractAddress,
        selector: felt252,
        calldata: Span<felt252>,
        salt: felt252,
    ) -> felt252;
    fn confirm_transaction(ref self: TContractState, id: felt252);
    fn execute_transaction(
        ref self: TContractState,
        to: ContractAddress,
        selector: felt252,
        calldata: Span<felt252>,
        salt: felt252,
    );
    fn is_confirmed_by(
        self: @TContractState, id: felt252, signer: ContractAddress,
    ) -> bool;
    fn is_executed(self: @TContractState, id: felt252) -> bool;
}

#[starknet::interface]
trait IAtomicExecutor<TContractState> {
    fn submit(
        self: @TContractState,
        multisig: ContractAddress,
        to: ContractAddress,
        selector: felt252,
        calldata: Span<felt252>,
        salt: felt252,
    ) -> felt252;
    fn confirm_and_execute(
        self: @TContractState,
        multisig: ContractAddress,
        id: felt252,
        to: ContractAddress,
        selector: felt252,
        calldata: Span<felt252>,
        salt: felt252,
    );
}

#[starknet::interface]
trait IEffectTarget<TContractState> {
    fn set_value(ref self: TContractState, value: felt252);
    fn fail(self: @TContractState);
    fn value(self: @TContractState) -> felt252;
}

#[starknet::contract]
mod AtomicExecutor {
    use super::{IMultisigDispatcher, IMultisigDispatcherTrait};
    use starknet::ContractAddress;

    #[storage]
    struct Storage {}

    #[abi(embed_v0)]
    impl ExternalImpl of super::IAtomicExecutor<ContractState> {
        fn submit(
            self: @ContractState,
            multisig: ContractAddress,
            to: ContractAddress,
            selector: felt252,
            calldata: Span<felt252>,
            salt: felt252,
        ) -> felt252 {
            IMultisigDispatcher { contract_address: multisig }
                .submit_transaction(to, selector, calldata, salt)
        }

        fn confirm_and_execute(
            self: @ContractState,
            multisig: ContractAddress,
            id: felt252,
            to: ContractAddress,
            selector: felt252,
            calldata: Span<felt252>,
            salt: felt252,
        ) {
            let target = IMultisigDispatcher { contract_address: multisig };
            target.confirm_transaction(id);
            target.execute_transaction(to, selector, calldata, salt);
        }
    }
}

#[starknet::contract]
mod EffectTarget {
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};

    #[storage]
    struct Storage {
        value: felt252,
    }

    #[abi(embed_v0)]
    impl ExternalImpl of super::IEffectTarget<ContractState> {
        fn set_value(ref self: ContractState, value: felt252) {
            self.value.write(value);
        }

        fn fail(self: @ContractState) {
            assert(false, 'target failure');
        }

        fn value(self: @ContractState) -> felt252 {
            self.value.read()
        }
    }
}

fn deploy(name: ByteArray, calldata: Array<felt252>) -> ContractAddress {
    let (address, _) = declare(name).unwrap().contract_class().deploy(@calldata).unwrap();
    address
}

fn setup() -> (ContractAddress, ContractAddress, ContractAddress) {
    let executor = deploy("AtomicExecutor", array![]);
    let target = deploy("EffectTarget", array![]);
    let multisig = deploy("MultisigWallet", array![1, 1, executor.into()]);
    start_cheat_block_number(multisig, 1);
    (executor, target, multisig)
}

#[test]
fn confirmation_is_visible_to_execution_in_the_same_call() {
    let (executor_address, target_address, multisig_address) = setup();
    let executor = IAtomicExecutorDispatcher { contract_address: executor_address };
    let effect = IEffectTargetDispatcher { contract_address: target_address };
    let multisig = IMultisigDispatcher { contract_address: multisig_address };
    let calldata = array![7];
    let selector = selector!("set_value");
    let id = executor.submit(multisig_address, target_address, selector, calldata.span(), 0);

    executor.confirm_and_execute(
        multisig_address, id, target_address, selector, calldata.span(), 0,
    );

    assert!(effect.value() == 7);
    assert!(multisig.is_executed(id));
}

#[test]
#[feature("safe_dispatcher")]
fn failed_execution_rolls_back_the_confirmation() {
    let (executor_address, target_address, multisig_address) = setup();
    let executor = IAtomicExecutorDispatcher { contract_address: executor_address };
    let safe_executor = IAtomicExecutorSafeDispatcher { contract_address: executor_address };
    let multisig = IMultisigDispatcher { contract_address: multisig_address };
    let selector = selector!("fail");
    let calldata = array![];
    let id = executor.submit(multisig_address, target_address, selector, calldata.span(), 0);

    let result: SyscallResult<()> = safe_executor.confirm_and_execute(
        multisig_address, id, target_address, selector, calldata.span(), 0,
    );

    assert!(result.is_err());
    assert!(!multisig.is_confirmed_by(id, executor_address));
    assert!(!multisig.is_executed(id));
}
