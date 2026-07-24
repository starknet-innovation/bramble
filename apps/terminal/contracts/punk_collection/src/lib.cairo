// SPDX-License-Identifier: MIT
//
// A deliberately thin, test-oriented collection built from OpenZeppelin
// Contracts for Cairo v3.0.0. ERC721 ownership, approvals, transfers, SRC5
// introspection, and receiver checks remain inside the audited components.
#[starknet::contract]
pub mod PunkCollection {
    use openzeppelin_access::ownable::OwnableComponent;
    use openzeppelin_interfaces::erc721::{
        IERC721Metadata, IERC721MetadataCamelOnly,
    };
    use openzeppelin_introspection::src5::SRC5Component;
    use openzeppelin_token::erc721::{ERC721Component, ERC721HooksEmptyImpl};
    use starknet::ContractAddress;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };

    const MAX_PUNKS: u256 = 10_000;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);
    component!(path: ERC721Component, storage: erc721, event: ERC721Event);
    component!(path: SRC5Component, storage: src5, event: SRC5Event);

    #[abi(embed_v0)]
    impl OwnableMixinImpl = OwnableComponent::OwnableMixinImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[abi(embed_v0)]
    impl ERC721Impl = ERC721Component::ERC721Impl<ContractState>;
    #[abi(embed_v0)]
    impl ERC721CamelOnlyImpl = ERC721Component::ERC721CamelOnlyImpl<ContractState>;
    impl ERC721InternalImpl = ERC721Component::InternalImpl<ContractState>;

    #[abi(embed_v0)]
    impl SRC5Impl = SRC5Component::SRC5Impl<ContractState>;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        ownable: OwnableComponent::Storage,
        #[substorage(v0)]
        erc721: ERC721Component::Storage,
        #[substorage(v0)]
        src5: SRC5Component::Storage,
        collection_name: ByteArray,
        collection_symbol: ByteArray,
        token_uris: Map<u256, ByteArray>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        #[flat]
        ERC721Event: ERC721Component::Event,
        #[flat]
        SRC5Event: SRC5Component::Event,
    }

    /// Initializes an owner-controlled ERC721 collection. Token metadata is
    /// supplied per mint so every Punk can carry a complete data URI.
    #[constructor]
    fn constructor(
        ref self: ContractState,
        name: ByteArray,
        symbol: ByteArray,
        owner: ContractAddress,
    ) {
        self.collection_name.write(name.clone());
        self.collection_symbol.write(symbol.clone());
        self.ownable.initializer(owner);
        self.erc721.initializer(name, symbol, "");
    }

    #[abi(embed_v0)]
    impl MetadataImpl of IERC721Metadata<ContractState> {
        fn name(self: @ContractState) -> ByteArray {
            self.collection_name.read()
        }

        fn symbol(self: @ContractState) -> ByteArray {
            self.collection_symbol.read()
        }

        fn token_uri(self: @ContractState, token_id: u256) -> ByteArray {
            read_token_uri(self, token_id)
        }
    }

    #[abi(embed_v0)]
    impl MetadataCamelImpl of IERC721MetadataCamelOnly<ContractState> {
        fn tokenURI(self: @ContractState, tokenId: u256) -> ByteArray {
            read_token_uri(self, tokenId)
        }
    }

    /// Mints one catalog Punk to `recipient`. Only the collection owner may
    /// mint; duplicate ids and ids outside 0..9999 revert inside this call.
    #[external(v0)]
    fn mint(
        ref self: ContractState,
        recipient: ContractAddress,
        token_id: u256,
        metadata_uri: ByteArray,
    ) {
        self.ownable.assert_only_owner();
        assert(token_id < MAX_PUNKS, 'PUNK: id outside catalog');
        assert(metadata_uri.len() != 0, 'PUNK: metadata required');
        self.token_uris.write(token_id, metadata_uri);
        self.erc721.mint(recipient, token_id);
    }

    fn read_token_uri(self: @ContractState, token_id: u256) -> ByteArray {
        let metadata_uri = self.token_uris.read(token_id);
        assert(metadata_uri.len() != 0, 'PUNK: invalid token id');
        metadata_uri
    }
}
