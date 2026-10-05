/** Public account-recovery coordinates and bounded discovery results. */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { canonicalFelt, sameFelt } from "../networks/networks";
import { ARGENT_ACCOUNT_CLASS_HASH, deploymentClasses } from "./account-families";
import {
  type AccountContractType,
  isAccountContractType,
  isRecoverableAccountRef,
  type RecoverableAccountRef,
  recoveryLadderIndex,
} from "./accounts";

/** Shared recovery bounds consumed by input validation, scanning, and UI. */
export const RECOVERY_SCAN_LIMITS = {
  batchSize: 4,
  defaultCount: 20,
  maxIndex: 0x7fffffff,
  // Fail-safe ceiling on how many indices one scan may cover, so an endpoint
  // that answers "deployed" to every probe cannot extend the scan forever.
  maxScannedIndexes: 200,
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
  readonly derivation?: RecoveryDerivationKind;
};

/**
 * Which key ladder a selection's index walks. Absent means the family's own
 * vendor scheme — Ready's ETH-seeded address axis for Argent (issue 505), the
 * BIP-44 address axis for Braavos, this wallet's hardened account axis for
 * OpenZeppelin — so only an Argent account created by this wallet on its own
 * ladder needs to spell `starknet-bip44` out.
 */
export type RecoveryDerivationKind = "argentx-bip44" | "starknet-bip44";

/** One derived account and the chain evidence that made it discoverable. */
export type RecoveryAccountCandidate = {
  readonly account: RecoverableAccountRef;
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
  hasOnlyKnownKeys(value, ["accountContractType", "accountIndex", "classHash", "derivation"]) &&
  isAccountContractType(value["accountContractType"]) &&
  isRecoveryAccountIndex(value["accountIndex"]) &&
  hasSelectableClass(value["accountContractType"], value["classHash"]) &&
  hasSelectableDerivation(value["accountContractType"], value["derivation"]);

// Only Argent accounts exist on two ladders (the vendor's and this wallet's
// own); every other family walks exactly one, so naming a scheme there is
// either redundant or wrong, and wrong fails closed.
const hasSelectableDerivation = (
  accountContractType: AccountContractType,
  derivation: unknown,
): boolean => {
  if (derivation === undefined) return true;
  if (derivation !== "argentx-bip44" && derivation !== "starknet-bip44") return false;
  return derivation === "starknet-bip44" || accountContractType === "argent";
};

/**
 * The identity of one recovery coordinate, used to reject duplicate selections.
 * Single-sourced so the side panel and the vault can never disagree about what
 * counts as "the same account" — including the class, canonicalized so a padded
 * and an unpadded spelling of one hash do not read as two coordinates.
 */
export const recoverySelectionKey = (selection: RecoveryAccountSelection): string =>
  [
    selection.accountContractType,
    selectionDerivation(selection),
    selectionClass(selection),
    selection.accountIndex,
  ].join(":");

/**
 * The key ladder a selection restores on, with the family default applied
 * (issue 505): Argent means Ready's scheme unless the selection names this
 * wallet's own ladder. Single-sourced so the duplicate check, the scan, and
 * the vault derivation can never disagree about what an index means.
 */
export const selectionDerivation = (selection: RecoveryAccountSelection): RecoveryDerivationKind =>
  selection.derivation ??
  (selection.accountContractType === "argent" ? "argentx-bip44" : "starknet-bip44");

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

/**
 * How many indices a scan must cover given what it has already found: at least
 * `defaultCount`, and always `defaultCount` past the highest index with
 * on-chain evidence (deployed or funded), so a ladder of real accounts keeps
 * the search going and a quiet tail of `defaultCount` indices ends it.
 * Candidates offered only as creatable defaults extend nothing. Bounded by
 * `maxScannedIndexes`; an empty list yields the floor, so there is no failure
 * path. Single-sourced here so the background's completion verdict and the
 * UI's progress denominator cannot disagree.
 */
export const recoveryScanTarget = (candidates: readonly RecoveryAccountCandidate[]): number => {
  const highestActive = candidates.reduce(
    (highest, candidate) =>
      candidate.deployed || candidate.funded
        ? Math.max(highest, recoveryLadderIndex(candidate.account))
        : highest,
    -1,
  );
  return Math.min(
    Math.max(
      RECOVERY_SCAN_LIMITS.defaultCount,
      highestActive + 1 + RECOVERY_SCAN_LIMITS.defaultCount,
    ),
    RECOVERY_SCAN_LIMITS.maxScannedIndexes,
  );
};

/** Validates one public discovery result before caching or rendering it. */
export const isRecoveryAccountCandidate = (value: unknown): value is RecoveryAccountCandidate =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["account", "deployed", "funded"]) &&
  isRecoverableAccountRef(value["account"]) &&
  typeof value["deployed"] === "boolean" &&
  typeof value["funded"] === "boolean";
