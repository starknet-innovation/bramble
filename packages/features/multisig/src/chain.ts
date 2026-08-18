/**
 * Read-only Argent multisig account operations. This module never prepares or
 * hashes a transaction: the platform owns those Starknet details. It only
 * validates calls and reads the pinned account's current authority snapshot.
 */
import { WalletError } from "@mc-wallet/core/errors";
import {
  ARGENT_MULTISIG_CONTRACT,
  ARGENT_MULTISIG_MAX_SIGNERS,
  argentSignerGuid,
} from "@mc-wallet/starknet/account-contracts";
import {
  type ArgentMultisigCall,
  isArgentMultisigCalls,
} from "@mc-wallet/starknet/multisig-invoke";
import {
  createRpcProvider,
  isContractNotFoundError,
  timedRpcFetch,
  withRpcFallback,
} from "@mc-wallet/starknet/provider";
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
  /** Maximum user-facing account name length. */
  nameLength: 48,
  /** Maximum signer count enforced by Argent Multisig 0.2. */
  signers: ARGENT_MULTISIG_MAX_SIGNERS,
  /** Maximum user-facing signing-intent summary length. */
  summaryLength: 120,
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
  argentMultisigConfigChangeCall,
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

/**
 * Inputs for recovering current Stark signer public keys from linked events.
 */
export type ArgentSignerDiscoveryInput = ArgentMultisigConfigInput & {
  readonly signerGuids: readonly string[];
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

const latestAcceptedBlock = async (
  provider: RpcProvider,
): Promise<{ readonly blockHash: string; readonly blockNumber: number }> => {
  const latest = await provider.getBlockLatestAccepted();
  const blockHash = canonicalFelt(latest.block_hash);
  if (
    blockHash === null ||
    !isNonZeroStarkFieldElement(blockHash) ||
    !Number.isSafeInteger(latest.block_number) ||
    latest.block_number < 0
  ) {
    throw new WalletError("Invalid Argent multisig accepted block response");
  }
  return { blockHash, blockNumber: latest.block_number };
};

const firstDeploymentBlock = async (
  provider: RpcProvider,
  account: string,
  latestBlockHash: string,
  latestBlock: number,
): Promise<number> => {
  const currentClassHash = await provider.getClassHashAt(account, latestBlockHash);
  if (
    typeof currentClassHash !== "string" ||
    !isStarkFieldElement(currentClassHash) ||
    !sameFelt(currentClassHash, ARGENT_MULTISIG_CONTRACT.classHash)
  ) {
    throw new WalletError("Account is not the pinned Argent Multisig 0.2 class");
  }
  let low = 0;
  let high = latestBlock;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    try {
      const classHash = await provider.getClassHashAt(account, middle);
      if (typeof classHash !== "string" || !isStarkFieldElement(classHash)) {
        throw new WalletError("Invalid Argent multisig class response");
      }
      high = middle;
    } catch (error) {
      if (!isContractNotFoundError(error)) throw error;
      low = middle + 1;
    }
  }
  return low;
};

const linkedStarkSigner = (
  keys: readonly string[],
  data: readonly string[],
  signerGuids: readonly string[],
): readonly [guid: string, publicKey: string] | null => {
  const guid = feltAt(keys, 1, "signer event");
  if (!signerGuids.includes(guid) || feltAt(data, 0, "signer event") !== "0x0") return null;
  const publicKey = feltAt(data, 1, "signer event");
  if (!isNonZeroStarkFieldElement(publicKey) || !sameFelt(argentSignerGuid(publicKey), guid)) {
    throw new WalletError("Invalid Argent multisig signer event");
  }
  return [guid, publicKey];
};

const rememberLinkedSigner = (
  byGuid: Map<string, string>,
  signer: readonly [guid: string, publicKey: string] | null,
): void => {
  if (!signer) return;
  const [guid, publicKey] = signer;
  const existing = byGuid.get(guid);
  if (existing !== undefined && !sameFelt(existing, publicKey)) {
    throw new WalletError("Conflicting Argent multisig signer events");
  }
  byGuid.set(guid, publicKey);
};

const signerKeysFromEvents = async (
  provider: RpcProvider,
  account: string,
  signerGuids: readonly string[],
  deploymentBlock: number,
  acceptedBlockHash: string,
): Promise<readonly string[]> => {
  const byGuid = new Map<string, string>();
  let continuationToken: string | undefined;
  let pages = 0;
  do {
    const chunk = await provider.getEvents({
      address: account,
      chunk_size: 100,
      ...(continuationToken === undefined ? {} : { continuation_token: continuationToken }),
      from_block: { block_number: deploymentBlock },
      keys: [[hash.getSelectorFromName("SignerLinked")], [...signerGuids]],
      to_block: { block_hash: acceptedBlockHash },
    });
    pages += 1;
    if (pages > 256) {
      throw new WalletError("Argent multisig signer history is too large to verify");
    }
    for (const event of chunk.events) {
      rememberLinkedSigner(byGuid, linkedStarkSigner(event.keys, event.data, signerGuids));
    }
    continuationToken = chunk.continuation_token;
  } while (continuationToken !== undefined);
  return signerGuids
    .map((guid) => byGuid.get(guid))
    .filter((publicKey): publicKey is string => publicKey !== undefined);
};

/**
 * Recovers current Stark signer public keys from the pinned contract's
 * accepted `SignerLinked` history. Every recovered key is re-derived against
 * the fresh GUID input; unsupported signer types remain unresolved.
 */
export const getArgentMultisigSignerPublicKeys = async ({
  address,
  makeProvider,
  rpcUrls,
  signerGuids,
}: ArgentSignerDiscoveryInput): Promise<readonly string[]> => {
  const account = requireAddress(address);
  const guids = signerGuids.map(requireGuid);
  if (
    guids.length < 1 ||
    guids.length > MULTISIG_LIMITS.signers ||
    new Set(guids).size !== guids.length
  ) {
    throw new WalletError("Invalid Argent signer GUIDs");
  }
  try {
    return await withRpcFallback(
      rpcUrls,
      async (provider) => {
        const latest = await latestAcceptedBlock(provider);
        const deploymentBlock = await firstDeploymentBlock(
          provider,
          account,
          latest.blockHash,
          latest.blockNumber,
        );
        return signerKeysFromEvents(provider, account, guids, deploymentBlock, latest.blockHash);
      },
      makeProvider ?? multisigReadProvider,
    );
  } catch (error) {
    return actionableReadError(error);
  }
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
        const { blockHash } = await latestAcceptedBlock(provider);
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
