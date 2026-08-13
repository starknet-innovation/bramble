/**
 * Read-only Argent multisig account operations. This module never prepares or
 * hashes a transaction: the platform owns those Starknet details. It only
 * validates calls and reads the pinned account's current authority snapshot.
 */
import { WalletError } from "@mc-wallet/core/errors";
import {
  ARGENT_MULTISIG_CONTRACT,
  ARGENT_MULTISIG_MAX_SIGNERS,
} from "@mc-wallet/starknet/account-contracts";
import {
  ARGENT_MULTISIG_INVOKE_LIMITS,
  type ArgentMultisigCall,
  isArgentMultisigCalls,
} from "@mc-wallet/starknet/multisig-invoke";
import { createRpcProvider, timedRpcFetch, withRpcFallback } from "@mc-wallet/starknet/provider";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
  sameFelt,
} from "@mc-wallet/wallet-model/networks";
import { hash, type RpcProvider } from "starknet";
import { parseArgentMultisigConfigChange } from "./config-change";

/**
 * Shared limits for account configuration and frozen signing intents.
 */
export const MULTISIG_LIMITS = {
  /** Maximum calls in one account execution. */
  calls: ARGENT_MULTISIG_INVOKE_LIMITS.calls,
  /** Maximum calldata felts in one call. */
  calldataFelts: ARGENT_MULTISIG_INVOKE_LIMITS.calldataFelts,
  /** Maximum calldata felts across one execution. */
  totalCalldataFelts: ARGENT_MULTISIG_INVOKE_LIMITS.totalCalldataFelts,
  /** Maximum user-facing account name length. */
  nameLength: 48,
  /** Maximum signer count enforced by Argent Multisig 0.2. */
  signers: ARGENT_MULTISIG_MAX_SIGNERS,
  /** Maximum user-facing signing-intent summary length. */
  summaryLength: 120,
  /** Maximum felts in each optional V3 transaction-data array. */
  transactionDataFelts: ARGENT_MULTISIG_INVOKE_LIMITS.transactionDataFelts,
} as const;

const MULTISIG_READ_TIMEOUT_MS = 6_000;

const multisigReadProvider = (nodeUrl: string): RpcProvider =>
  createRpcProvider(nodeUrl, { baseFetch: timedRpcFetch(MULTISIG_READ_TIMEOUT_MS) });

/**
 * Re-export the platform's canonical prepared-call shape.
 */
export type { ArgentMultisigCall } from "@mc-wallet/starknet/multisig-invoke";
/**
 * Re-export the single-sourced trust-boundary validators for prepared calls.
 */
export {
  isArgentMultisigCall,
  isArgentMultisigCalls,
} from "@mc-wallet/starknet/multisig-invoke";

const FORBIDDEN_SELF_CALL_SELECTORS = new Set(
  ["execute_after_upgrade", "perform_upgrade"].map(hash.getSelectorFromName),
);

/**
 * Re-exports strict config decoding/review helpers. Untrusted or semantically
 * invalid transitions throw before preparation and expose no key material.
 */
export {
  type ArgentMultisigConfigChange,
  type ArgentMultisigConfigReview,
  type ArgentMultisigPublicConfig,
  nextArgentMultisigPublicConfig,
  parseArgentMultisigConfigChange,
  reviewArgentMultisigConfigChange,
} from "./config-change";

/**
 * Mirrors stable Argent Multisig 0.2's call-set restriction before review:
 * multi-call transactions may not contain a self-call, and its two internal
 * upgrade callbacks may never be invoked directly. Throws on violation so a
 * forbidden call cannot be presented as an ordinary signing intent.
 */
export const requireSafeArgentMultisigCalls = (
  accountAddress: string,
  calls: readonly ArgentMultisigCall[],
): void => {
  if (!isArgentMultisigCalls(calls)) {
    throw new WalletError("Invalid Argent multisig calls");
  }
  const selfCalls = calls.filter((call) => sameFelt(call.contractAddress, accountAddress));
  if (calls.length > 1 && selfCalls.length > 0) {
    throw new WalletError("Argent multisig batches cannot contain account self-calls");
  }
  const call = selfCalls[0];
  if (call) {
    if (FORBIDDEN_SELF_CALL_SELECTORS.has(hash.getSelectorFromName(call.entrypoint))) {
      throw new WalletError("Argent multisig internal upgrade callbacks cannot be called directly");
    }
    parseArgentMultisigConfigChange(accountAddress, call);
  }
};

/**
 * Fresh authority snapshot read from a pinned Argent Multisig 0.2 account.
 */
export type ArgentMultisigConfig = {
  readonly classHash: string;
  readonly signerGuids: readonly string[];
  readonly threshold: number;
};

/**
 * Inputs for reading one Argent multisig account's authority configuration.
 */
export type ArgentMultisigConfigInput = {
  readonly address: string;
  readonly makeProvider?: ((nodeUrl: string) => RpcProvider) | undefined;
  readonly rpcUrls: readonly string[];
};

/**
 * Inputs for checking one GUID against fresh on-chain signer membership.
 */
export type ArgentSignerMembershipInput = ArgentMultisigConfigInput & {
  readonly signerGuid: string;
};

const requireAddress = (value: string): string => {
  const canonical = canonicalFelt(value);
  if (canonical === null || !isNonZeroStarkFieldElement(canonical)) {
    throw new WalletError("Invalid Argent multisig address");
  }
  return canonical;
};

