//! SLH-DSA-SHAKE-128s (FIPS 205) account contract.
//!
//! This account stores the two-felt `PK.seed || PK.root` public key and expects the
//! 491-felt signature `R || SIG_FORS || SIG_HT`, one big-endian 16-byte element per
//! felt, matching the standard FIPS 205 SLH-DSA-SHAKE-128s parameter set.
//!
//! Verification costs about 397M L2 gas, above the 100M `__validate__` cap, so this account
//! cannot send its own transactions. It exists to be checked through `is_valid_signature`
//! inside a SNIP-36 proof, where the 1.11B execute cap applies (see `snip36`). Deploy it
//! through the Universal Deployer, not with a deploy-account transaction. Research code,
//! unaudited.

#[starknet::contract(account)]
pub mod SlhDsaShake128sAccount {
    use pqbench_slh_dsa_shake_128s::SlhDsaShake128sVerifier;
    use crate::utils::account::PqAccountComponent;

    component!(path: PqAccountComponent, storage: account, event: AccountEvent);

    #[abi(embed_v0)]
    impl AccountImpl =
        PqAccountComponent::AccountImpl<ContractState, SlhDsaShake128sVerifier>;
    #[abi(embed_v0)]
    impl DeployableImpl =
        PqAccountComponent::DeployableImpl<ContractState, SlhDsaShake128sVerifier>;
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
