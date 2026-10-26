/**
 * Reads who controls a deployed account, for importing it by address when its
 * address cannot be derived from the recovery phrase (issue 398): a guardian, a
 * non-default salt, or a rotated key puts the address out of reach of every
 * derivation, but the owner key can still be read and matched.
 *
 * Only classes in the account class table are read, each with its family's own
 * reader: Argent `get_owner` (and `get_owner_type` where the release has it,
 * which must report a Starknet signer), Braavos the first stark signer from
 * `get_signers`. Class and owner are read at one accepted block, from an
 * endpoint that first proves it serves the expected chain. A failed or
 * malformed read throws: the caller must not treat "unreadable" as "no match".
 * One endpoint's answer is not proof of ownership on its own; the caller
 * corroborates it against an independent source.
 */
import { WalletError } from "@bramble/core/errors";
import {
  type AccountClassEntry,
  type AccountFamily,
  accountClassEntry,
} from "@bramble/wallet-model/account-families";
import {
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
  sameFelt,
} from "@bramble/wallet-model/networks";
import type { RpcProvider } from "starknet";
import { WRONG_CHAIN_MESSAGE, withRpcFallback } from "../rpc/provider";
import { isContractNotFoundError } from "../rpc/rpc-not-found";
import { atAcceptedBlock } from "./account-compatibility";
import { readBraavosStarkSigners } from "./braavos-compatibility";

/**
 * What the chain says controls an address. `owner` carries the live class and
 * the stark public key a phrase key must equal; the other kinds are refusals.
 */
export type AccountOwnerReading =
  | { readonly kind: "not-deployed" }
  | { readonly kind: "unsupported-class" }
  | { readonly family: AccountFamily; readonly kind: "non-stark-owner" }
  | {
      readonly classHash: string;
      readonly family: AccountFamily;
      readonly kind: "owner";
      readonly ownerPublicKey: string;
    };

/** Input for {@link getAccountOwner}: the address, endpoints, and the chain they must serve. */
export type AccountOwnerInput = {
  readonly accountAddress: string;
  readonly chainId: string;
  readonly rpcUrls: readonly string[];
};

const ownerKey = (result: readonly string[]): string => {
  const [key] = result;
  if (result.length !== 1 || key === undefined || !isNonZeroStarkFieldElement(key)) {
    throw new WalletError("Account returned a malformed owner key");
  }
  return key;
};

// Whether a release's owner is a Starknet signer. Argent 0.3.x predates signer
// types: its owner is always a stark key, and it has no `get_owner_type` to
// ask. Every later release must say Starknet (0). A malformed answer is
// unreadable, not a verdict: only a well-formed nonzero type says another kind
// of signer controls the account.
const argentOwnerIsStark = async (
  read: (entrypoint: string) => Promise<readonly string[]>,
  entry: AccountClassEntry,
): Promise<boolean> => {
  if (entry.authorizationShape !== "argent-signer-array") return true;
  const ownerType = await read("get_owner_type");
  const [type] = ownerType;
  if (ownerType.length !== 1 || type === undefined || !isStarkFieldElement(type)) {
    throw new WalletError("Account returned a malformed owner type");
  }
  return sameFelt(type, "0x0");
};

// The deployed class at `address`, or null when nothing is deployed there.
const liveClassAt = async (
  provider: RpcProvider,
  address: string,
  blockIdentifier: string,
): Promise<string | null> => {
  try {
    const classHash = await provider.getClassHashAt(address, blockIdentifier);
    return sameFelt(classHash, "0x0") ? null : classHash;
  } catch (error) {
    if (isContractNotFoundError(error)) return null;
    throw error;
  }
};

const readOwnerAt = async (
  provider: RpcProvider,
  address: string,
  blockIdentifier: string,
): Promise<AccountOwnerReading> => {
  const classHash = await liveClassAt(provider, address, blockIdentifier);
  if (classHash === null) return { kind: "not-deployed" };
  const entry = accountClassEntry(classHash);
  if (entry === null) return { kind: "unsupported-class" };
  const read = (entrypoint: string) =>
    provider.callContract({ calldata: [], contractAddress: address, entrypoint }, blockIdentifier);
  if (entry.family === "braavos") {
    const [first] = await readBraavosStarkSigners(provider, address, blockIdentifier);
    return first === undefined
      ? { family: "braavos", kind: "non-stark-owner" }
      : { classHash, family: "braavos", kind: "owner", ownerPublicKey: ownerKey([first]) };
  }
  if (!(await argentOwnerIsStark(read, entry)))
    return { family: "argent", kind: "non-stark-owner" };
  return {
    classHash,
    family: "argent",
    kind: "owner",
    ownerPublicKey: ownerKey(await read("get_owner")),
  };
};

/**
 * Reads the class and owner key at `accountAddress` with the standard endpoint
 * fallback, pinned to one accepted block. Each endpoint must first report
 * `chainId`; one serving another chain refuses rather than answering. Throws on
 * an invalid address, a wrong chain, or when every endpoint fails or answers
 * malformed state.
 */
export const getAccountOwner = async (
  { accountAddress, chainId, rpcUrls }: AccountOwnerInput,
  makeProvider?: (nodeUrl: string) => RpcProvider,
): Promise<AccountOwnerReading> => {
  if (!isNonZeroStarkFieldElement(accountAddress)) {
    throw new WalletError("Invalid account address");
  }
  return withRpcFallback(
    rpcUrls,
    async (provider) => {
      if (!sameFelt(await provider.getChainId(), chainId)) {
        throw new WalletError(WRONG_CHAIN_MESSAGE);
      }
      return atAcceptedBlock(provider, (blockIdentifier) =>
        readOwnerAt(provider, accountAddress, blockIdentifier),
      );
    },
    makeProvider,
  );
};