const requireGuid = (value: string): string => {
  const canonical = canonicalFelt(value);
  if (canonical === null || !isNonZeroStarkFieldElement(canonical)) {
    throw new WalletError("Invalid Argent signer GUID");
  }
  return canonical;
};

const feltAt = (response: readonly string[], index: number, label: string): string => {
  const value = response[index];
  if (typeof value !== "string" || !isStarkFieldElement(value)) {
    throw new WalletError(`Invalid Argent multisig ${label} response`);
  }
  return canonicalFelt(value) ?? value;
};

const boundedNumberAt = (response: readonly string[], index: number, label: string): number => {
  const value = Number(BigInt(feltAt(response, index, label)));
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new WalletError(`Invalid Argent multisig ${label} response`);
  }
  return value;
};

const actionableReadError = (error: unknown): never => {
  if (error instanceof Error && /abort|timeout/i.test(`${error.name} ${error.message}`)) {
    throw new WalletError(
      "Argent multisig verification took too long. Check the RPC endpoint and retry.",
    );
  }
  throw error;
};

const latestAcceptedBlockHash = async (provider: RpcProvider): Promise<string> => {
  const latest = await provider.getBlockLatestAccepted();
  const blockHash = canonicalFelt(latest.block_hash);
  if (blockHash === null || !isNonZeroStarkFieldElement(blockHash)) {
    throw new WalletError("Invalid Argent multisig accepted block response");
  }
  return blockHash;
};

/**
 * Reads class hash, threshold, and ordered signer GUIDs. Any non-pinned class,
 * malformed response, duplicate GUID, or transport exhaustion fails closed.
 */
export const getArgentMultisigConfig = async ({
  address,
  makeProvider,
  rpcUrls,
}: ArgentMultisigConfigInput): Promise<ArgentMultisigConfig> => {
  const account = requireAddress(address);
  try {
    return await withRpcFallback(
      rpcUrls,
      async (provider) => {
        const blockHash = await latestAcceptedBlockHash(provider);
        const classHash = await provider.getClassHashAt(account, blockHash);
        if (
          typeof classHash !== "string" ||
          !isStarkFieldElement(classHash) ||
          !sameFelt(classHash, ARGENT_MULTISIG_CONTRACT.classHash)
        ) {
          throw new WalletError("Account is not the pinned Argent Multisig 0.2 class");
        }
        const [thresholdResponse, signersResponse] = await Promise.all([
          provider.callContract(
            { calldata: [], contractAddress: account, entrypoint: "get_threshold" },
            blockHash,
          ),
          provider.callContract(
            { calldata: [], contractAddress: account, entrypoint: "get_signer_guids" },
            blockHash,
          ),
        ]);
        if (thresholdResponse.length !== 1) {
          throw new WalletError("Invalid Argent multisig threshold response");
        }
        const threshold = boundedNumberAt(thresholdResponse, 0, "threshold");
        const count = boundedNumberAt(signersResponse, 0, "signers");
        if (
          count === 0 ||
          count > MULTISIG_LIMITS.signers ||
          threshold === 0 ||
          threshold > count ||
          signersResponse.length !== count + 1
        ) {
          throw new WalletError("Invalid Argent multisig signers response");
        }
        const signerGuids = Array.from({ length: count }, (_, index) =>
          feltAt(signersResponse, index + 1, "signers"),
        );
        if (
          signerGuids.some((guid) => !isNonZeroStarkFieldElement(guid)) ||
          new Set(signerGuids).size !== signerGuids.length
        ) {
          throw new WalletError("Invalid Argent multisig signers response");
        }
        signerGuids.sort((left, right) =>
          BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0,
        );
        return {
          classHash: ARGENT_MULTISIG_CONTRACT.classHash,
          signerGuids,
          threshold,
        };
      },
      makeProvider ?? multisigReadProvider,
    );
  } catch (error) {
    return actionableReadError(error);
  }
};

/**
 * Reads membership for one signer GUID from the pinned account. This is a
 * freshness check for authorization, never a substitute for signature verification.
 */
export const isArgentMultisigSignerGuid = async ({
  address,
  makeProvider,
  rpcUrls,
  signerGuid,
}: ArgentSignerMembershipInput): Promise<boolean> => {
  const account = requireAddress(address);
  const guid = requireGuid(signerGuid);
  try {
    return await withRpcFallback(
      rpcUrls,
      async (provider) => {
        const classHash = await provider.getClassHashAt(account, "latest");
        if (
          typeof classHash !== "string" ||
          !isStarkFieldElement(classHash) ||
          !sameFelt(classHash, ARGENT_MULTISIG_CONTRACT.classHash)
        ) {
          throw new WalletError("Account is not the pinned Argent Multisig 0.2 class");
        }
        const response = await provider.callContract(
          { calldata: [guid], contractAddress: account, entrypoint: "is_signer_guid" },
          "latest",
        );
        if (response.length !== 1) {
          throw new WalletError("Invalid Argent multisig signer membership response");
        }
        const member = feltAt(response, 0, "signer membership");
        if (member !== "0x0" && member !== "0x1") {
          throw new WalletError("Invalid Argent multisig signer membership response");
        }
        return member === "0x1";
      },
      makeProvider ?? multisigReadProvider,
    );
  } catch (error) {
    return actionableReadError(error);
  }
};
