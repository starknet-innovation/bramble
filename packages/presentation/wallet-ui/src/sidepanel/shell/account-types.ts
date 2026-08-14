/**
 * Registry mapping known account class hashes to human-readable type labels.
 * Purely presentational: it never gates signing, deployment, or verification —
 * an unknown class is a normal case and returns null so callers show the raw
 * hash unchanged.
 */

import {
  ARGENT_ACCOUNT_CONTRACT,
  ARGENT_MULTISIG_CONTRACT,
} from "@mc-wallet/starknet/account-contracts";
import { canonicalFelt } from "@mc-wallet/wallet-model/networks";

/**
 * OpenZeppelin `AccountUpgradeable` preset class hash pinned by Krusty KMS
 * (identical on Mainnet and Sepolia). Source of truth: the vendored Krusty KMS
 * manifest documented in README "Account class".
 */
const OZ_ACCOUNT_UPGRADEABLE_CLASS_HASH =
  "0x01d1777db36cdd06dd62cfde77b1b6ae06412af95d57a13dc40ac77b8a702381";

/**
 * Normalises a felt-encoded hash to its canonical `0x` hex form so hashes that
 * differ only in leading-zero padding or letter case compare equal, matching
 * how felts are compared elsewhere (see `sameFelt` in `verify.ts`). Returns
 * null when the value is not a parseable felt.
 */
const buildRegistry = (): ReadonlyMap<string, string> => {
  const entries: readonly (readonly [string, string])[] = [
    [OZ_ACCOUNT_UPGRADEABLE_CLASS_HASH, "OpenZeppelin (AccountUpgradeable)"],
    [ARGENT_ACCOUNT_CONTRACT.classHash, "Argent Account"],
    [ARGENT_MULTISIG_CONTRACT.classHash, "Argent Multisig"],
  ];
  const registry = new Map<string, string>();
  for (const [hash, label] of entries) {
    const key = canonicalFelt(hash);
    if (key !== null) {
      registry.set(key, label);
    }
  }
  return registry;
};

const KNOWN_ACCOUNT_TYPES = buildRegistry();

/**
 * Returns a friendly account-type label for a known class hash, or null for an
 * unknown or unparseable hash. Comparison is felt-based, so differently padded
 * or cased forms of the same hash resolve to the same label. Presentational
 * only — callers must still render the raw class hash regardless of the result.
 */
export const knownAccountType = (classHash: string): string | null => {
  const key = canonicalFelt(classHash);
  return key === null ? null : (KNOWN_ACCOUNT_TYPES.get(key) ?? null);
};
