/**
 * The privacy pool's `ServerAction` ABI, exactly as the pinned official SDK
 * ships it (`vendor/starknet-privacy/sdk/src/internal/abi.ts`, which the SDK
 * does not export). Only the types needed to decode an `apply_actions` call's
 * `Span<ServerAction>` are kept, plus `apply_actions` itself. `tests/conformance/pool-server-actions-abi`
 * fails when this copy drifts from the vendored SDK.
 */
import type { Abi } from "starknet";

/** The `ServerAction` span type and every type it contains. */
export const POOL_SERVER_ACTIONS_ABI: Abi = [
  // `apply_actions` itself, verbatim; starknet.js reads the ABI's Cairo
  // version from its first function.
  {
    type: "function",
    name: "apply_actions",
    inputs: [
      { name: "actions", type: "core::array::Span::<privacy::actions::ServerAction>" },
      { name: "screening", type: "core::option::Option::<privacy::snip12::ScreeningAttestation>" },
    ],
    outputs: [],
    state_mutability: "external",
  },
  {
    type: "struct",
    name: "privacy::actions::WriteOnceInput",
    members: [
      {
        name: "storage_address",
        type: "core::felt252",
      },
      {
        name: "value",
        type: "core::array::Span::<core::felt252>",
      },
    ],
  },
  {
    type: "struct",
    name: "privacy::objects::EncChannelInfo",
    members: [
      {
        name: "ephemeral_pubkey",
        type: "core::felt252",
      },
      {
        name: "enc_channel_key",
        type: "core::felt252",
      },
      {
        name: "enc_sender_addr",
        type: "core::felt252",
      },
    ],
  },
  {
    type: "struct",
    name: "privacy::actions::AppendInput",
    members: [
      {
        name: "recipient_addr",
        type: "core::starknet::contract_address::ContractAddress",
      },
      {
        name: "enc_channel_info",
        type: "privacy::objects::EncChannelInfo",
      },
    ],
  },
  {
    type: "struct",
    name: "privacy::actions::TransferFromInput",
    members: [
      {
        name: "from_addr",
        type: "core::starknet::contract_address::ContractAddress",
      },
      {
        name: "token",
        type: "core::starknet::contract_address::ContractAddress",
      },
      {
        name: "amount",
        type: "core::integer::u128",
      },
    ],
  },
  {
    type: "struct",
    name: "privacy::actions::TransferToInput",
    members: [
      {
        name: "to_addr",
        type: "core::starknet::contract_address::ContractAddress",
      },
      {
        name: "token",
        type: "core::starknet::contract_address::ContractAddress",
      },
      {
        name: "amount",
        type: "core::integer::u128",
      },
    ],
  },
  {
    type: "struct",
    name: "privacy::objects::EncPrivateKey",
    members: [
      {
        name: "auditor_public_key",
        type: "core::felt252",
      },
      {
        name: "ephemeral_pubkey",
        type: "core::felt252",
      },
      {
        name: "enc_private_key",
        type: "core::felt252",
      },
    ],
  },
  {
    type: "struct",
    name: "privacy::events::ViewingKeySet",
    members: [
      {
        name: "user_addr",
        type: "core::starknet::contract_address::ContractAddress",
      },
      {
        name: "public_key",
        type: "core::felt252",
      },
      {
        name: "enc_private_key",
        type: "privacy::objects::EncPrivateKey",
      },
    ],
  },
  {
    type: "struct",
    name: "privacy::objects::EncUserAddr",
    members: [
      {
        name: "auditor_public_key",
        type: "core::felt252",
      },
      {
        name: "ephemeral_pubkey",
        type: "core::felt252",
      },
      {
        name: "enc_user_addr",
        type: "core::felt252",
      },
    ],
  },
  {
    type: "struct",
    name: "privacy::events::Withdrawal",
    members: [
      {
        name: "enc_user_addr",
        type: "privacy::objects::EncUserAddr",
      },
      {
        name: "to_addr",
        type: "core::starknet::contract_address::ContractAddress",
      },
      {
        name: "token",
        type: "core::starknet::contract_address::ContractAddress",
      },
      {
        name: "amount",
        type: "core::integer::u128",
      },
    ],
  },
  {
    type: "struct",
    name: "privacy::events::Deposit",
    members: [
      {
        name: "user_addr",
        type: "core::starknet::contract_address::ContractAddress",
      },
      {
        name: "token",
        type: "core::starknet::contract_address::ContractAddress",
      },
      {
        name: "amount",
        type: "core::integer::u128",
      },
    ],
  },
  {
    type: "struct",
    name: "privacy::events::OpenNoteCreated",
    members: [
      {
        name: "enc_recipient_addr",
        type: "privacy::objects::EncUserAddr",
      },
      {
        name: "token",
        type: "core::starknet::contract_address::ContractAddress",
      },
      {
        name: "note_id",
        type: "core::felt252",
      },
    ],
  },
  {
    type: "struct",
    name: "privacy::events::EncNoteCreated",
    members: [
      {
        name: "note_id",
        type: "core::felt252",
      },
      {
        name: "packed_value",
        type: "core::felt252",
      },
    ],
  },
  {
    type: "struct",
    name: "privacy::events::NoteUsed",
    members: [
      {
        name: "nullifier",
        type: "core::felt252",
      },
    ],
  },
  {
    type: "struct",
    name: "privacy::actions::InvokeInput",
    members: [
      {
        name: "contract_address",
        type: "core::starknet::contract_address::ContractAddress",
      },
      {
        name: "calldata",
        type: "core::array::Span::<core::felt252>",
      },
    ],
  },
  {
    type: "enum",
    name: "privacy::actions::ServerAction",
    variants: [
      {
        name: "WriteOnce",
        type: "privacy::actions::WriteOnceInput",
      },
      {
        name: "Append",
        type: "privacy::actions::AppendInput",
      },
      {
        name: "TransferFrom",
        type: "privacy::actions::TransferFromInput",
      },
      {
        name: "TransferTo",
        type: "privacy::actions::TransferToInput",
      },
      {
        name: "EmitViewingKeySet",
        type: "privacy::events::ViewingKeySet",
      },
      {
        name: "EmitWithdrawal",
        type: "privacy::events::Withdrawal",
      },
      {
        name: "EmitDeposit",
        type: "privacy::events::Deposit",
      },
      {
        name: "EmitOpenNoteCreated",
        type: "privacy::events::OpenNoteCreated",
      },
      {
        name: "EmitEncNoteCreated",
        type: "privacy::events::EncNoteCreated",
      },
      {
        name: "EmitNoteUsed",
        type: "privacy::events::NoteUsed",
      },
      {
        name: "Invoke",
        type: "privacy::actions::InvokeInput",
      },
      {
        name: "InvokeWithComputation",
        type: "privacy::actions::InvokeInput",
      },
    ],
  },
  {
    type: "struct",
    name: "core::array::Span::<privacy::actions::ServerAction>",
    members: [
      {
        name: "snapshot",
        type: "@core::array::Array::<privacy::actions::ServerAction>",
      },
    ],
  },
];
