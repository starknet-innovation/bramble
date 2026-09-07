/**
 * Pinned-block read policy for Argent multisig chain reads.
 *
 * A multisig read must describe ONE state: a threshold from block N paired with
 * a signer set from block N+1 is a different account than either. So reads pin
 * an accepted block and ask every question at it.
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
import { isBlockNotFoundError } from "@bramble/starknet/provider";
import { canonicalFelt, isNonZeroStarkFieldElement } from "@bramble/wallet-model/networks";
import type { RpcProvider } from "starknet";

/**
 * One accepted block, used as the pin for a group of reads.
 */
export type ArgentMultisigReadBlock = {
  readonly blockHash: string;
  readonly blockNumber: number;
};

// Reads the latest accepted block, rejecting a malformed answer. Private: the
// pin is only ever taken through `withPinnedBlock`, so no caller can pin a block
// once and then read at it without the re-pinning that skew requires.
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

// Runs a read that is pinned to one accepted block, re-pinning once per attempt
// when the answering node does not know that block.
//
const PINNED_READ_ATTEMPTS = 3;

/**
 * Runs a read pinned to one accepted block, re-pinning when the answering node
 * does not know that block. Bounded; a persistent miss fails closed with the
 * node's own error rather than a wallet-invented one.
 */
export const withPinnedBlock = async <T>(
  provider: RpcProvider,
  read: (block: ArgentMultisigReadBlock) => Promise<T>,
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
