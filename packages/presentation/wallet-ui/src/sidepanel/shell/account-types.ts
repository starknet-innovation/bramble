/**
 * Registry mapping known account class hashes to human-readable type labels.
 * Purely presentational: it never gates signing, deployment, or verification —
 * an unknown class is a normal case and returns null so callers show the raw
 * hash unchanged.
 */

import {
  ARGENT_ACCOUNT_CONTRACT,
  ARGENT_MULTISIG_CONTRACT,
} from "@bramble/starknet/account-contracts";
import { deploymentClasses } from "@bramble/wallet-model/account-families";
import { OPENZEPPELIN_ACCOUNT_CLASS_HASH } from "@bramble/wallet-model/accounts";
import { canonicalFelt, sameFelt } from "@bramble/wallet-model/networks";

/**
 * Normalises a felt-encoded hash to its canonical `0x` hex form so hashes that
 * differ only in leading-zero padding or letter case compare equal, matching
 * how felts are compared elsewhere (see `sameFelt` in `verify.ts`). Returns
 * null when the value is not a parseable felt.
 */
const buildRegistry = (): ReadonlyMap<string, string> => {
  const entries: readonly (readonly [string, string])[] = [
    [OPENZEPPELIN_ACCOUNT_CLASS_HASH, "Bramble Account (OpenZeppelin AccountUpgradeable)"],
    [ARGENT_ACCOUNT_CONTRACT.classHash, "Ready Account (Argent)"],
    [ARGENT_MULTISIG_CONTRACT.classHash, "Ready Multisig (Argent)"],
    // Every other class an account can be deployed with, from the class table:
    // a restored account stores the class that fixed its address.
    ...deploymentClasses()
      .filter((entry) => !sameFelt(entry.classHash, ARGENT_ACCOUNT_CONTRACT.classHash))
      .map(
        (entry) =>
          [
            entry.classHash,
            entry.family === "argent"
              ? `Ready Account (Argent ${entry.label.replace(/^argent /, "")})`
              : "Braavos Account",
          ] as const,
      ),
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
