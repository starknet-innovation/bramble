/** Public account-recovery coordinates and bounded discovery results. */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { canonicalFelt, isNonZeroStarkFieldElement, sameFelt } from "../networks/networks";
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
 * The hardened account index strkd reserves for its agent accounts: `"AGNT"`
 * in ASCII (#336). strkd derives from the same phrase on the same
 * `accountIndex` axis, and keeps accounts that AI agents may drive under a
 * permission grant on this branch so they never appear in a mainstream
 * wallet. Bramble never derives, scans, restores, or creates an account here.
 */
export const RESERVED_AGENT_ACCOUNT_INDEX = 0x41474e54;

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
 *
 * `address` is set only for an account found by its address (issue 398): one
 * whose address no derivation reproduces (a guardian, another salt, a rotated
 * key), matched instead by its on-chain owner key. The coordinate still says
 * which key signs; the record keeps this address. The background re-reads the
 * owner and refuses the restore unless that key still controls it.
 */
export type RecoveryAccountSelection = {
  readonly accountContractType: AccountContractType;
  readonly accountIndex: number;
  readonly address?: string;
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

/**
 * Why a detected account can be watched but not signed for from this wallet
 * (issue 542): a guardian is a second approver the phrase cannot supply, a
 * changed owner means the phrase no longer holds the key, an unsupported owner
 * type signs in a way this wallet cannot produce, an unauthorizable live
 * release expects an encoding it does not emit, and a strong signer (Braavos
 * 2FA/3FA) demands a device approval beside the key.
 */
export type RecoverySigningRestriction =
  | "guardian"
  | "owner-changed"
  | "owner-type"
  | "release"
  | "strong-signer";

const SIGNING_RESTRICTIONS: readonly RecoverySigningRestriction[] = [
  "guardian",
  "owner-changed",
  "owner-type",
  "release",
  "strong-signer",
];

/**
 * One derived account and the chain evidence that made it discoverable.
 * `restriction` is the scan's advisory signability verdict for a deployed
 * Argent candidate; absent means none found or the probe did not answer — the
 * transaction path re-checks authoritatively either way. `byAddress` marks an
 * account found by its pasted address (issue 398): its address is the one the
 * chain reported, not the one its coordinate derives, so a pick of it must
 * carry that address.
 */
export type RecoveryAccountCandidate = {
  readonly account: RecoverableAccountRef;
  readonly byAddress?: true;
  readonly deployed: boolean;
  readonly funded: boolean;
  readonly restriction?: RecoverySigningRestriction;
};

/**
 * True for a valid hardened BIP-44 account index this wallet may use. The
 * strkd agent index ({@link RESERVED_AGENT_ACCOUNT_INDEX}) is refused, so a
 * manual index, a restore selection, or a creation request can never land on
 * it.
 */
export const isRecoveryAccountIndex = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= RECOVERY_SCAN_LIMITS.maxIndex &&
  value !== RESERVED_AGENT_ACCOUNT_INDEX;

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
  hasOnlyKnownKeys(value, [
    "accountContractType",
    "accountIndex",
    "address",
    "classHash",
    "derivation",
  ]) &&
  isAccountContractType(value["accountContractType"]) &&
  isSelectableAddress(value["accountContractType"], value["address"]) &&
  isRecoveryAccountIndex(value["accountIndex"]) &&
  hasSelectableClass(value["accountContractType"], value["classHash"]) &&
  hasSelectableDerivation(value["accountContractType"], value["derivation"]);

// An address found by owner match is canonical and names an Argent or Braavos
// account: the families whose owner key the import-by-address reader matches.
const isSelectableAddress = (accountContractType: AccountContractType, address: unknown): boolean =>
  address === undefined ||
  (accountContractType !== "openzeppelin" &&
    typeof address === "string" &&
    isNonZeroStarkFieldElement(address) &&
    canonicalFelt(address) === address);

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
    // An address found by owner match is its own account: the same coordinate
    // also derives a counterfactual address the scan may list beside it.
    ...(selection.address === undefined ? [] : [selection.address]),
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

/**
 * Why the active account cannot sign on the wallet's own surfaces (issue 54x):
 * one of the per-account signing restrictions; "braavos", a Braavos account
 * this wallet cannot authorize for at all; or "undeployed", a Braavos
 * counterfactual that must be deployed through its own reviewed step before
 * it can send anything.
 */
export type ReadOnlyReason = RecoverySigningRestriction | "braavos" | "undeployed";

/** Validates a read-only reason at runtime boundaries. */
export const isReadOnlyReason = (value: unknown): value is ReadOnlyReason =>
  value === "braavos" ||
  value === "undeployed" ||
  SIGNING_RESTRICTIONS.includes(value as RecoverySigningRestriction);

/** Validates one public discovery result before caching or rendering it. */
export const isRecoveryAccountCandidate = (value: unknown): value is RecoveryAccountCandidate =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["account", "byAddress", "deployed", "funded", "restriction"]) &&
  isRecoverableAccountRef(value["account"]) &&
  (value["byAddress"] === undefined || value["byAddress"] === true) &&
  typeof value["deployed"] === "boolean" &&
  typeof value["funded"] === "boolean" &&
  (value["restriction"] === undefined ||
    SIGNING_RESTRICTIONS.includes(value["restriction"] as RecoverySigningRestriction));

/**
 * Why an account pasted by its address (issue 398) cannot be imported, one per
 * reason the user acts on differently. The background answers with these and
 * the panel translates each; single-sourced so the two cannot drift.
 */
export const ADDRESS_IMPORT_REFUSALS = {
  // Bramble's own OpenZeppelin account, which "Find my accounts" recovers.
  brambleAccount: "account is a bramble account",
  invalid: "invalid account address to import",
  noMatch: "recovery phrase does not control this account",
  nonStarkOwner: "account signer not supported for import",
  notDeployed: "no account at this address on this network",
  // The wallet's own vault or session changed between the check and the write.
  stale: "wallet changed during the account check",
  unavailable: "account lookup unavailable",
  // The two SNF-operated sources answered differently about the account.
  unconfirmed: "account lookup sources disagree",
  unsupportedClass: "account class not supported for import",
} as const;
