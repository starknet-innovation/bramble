//! SLH-DSA-BLAKE2s-128s account contract.
//!
//! This account stores the two-felt `PK.seed || PK.root` public key and expects the
//! 491-felt signature `R || SIG_FORS || SIG_HT`, one little-endian 16-byte element per
//! felt. The scheme is a NON-STANDARD instantiation of FIPS 205's 128s parameter set with
//! BLAKE2s in place of SHAKE, so the off-chain signer must use the matching construction.
//! It is an unaudited spike.

#[starknet::contract(account)]
pub mod SlhDsaBlake2s128sAccount {
    use pqbench_slh_dsa_blake2s_128s::SlhDsaBlake2s128sVerifier;
    use crate::utils::account::PqAccountComponent;

    component!(path: PqAccountComponent, storage: account, event: AccountEvent);

    #[abi(embed_v0)]
    impl AccountImpl =
        PqAccountComponent::AccountImpl<ContractState, SlhDsaBlake2s128sVerifier>;
    #[abi(embed_v0)]
    impl DeployableImpl =
        PqAccountComponent::DeployableImpl<ContractState, SlhDsaBlake2s128sVerifier>;
    #[abi(embed_v0)]
    impl PublicKeyImpl = PqAccountComponent::PublicKeyImpl<ContractState>;

    impl InternalImpl = PqAccountComponent::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        account: PqAccountComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        #[flat]
        AccountEvent: PqAccountComponent::Event,
    }

    /// Initializes the account with the two-felt SLH-DSA public key used for validation.
    #[constructor]
    fn constructor(ref self: ContractState, public_key: Array<felt252>) {
        self.account.initializer(public_key);
    }
}
