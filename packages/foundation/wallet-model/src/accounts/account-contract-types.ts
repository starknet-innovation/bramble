/**
 * Account contract families, which of them this wallet may hold, create, or
 * derive on a device, and what a stored record of each must contain.
 *
 * Split from ./accounts to keep that module within the file-length standard; it
 * re-exports everything here, so callers are unaffected. This module consults
 * the class table in ./account-families, which in turn imports nothing from
 * either, so there is no cycle.
 */

import { canonicalFelt, sameFelt } from "../networks/networks";
import { ARGENT_ACCOUNT_CLASS_HASH, deploymentClasses } from "./account-families";

/**
 * Supported contract families for accounts controlled by one wallet signer.
 *
 * `braavos` is importable but not creatable: this wallet never deploys a
 * Braavos account, it only recognises one a user already owns.
 */
export type AccountContractType = "argent" | "braavos" | "openzeppelin";

/**
 * The contract fields of one account record: its family and, for every family
 * whose address derives from a deployment salt, that exact salt. The address
 * is a function of the salt and of the class the account was deployed with,
 * and neither can be read back from the account afterwards, so a record that
 * lost either could no longer re-derive the address it holds.
 */
export type AccountContractMetadata =
  | { readonly accountContractType: "argent" | "braavos"; readonly deploymentSalt: string }
  | { readonly accountContractType: "openzeppelin"; readonly deploymentSalt?: never };

/**
 * Families this wallet itself brings accounts into existence in: its own
 * OpenZeppelin accounts and Argent at the release it deploys. A hardware account
 * always belongs to one of these too — this wallet creates its own on a device
 * and detects Ready's there — so the same set bounds every Ledger request.
 * Braavos is excluded: it is only ever imported.
 */
export type CreatableAccountContractType = Exclude<AccountContractType, "braavos">;

/**
 * Validates the closed set of single-signer account contracts this wallet can
 * hold. Braavos is included because a user can import one; see
 * {@link isCreatableAccountContractType} for the narrower set this wallet is
 * willing to bring into existence.
 */
export const isAccountContractType = (value: unknown): value is AccountContractType =>
  value === "argent" || value === "braavos" || value === "openzeppelin";

/**
 * Validates, at an untrusted message boundary, a family this wallet may create
 * an account in or ask a hardware device about. Narrower than
 * {@link isAccountContractType} on purpose: a Braavos account can be imported and
 * recognised, but a request to create one, or to derive one on a device, is
 * malformed rather than merely unsupported.
 */
export const isCreatableAccountContractType = (
  value: unknown,
): value is CreatableAccountContractType => value === "argent" || value === "openzeppelin";

/**
 * Families a Ledger device can hold an account in. Broader than
 * {@link CreatableAccountContractType}: besides the OpenZeppelin accounts this
 * wallet creates on a device and the Argent accounts restored from Ready, a
 * Braavos account can be owned by a Ledger key — Braavos derives it at Ready's
 * `argentx` path — so a device request naming Braavos restores an account that
 * already exists rather than being malformed.
 */
export type LedgerAccountContractType = AccountContractType;

/**
 * Validates, at an untrusted message boundary, a family a Ledger device may hold
 * an account in. Equal to {@link isAccountContractType}: every single-signer
 * family can be owned by a device key. Which path derives which family is
 * enforced where the device is enumerated, not here.
 */
export const isLedgerAccountContractType = (value: unknown): value is LedgerAccountContractType =>
  isAccountContractType(value);

/**
 * Which account records a schema era could have written.
 *
 * `current` admits Braavos and any class an Argent account can be deployed
 * with. `pre-braavos` is what every schema up to v9 produced: no Braavos, and
 * Argent only at the release this wallet creates. Older eras stay that strict
 * because no writer of theirs ever produced anything else, so a record claiming
 * otherwise is corrupt rather than merely new.
 */
export type AccountRecordEra = "current" | "pre-braavos";

// An address is fixed by the class the account was DEPLOYED with, so the class
// stored beside it must be one such an account can be deployed with — not only
// the release this wallet creates. Pinning to that release is what refused to
// store a Ready account deployed at 0.3.x, even after discovery had found it.
const hasAcceptedClass = (
  accountContractType: "argent" | "braavos",
  classHash: unknown,
  era: AccountRecordEra,
): boolean => {
  if (typeof classHash !== "string") {
    return false;
  }
  if (era === "pre-braavos") {
    return accountContractType === "argent" && sameFelt(classHash, ARGENT_ACCOUNT_CLASS_HASH);
  }
  return deploymentClasses(accountContractType).some((entry) =>
    sameFelt(entry.classHash, classHash),
  );
};

/**
 * Validates the contract fields of one stored account record for a given schema
 * era: its family, the class it was deployed with, and the deployment salt its
 * address derives from. Returns false rather than throwing, so callers compose
 * it into larger record validators; any unrecognised family, a class outside
 * what the era admits, or a missing or non-canonical salt fails closed.
 */
export const hasValidContractMetadata = (
  value: Record<string, unknown>,
  requireCanonical: boolean,
  requireArgentSalt: boolean,
  era: AccountRecordEra = "current",
): boolean => {
  const accountContractType = value["accountContractType"];
  if (!isAccountContractType(accountContractType)) {
    return false;
  }
  const deploymentSalt = value["deploymentSalt"];
  if (accountContractType === "openzeppelin") {
    return deploymentSalt === undefined;
  }
  if (!hasAcceptedClass(accountContractType, value["classHash"], era)) {
    return false;
  }
  // Only pre-v7 Argent records predate stored salts; every Braavos record is
  // new enough to carry the salt its address derives from.
  if (accountContractType === "argent" && !requireArgentSalt && deploymentSalt === undefined) {
    return true;
  }
  return (
    typeof deploymentSalt === "string" &&
    canonicalFelt(deploymentSalt) !== null &&
    (!requireCanonical || canonicalFelt(deploymentSalt) === deploymentSalt)
  );
};

/**
 * Builds the contract fields a record stores for one family, keeping the salt
 * for every family whose address derives from one. Returns null when such a
 * family has no salt, and never attaches one to OpenZeppelin, so no writer can
 * produce a record {@link hasValidContractMetadata} would reject — the way a
 * Braavos record once lost its salt to a branch that knew only Argent.
 */
export const accountContractFields = (
  accountContractType: AccountContractType,
  deploymentSalt: string | undefined,
): AccountContractMetadata | null => {
  if (accountContractType === "openzeppelin") {
    return { accountContractType };
  }
  return deploymentSalt === undefined ? null : { accountContractType, deploymentSalt };
};
