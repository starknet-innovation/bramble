use openzeppelin_interfaces::erc721::{
    IERC721Dispatcher, IERC721DispatcherTrait,
};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_caller_address,
    stop_cheat_caller_address,
};
use starknet::ContractAddress;

#[starknet::interface]
trait IPunkCollection<TContractState> {
    fn mint(
        ref self: TContractState,
        recipient: ContractAddress,
        token_id: u256,
        metadata_uri: ByteArray,
    );
}

fn address(value: felt252) -> ContractAddress {
    value.try_into().unwrap()
}

fn deploy_collection(owner: ContractAddress) -> ContractAddress {
    let contract = declare("PunkCollection").unwrap().contract_class();
    let mut calldata = array![];
    let name: ByteArray = "MC Punks";
    let symbol: ByteArray = "MCPUNK";
    name.serialize(ref calldata);
    symbol.serialize(ref calldata);
    owner.serialize(ref calldata);
    let (contract_address, _) = contract.deploy(@calldata).unwrap();
    contract_address
}

#[test]
fn owner_mints_and_holder_sends_between_users() {
    let owner = address(0x111);
    let alice = address(0x222);
    let bob = address(0x333);
    let contract_address = deploy_collection(owner);
    let punk = IPunkCollectionDispatcher { contract_address };
    let erc721 = IERC721Dispatcher { contract_address };

    start_cheat_caller_address(contract_address, owner);
    punk.mint(alice, 42, "data:application/json,%7B%22name%22%3A%22Punk%2042%22%7D");
    stop_cheat_caller_address(contract_address);
    assert(erc721.owner_of(42) == alice, 'mint owner mismatch');

    start_cheat_caller_address(contract_address, alice);
    erc721.transfer_from(alice, bob, 42);
    stop_cheat_caller_address(contract_address);
    assert(erc721.owner_of(42) == bob, 'transfer owner mismatch');
}

#[test]
#[should_panic]
fn non_owner_cannot_mint() {
    let owner = address(0x111);
    let alice = address(0x222);
    let contract_address = deploy_collection(owner);
    let punk = IPunkCollectionDispatcher { contract_address };

    start_cheat_caller_address(contract_address, alice);
    punk.mint(alice, 7, "data:application/json,%7B%7D");
}
