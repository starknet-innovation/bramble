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
import {
  type AccountContractType,
  OPENZEPPELIN_ACCOUNT_CLASS_HASH,
} from "@mc-wallet/wallet-model/accounts";
import { canonicalFelt } from "@mc-wallet/wallet-model/networks";

/**
 * Normalises a felt-encoded hash to its canonical `0x` hex form so hashes that
 * differ only in leading-zero padding or letter case compare equal, matching
 * how felts are compared elsewhere (see `sameFelt` in `verify.ts`). Returns
 * null when the value is not a parseable felt.
 */
const buildRegistry = (): ReadonlyMap<string, string> => {
  const entries: readonly (readonly [string, string])[] = [
    [OPENZEPPELIN_ACCOUNT_CLASS_HASH, "OpenZeppelin (AccountUpgradeable)"],
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

// A full record, so a family added to AccountContractType fails to compile until
// it is given a name rather than falling into an "everything else" branch.
const ACCOUNT_CONTRACT_LABELS: Record<AccountContractType, string> = {
  argent: "Argent",
  "ml-dsa": "Post-quantum",
  openzeppelin: "OpenZeppelin",
};

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

/**
 * Human-readable name for an account's contract family. Single source for the
 * label, because six sites had grown the same `=== "argent" ? … : …` ternary and
 * a family added later would have been shown to the user under the wrong name by
 * every one of them. Presentational only: it never gates signing or deployment.
 */
export const accountContractLabel = (accountContractType: AccountContractType): string =>
  ACCOUNT_CONTRACT_LABELS[accountContractType];
