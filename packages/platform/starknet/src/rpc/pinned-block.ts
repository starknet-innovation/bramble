/**
 * Pinned-block read policy shared by every group of chain reads that must
 * describe ONE state (a multisig's threshold and signer set; a staking pool
 * and the account's membership in it).
 *
 * The pin costs something these endpoints make visible. It is a block HASH read
 * moments earlier, and the endpoints load-balance, so a follow-up request can be
 * routed to a sibling node a block behind that answers "Block not found"
 * (JSON-RPC 24) for a hash the chain certainly has — measured against the
 * wallet's own mainnet endpoint at roughly one attempt in eight, against a read
 * that issues three pinned requests. Re-pinning absorbs that skew without
 * trading away either property: each attempt re-reads the head, so an attempt is
 * still internally consistent and still current.
 */
import { WalletError } from "@bramble/core/errors";
import { canonicalFelt, isNonZeroStarkFieldElement } from "@bramble/wallet-model/networks";
import type { RpcProvider } from "starknet";
import { createRpcProvider, isBlockNotFoundError, withRpcFallback } from "./provider";

/**
 * One accepted block, used as the pin for a group of reads.
 */
export type PinnedReadBlock = {
  readonly blockHash: string;
  readonly blockNumber: number;
};

// Reads the latest accepted block, rejecting a malformed answer. Private: the
// pin is only ever taken through `withPinnedBlock`, so no caller can pin a block
// once and then read at it without the re-pinning that skew requires.
const INVALID_ACCEPTED_BLOCK = "Invalid accepted block response";

const latestAcceptedBlock = async (provider: RpcProvider): Promise<PinnedReadBlock> => {
  const latest = await provider.getBlockLatestAccepted();
  const blockHash = canonicalFelt(latest.block_hash);
  if (
    blockHash === null ||
    !isNonZeroStarkFieldElement(blockHash) ||
    !Number.isSafeInteger(latest.block_number) ||
    latest.block_number < 0
  ) {
    throw new WalletError(INVALID_ACCEPTED_BLOCK);
  }
  return { blockHash, blockNumber: latest.block_number };
};

const PINNED_READ_ATTEMPTS = 3;

/**
 * Runs a read pinned to one accepted block, re-pinning when the answering node
 * does not know that block. Bounded; a persistent miss fails closed with the
 * node's own error rather than a wallet-invented one.
 */
export const withPinnedBlock = async <T>(
  provider: RpcProvider,
  read: (block: PinnedReadBlock) => Promise<T>,
): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < PINNED_READ_ATTEMPTS; attempt += 1) {
    const block = await latestAcceptedBlock(provider);
    try {
      return await read(block);
    } catch (error) {
      if (!isBlockNotFoundError(error)) {
        throw error;
      }
      lastError = error;
    }
  }
  throw lastError;
};

/**
 * A read-only contract call answered at the pinned block.
 */
export type PinnedContractRead = (
  contractAddress: string,
  entrypoint: string,
  calldata: readonly string[],
) => Promise<readonly string[]>;

/**
 * Runs a group of contract reads at one accepted block, with endpoint failover
 * (a transport fault moves to the next endpoint and re-pins there). The answers
 * are raw felts: callers decode and validate them, since every one is an
 * untrusted RPC response. `makeProvider` is injectable for tests.
 */
export const readAtPinnedBlock = <T>(
  rpcUrls: readonly string[],
  run: (read: PinnedContractRead) => Promise<T>,
  makeProvider: (nodeUrl: string) => RpcProvider = createRpcProvider,
): Promise<T> =>
  withRpcFallback(
    rpcUrls,
    (provider) =>
      withPinnedBlock(provider, (block) =>
        run(async (contractAddress, entrypoint, calldata) => {
          const answer = await provider.callContract(
            { calldata: [...calldata], contractAddress, entrypoint },
            block.blockHash,
          );
          return [...answer];
        }),
      ),
    makeProvider,
  );
