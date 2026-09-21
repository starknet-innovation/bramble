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
 * Families a hardware-derived account can belong to. Braavos is excluded
 * deliberately: this wallet derives only its own OpenZeppelin accounts and the
 * Ready accounts it detects on a device, and never a Braavos one.
 */
export type LedgerAccountContractType = Exclude<AccountContractType, "braavos">;

/**
 * Validates the closed set of families a hardware-derived account may claim, at
 * an untrusted message boundary. Narrower than {@link isAccountContractType} on
 * purpose: a device request naming Braavos is malformed, not merely unsupported.
 */
export const isLedgerAccountContractType = (value: unknown): value is LedgerAccountContractType =>
  value === "argent" || value === "openzeppelin";

/**
 * Validates the closed set of single-signer account contracts this wallet can
 * hold. Braavos is included because a user can import one; see
 * {@link isCreatableAccountContractType} for the narrower set this wallet is
 * willing to bring into existence.
 */
export const isAccountContractType = (value: unknown): value is AccountContractType =>
  value === "argent" || value === "braavos" || value === "openzeppelin";

/**
 * Validates the families this wallet will CREATE an account in. Narrower than
 * {@link isAccountContractType} on purpose: a Braavos account can be imported
 * and recognised, but this wallet never deploys one, so a request to create one
 * is malformed rather than merely unsupported.
 */
export const isCreatableAccountContractType = (
  value: unknown,
): value is LedgerAccountContractType => value === "argent" || value === "openzeppelin";

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
