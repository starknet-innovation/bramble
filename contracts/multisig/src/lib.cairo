// SPDX-License-Identifier: MIT
//
// Thin preset around OpenZeppelin's audited MultisigComponent (v3.0.0).
// OpenZeppelin ships the component without a deployable preset, so this
// contract embeds it verbatim and adds nothing beyond the constructor:
// all signer, quorum, submit, confirm, revoke, and execute logic lives in
// openzeppelin_governance::multisig::MultisigComponent. The component is
// self-administered: signer and quorum changes must pass through the
// multisig process itself.
#[starknet::contract]
pub mod MultisigWallet {
    use openzeppelin_governance::multisig::MultisigComponent;
    use starknet::ContractAddress;

    component!(path: MultisigComponent, storage: multisig, event: MultisigEvent);

    #[abi(embed_v0)]
    impl MultisigImpl = MultisigComponent::MultisigImpl<ContractState>;
    impl MultisigInternalImpl = MultisigComponent::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        multisig: MultisigComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        #[flat]
        MultisigEvent: MultisigComponent::Event,
    }

    /// Initializes the multisig with its initial `quorum` and `signers`.
    /// The component requires a non-zero quorum that does not exceed the
    /// signer count and rejects zero-address signers.
    #[constructor]
    fn constructor(ref self: ContractState, quorum: u32, signers: Span<ContractAddress>) {
        self.multisig.initializer(quorum, signers);
    }
}
