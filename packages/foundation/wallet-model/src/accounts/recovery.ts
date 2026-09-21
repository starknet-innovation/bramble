/** Public account-recovery coordinates and bounded discovery results. */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { canonicalFelt, sameFelt } from "../networks/networks";
import { ARGENT_ACCOUNT_CLASS_HASH, deploymentClasses } from "./account-families";
import {
  type AccountContractType,
  type DerivedAccountRef,
  isAccountContractType,
  isDerivedAccountRef,
} from "./accounts";

/** Shared recovery bounds consumed by input validation, scanning, and UI. */
export const RECOVERY_SCAN_LIMITS = {
  batchSize: 4,
  defaultCount: 20,
  maxIndex: 0x7fffffff,
  maxSelections: 40,
} as const;

/**
 * One HD coordinate selected for restoration into the encrypted vault.
 *
 * `classHash` names the release the candidate was derived at. It is part of the
 * coordinate, not a detail of it: the same key and index land at a different
 * address under each Argent release or Braavos class, so a selection without it
 * is re-derived somewhere else and restores an account the user never picked.
 * Absent means the family's own default — the release this wallet creates for
 * Argent, the per-network class for OpenZeppelin. Braavos has no default, since
 * this wallet never creates one, so a Braavos selection must name its class.
 */
export type RecoveryAccountSelection = {
  readonly accountContractType: AccountContractType;
  readonly accountIndex: number;
  readonly classHash?: string;
};

/** One derived account and the chain evidence that made it discoverable. */
export type RecoveryAccountCandidate = {
  readonly account: DerivedAccountRef;
  readonly deployed: boolean;
  readonly funded: boolean;
};

/** True for a valid hardened BIP-44 account index. */
export const isRecoveryAccountIndex = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= RECOVERY_SCAN_LIMITS.maxIndex;

// Whether a selection's class is one its family can be deployed with, given
// that OpenZeppelin carries none (resolved per network) and Braavos must name one.
const hasSelectableClass = (
  accountContractType: AccountContractType,
  classHash: unknown,
): boolean => {
  if (accountContractType === "openzeppelin") {
    return classHash === undefined;
  }
  if (classHash === undefined) {
    return accountContractType === "argent";
  }
  return (
    typeof classHash === "string" &&
    deploymentClasses(accountContractType).some((entry) => sameFelt(entry.classHash, classHash))
  );
};

/**
 * Validates one exact recovery coordinate at a runtime boundary. A class that no
 * account of the named family could have been deployed with is refused, as is a
 * Braavos selection that names no class at all.
 */
export const isRecoveryAccountSelection = (value: unknown): value is RecoveryAccountSelection =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["accountContractType", "accountIndex", "classHash"]) &&
  isAccountContractType(value["accountContractType"]) &&
  isRecoveryAccountIndex(value["accountIndex"]) &&
  hasSelectableClass(value["accountContractType"], value["classHash"]);

/**
 * The identity of one recovery coordinate, used to reject duplicate selections.
 * Single-sourced so the side panel and the vault can never disagree about what
 * counts as "the same account" — including the class, canonicalized so a padded
 * and an unpadded spelling of one hash do not read as two coordinates.
 */
export const recoverySelectionKey = (selection: RecoveryAccountSelection): string =>
  [selection.accountContractType, selectionClass(selection), selection.accountIndex].join(":");

// An absent Argent class means the release this wallet creates, so it has to key
// the same as naming that release outright; otherwise one account, selected
// both ways, passes the duplicate check twice.
const selectionClass = (selection: RecoveryAccountSelection): string => {
  if (selection.classHash !== undefined) {
    return canonicalFelt(selection.classHash) ?? "";
  }
  return selection.accountContractType === "argent"
    ? (canonicalFelt(ARGENT_ACCOUNT_CLASS_HASH) ?? "")
    : "default";
};

/** Validates one public discovery result before caching or rendering it. */
export const isRecoveryAccountCandidate = (value: unknown): value is RecoveryAccountCandidate =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["account", "deployed", "funded"]) &&
  isDerivedAccountRef(value["account"]) &&
  typeof value["deployed"] === "boolean" &&
  typeof value["funded"] === "boolean";
