/**
 * The `decode` block of the call-review fixture: one call each, through `decodeCall`
 * (`routing/verify-decode.ts`), and the payee `recipientForFlags` reads from it. Every shape the
 * decoder knows, each spelling of a selector, and calldata that misses the shape by one felt or
 * one limb.
 */
import { decodeCall, recipientForFlags } from "@bramble/transactions/verify-decode";
import type { Call } from "starknet";
import {
  ACCOUNT,
  avnuRoute,
  call,
  ETH,
  HALF_U128,
  NFT,
  ONE_AND_A_HALF,
  RECIPIENT,
  SPENDER,
  STRK,
  trackedTokens,
  U128_MAX,
  UNKNOWN,
} from "./shared";

const FROM = SPENDER;

const CASES: readonly (readonly [string, Call])[] = [
  ["an ERC-20 transfer", call(STRK, "transfer", [RECIPIENT, ONE_AND_A_HALF, 0])],
  ["a transfer of nothing", call(STRK, "transfer", [RECIPIENT, 0, 0])],
  ["a transfer above 2^128", call(ETH, "transfer", [RECIPIENT, 5, 1])],
  [
    "a padded upper-case token spelling",
    call(`0x${STRK.slice(2).toUpperCase()}`, "transfer", [RECIPIENT, ONE_AND_A_HALF, 0]),
  ],
  ["a transfer on an unknown contract", call(UNKNOWN, "transfer", [RECIPIENT, 7, 0])],
  ["a transfer one felt short", call(STRK, "transfer", [RECIPIENT, ONE_AND_A_HALF])],
  ["a transfer one felt long", call(STRK, "transfer", [RECIPIENT, ONE_AND_A_HALF, 0, 0])],
  [
    "a transfer whose low limb is not a u128",
    call(STRK, "transfer", [RECIPIENT, `${U128_MAX}0`, 0]),
  ],
  ["a transfer with no calldata", call(STRK, "transfer", [])],
  ["an approve", call(STRK, "approve", [SPENDER, ONE_AND_A_HALF, 0])],
  ["an unlimited approve", call(STRK, "approve", [SPENDER, U128_MAX, U128_MAX])],
  ["an increaseAllowance", call(STRK, "increaseAllowance", [SPENDER, ONE_AND_A_HALF, 0])],
  ["an increase_allowance", call(ETH, "increase_allowance", [SPENDER, HALF_U128, 0])],
  ["an approve on an unknown contract", call(UNKNOWN, "approve", [SPENDER, 12, 0])],
  ["an approve on a watched collection", call(NFT, "approve", [SPENDER, 12, 0])],
  ["an increase on a watched collection", call(NFT, "increase_allowance", [SPENDER, 12, 0])],
  ["an approve one felt short", call(STRK, "approve", [SPENDER, 12])],
  ["a decreaseAllowance", call(STRK, "decreaseAllowance", [SPENDER, ONE_AND_A_HALF, 0])],
  ["a decrease_allowance", call(STRK, "decrease_allowance", [SPENDER, ONE_AND_A_HALF, 0])],
  ["a setApprovalForAll", call(NFT, "setApprovalForAll", [SPENDER, 1])],
  ["a set_approval_for_all revoked", call(NFT, "set_approval_for_all", [SPENDER, 0])],
  ["an operator grant with a wide flag", call(UNKNOWN, "set_approval_for_all", [SPENDER, 2])],
  ["an operator grant one felt long", call(NFT, "set_approval_for_all", [SPENDER, 1, 0])],
  ["a token transferFrom", call(STRK, "transferFrom", [FROM, RECIPIENT, ONE_AND_A_HALF, 0])],
  ["an NFT transfer_from", call(NFT, "transfer_from", [FROM, RECIPIENT, 7, 0])],
  ["a transfer_from one felt short", call(NFT, "transfer_from", [FROM, RECIPIENT, 7])],
  ["an ERC-721 safeTransferFrom", call(NFT, "safeTransferFrom", [FROM, RECIPIENT, 7, 0, 0])],
  [
    "an ERC-721 safe transfer with data",
    call(NFT, "safe_transfer_from", [FROM, RECIPIENT, 7, 0, 2, 8, 9]),
  ],
  [
    "an ERC-1155 safe_transfer_from",
    call(NFT, "safe_transfer_from", [FROM, RECIPIENT, 7, 0, 3, 0, 0]),
  ],
  [
    "a safe transfer both shapes fit",
    call(NFT, "safe_transfer_from", [FROM, RECIPIENT, 7, 0, 2, 5, 0]),
  ],
  [
    "a safe transfer neither shape fits",
    call(NFT, "safe_transfer_from", [FROM, RECIPIENT, 7, 0, 3]),
  ],
  [
    "an ERC-1155 batch of two ids",
    call(NFT, "safeBatchTransferFrom", [FROM, RECIPIENT, 2, 1, 0, 2, 0, 2, 5, 0, 6, 0, 0]),
  ],
  [
    "an ERC-1155 batch of one id with data",
    call(NFT, "safe_batch_transfer_from", [FROM, RECIPIENT, 1, 1, 0, 1, 5, 0, 1, 9]),
  ],
  [
    "a batch whose values count differs",
    call(NFT, "safe_batch_transfer_from", [FROM, RECIPIENT, 1, 1, 0, 2, 5, 0, 6, 0, 0]),
  ],
  [
    "a batch with a trailing felt",
    call(NFT, "safe_batch_transfer_from", [FROM, RECIPIENT, 1, 1, 0, 1, 5, 0, 0, 0]),
  ],
  [
    "a batch claiming more ids than it holds",
    call(NFT, "safe_batch_transfer_from", [FROM, RECIPIENT, 9, 0]),
  ],
  [
    "an AVNU route between tracked tokens",
    call(SPENDER, "multi_route_swap", avnuRoute(STRK, ETH, ACCOUNT)),
  ],
  [
    "an AVNU route to an untracked token",
    call(SPENDER, "multi_route_swap", avnuRoute(STRK, UNKNOWN, RECIPIENT)),
  ],
  [
    "an AVNU route with a trailing felt",
    call(SPENDER, "multi_route_swap", avnuRoute(STRK, ETH, ACCOUNT, ["0x1"])),
  ],
  [
    "an AVNU route cut short",
    call(SPENDER, "multi_route_swap", avnuRoute(STRK, ETH, ACCOUNT).slice(0, 14)),
  ],
  // Argent multisig signer management is a self-call the multisig review reads; to `decodeCall`
  // it is an opaque call on the account.
  ["a multisig add_signers", call(ACCOUNT, "add_signers", [2, 1, 0, SPENDER])],
  ["a multisig remove_signers", call(ACCOUNT, "remove_signers", [1, 1, 0, SPENDER])],
  ["a multisig change_threshold", call(ACCOUNT, "change_threshold", [2])],
  ["an unknown entrypoint", call(UNKNOWN, "mint", [RECIPIENT, 1, 0])],
  ["an entrypoint named after an Object method", call(UNKNOWN, "toString", [])],
  ["an entrypoint named constructor", call(UNKNOWN, "constructor", [RECIPIENT])],
];

/** Every decode case on mainnet, with STRK and ETH tracked and `NFT` watched. */
export const computeDecodes = () => {
  const context = {
    account: { address: ACCOUNT, networkId: "SN_MAIN" as const },
    addressBook: [],
    nftContracts: [NFT],
    tokens: trackedTokens("SN_MAIN"),
  };
  return CASES.map(([name, input]) => {
    const { kind, summary } = decodeCall(input, context);
    return {
      call: input,
      decoded: { kind, summary },
      name,
      nftContracts: context.nftContracts,
      recipient: recipientForFlags(input, input.calldata as readonly unknown[]),
      tokens: context.tokens,
    };
  });
};
