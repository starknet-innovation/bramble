/**
 * Ownership calls for contracts Create deploys. Pure: this module validates
 * addresses and builds the exact `Ownable` call; `ownership-runtime.ts` reads
 * the chain, and the connected wallet signs.
 *
 * The pinned OpenZeppelin v3.0.0 presets embed the one-step `OwnableMixinImpl`:
 * - `transfer_ownership(new_owner)` makes `new_owner` the owner at once (the
 *   preset refuses the zero address), and only the owner can upgrade;
 * - `renounce_ownership()` sets the owner to zero, so nobody can ever upgrade
 *   the contract again. It cannot be undone.
 * Both revert unless the caller is the current owner.
 */
import { sameFelt } from "@bramble/wallet-model/networks";
import type { Call } from "starknet";
import { isFelt } from "../nft/punk-contract";
import { TOKEN_PRESETS, type TokenStandard } from "./token-presets";

/** The ownership change a user can ask for. */
export type OwnershipChange = { readonly kind: "transfer"; readonly newOwner: string } | { readonly kind: "renounce" };

/** A contract's ownership as read on chain, with the preset it runs. */
export type ContractOwnership = {
  readonly contract: string;
  /** The current owner, lowercase hex; `0x0` once renounced. */
  readonly owner: string;
  readonly standard: TokenStandard;
};

const fail = (message: string): never => {
  throw new Error(message);
};

/** Lowercase `0x` hex without leading zeros, so it compares and displays one way. */
const canonical = (address: string): string => `0x${BigInt(address).toString(16)}`;

/**
 * Validates a contract address typed by the user. Throws a user-facing
 * sentence unless it is a non-zero Starknet felt.
 */
export const readContractAddress = (value: string): string => {
  const address = value.trim().toLowerCase();
  if (!isFelt(address)) fail("Enter a valid Starknet contract address.");
  return canonical(address);
};

/** The pinned preset a class hash belongs to, or null for any other class. */
export const standardForClass = (classHash: string): TokenStandard | null =>
  (Object.keys(TOKEN_PRESETS) as TokenStandard[]).find((standard) =>
    sameFelt(TOKEN_PRESETS[standard].classHash, classHash),
  ) ?? null;

/** True when ownership was renounced (the owner is the zero address). */
export const isRenounced = (ownership: ContractOwnership): boolean => BigInt(ownership.owner) === 0n;

/**
 * Validates a new owner against the contract's current state. Refuses an
 * invalid or zero address, the current owner, and the contract itself (a
 * contract can't call its own `transfer_ownership`, so that would lock
 * ownership just like a renounce).
 */
export const readNewOwner = (value: string, ownership: ContractOwnership): string => {
  const address = value.trim().toLowerCase();
  if (!isFelt(address)) fail("Enter a valid Starknet address for the new owner.");
  if (sameFelt(address, ownership.owner)) fail("That account already owns this contract.");
  if (sameFelt(address, ownership.contract)) fail("The contract can't own itself.");
  return canonical(address);
};

/** The exact `Ownable` call for a change, sent to the contract itself. */
export const buildOwnershipCall = (contract: string, change: OwnershipChange): Call =>
  change.kind === "transfer"
    ? { calldata: [change.newOwner], contractAddress: contract, entrypoint: "transfer_ownership" }
    : { calldata: [], contractAddress: contract, entrypoint: "renounce_ownership" };

/** The owner the contract must report once the change has settled. */
export const expectedOwnerAfter = (change: OwnershipChange): string =>
  change.kind === "transfer" ? change.newOwner : "0x0";
