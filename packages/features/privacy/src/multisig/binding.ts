/**
 * Binds a co-owner's multisig STRK20 package to this wallet's own view of the
 * multisig: its id, address, chain, and the live signer set and threshold.
 * A package's own copy of those fields is what it claims, not what is true,
 * so a mismatch is refused on import and again before signing.
 */

import { sameFelt } from "@bramble/wallet-model/networks";

/** This wallet's record and the signer set read from the chain. */
export type MultisigStrk20Binding = {
  readonly accountAddress: string;
  readonly accountId: string;
  readonly chainId: string;
  readonly signerPublicKeys: readonly string[];
  readonly threshold: number;
};

/** True when both lists hold the same keys, in any order, with no repeats. */
export const sameMultisigSignerSet = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length &&
  left.every((key) => right.some((other) => sameFelt(key, other))) &&
  right.every((key) => left.some((other) => sameFelt(key, other)));

/**
 * True when a package names this multisig, its address, and its live signer
 * set and threshold. `chainId` is compared only when the package carries one;
 * a relay invite's chain is pinned by its typed-data domain instead.
 */
export const isBoundToMultisig = (
  row: {
    readonly accountAddress: string;
    readonly accountId: string;
    readonly chainId?: string;
    readonly signerPublicKeys: readonly string[];
    readonly threshold: number;
  },
  binding: MultisigStrk20Binding,
): boolean =>
  row.accountId === binding.accountId &&
  sameFelt(row.accountAddress, binding.accountAddress) &&
  (row.chainId === undefined || sameFelt(row.chainId, binding.chainId)) &&
  row.threshold === binding.threshold &&
  sameMultisigSignerSet(row.signerPublicKeys, binding.signerPublicKeys);
