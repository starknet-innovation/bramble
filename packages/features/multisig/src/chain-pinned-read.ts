/**
 * Pinned-block read policy for Argent multisig chain reads.
 *
 * A multisig read must describe ONE state: a threshold from block N paired with
 * a signer set from block N+1 is a different account than either. So reads pin
 * an accepted block and ask every question at it. The policy itself (re-pinning
 * when a load-balanced sibling node does not know the pinned hash) is shared
 * with the other pinned readers in @bramble/starknet/pinned-block; this module
 * keeps the multisig's own error wording.
 */
import { type PinnedReadBlock, withPinnedBlock as pinned } from "@bramble/starknet/pinned-block";
import type { RpcProvider } from "starknet";

/**
 * One accepted block, used as the pin for a group of reads.
 */
export type ArgentMultisigReadBlock = PinnedReadBlock;

/**
 * Runs a read pinned to one accepted block, re-pinning when the answering node
 * does not know that block. Bounded; a persistent miss fails closed with the
 * node's own error rather than a wallet-invented one.
 */
export const withPinnedBlock = <T>(
  provider: RpcProvider,
  read: (block: ArgentMultisigReadBlock) => Promise<T>,
): Promise<T> => pinned(provider, read, "Invalid Argent multisig accepted block response");
