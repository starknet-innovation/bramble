/**
 * Which account contract a record claims, and the family-specific fields that
 * come with the claim. Split from `./accounts` because it answers a different
 * question from account identity: not "which account is this" but "what code
 * validates it on chain, and what does that code need from us".
 *
 * Public material only — a class hash, a deployment salt, and a contract
 * discriminator. Nothing here is secret and nothing here signs.
 */
import { canonicalFelt, sameFelt } from "../networks/networks";
import { isMobilePqDerivation } from "./derivations";

/**
 * Supported contract families for accounts controlled by one wallet signer.
 * `ml-dsa` names a family whose on-chain `__validate__` checks post-quantum
 * ML-DSA-65 rather than Stark ECDSA. It is a distinct family, not a flavour of
 * `openzeppelin`: it derives its address from a different constructor,
 * serializes hundreds of felts of signature calldata instead of two, cannot be
 * a member of an Argent multisig, and must be named as itself wherever the
 * wallet shows a user what kind of account they hold.
 */
export type AccountContractType = "argent" | "ml-dsa" | "openzeppelin";

/**
 * The contract families whose `__validate__` checks a Stark-curve signature.
 * Everything except `ml-dsa`, and the distinction is load-bearing rather than
 * cosmetic: an account of one of these families can be created from any source
 * of a Stark key — the recovery phrase, an imported key, a Ledger — because all
 * three produce `(r, s)`. An ML-DSA account cannot be created from any of them,
 * and its address does not derive from a Stark public key at all.
 */
export type StarkCurveContractType = Exclude<AccountContractType, "ml-dsa">;

/**
 * Validates that a contract family checks Stark-curve signatures, so an account
 * of it may be created from key material. Refusing `ml-dsa` at a creation
 * boundary keeps the reason legible there: enrolling a device is a different
 * flow, not a parameter of this one.
 */
export const isStarkCurveContractType = (value: unknown): value is StarkCurveContractType =>
  value === "argent" || value === "openzeppelin";

/**
 * Pinned OpenZeppelin AccountUpgradeable 3.0 class understood by the account
 * model. The value is identical on the supported Mainnet and Sepolia networks.
 */
export const OPENZEPPELIN_ACCOUNT_CLASS_HASH =
  "0x01d1777db36cdd06dd62cfde77b1b6ae06412af95d57a13dc40ac77b8a702381";

/**
 * Pinned Argent Account 0.4 class understood by the account model. The
 * platform descriptor reuses this value for deployment and supply checks.
 */
export const ARGENT_ACCOUNT_CLASS_HASH =
  "0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f";

/**
 * Validates the closed set of supported single-signer account contracts.
 */
export const isAccountContractType = (value: unknown): value is AccountContractType =>
  value === "argent" || value === "ml-dsa" || value === "openzeppelin";

/**
 * The contract discriminator plus whatever that family needs stored alongside
 * it. Only Argent derives an address from a stored salt; only ML-DSA needs to
 * say which of its contracts it uses. Listing the families here rather than
 * deriving them with `Exclude` is what forces the next family to state which
 * side of each field it is on.
 */
export type AccountContractMetadata =
  | {
      readonly accountContractType: "argent";
      /** Exact DEPLOY_ACCOUNT salt used to derive this Argent address. */
      readonly deploymentSalt: string;
    }
  | {
      readonly accountContractType: "ml-dsa";
      readonly deploymentSalt?: never;
    }
  | {
      readonly accountContractType: "openzeppelin";
      readonly deploymentSalt?: never;
    };

/**
 * Validates a record's contract claim. `requireArgentSalt` is false only for
 * the schema-v6 reader, which predates retained salts.
 *
 * The ML-DSA branch enforces the family/derivation pairing in both directions:
 * the mobile-pq derivation validator requires this family, and this requires
 * that derivation. Without both, an ML-DSA contract paired with an HD or
 * imported derivation is a valid record — a vault-keyed account that can only
 * make Stark signatures, shown to the user as post-quantum, and unable to sign
 * anything its own contract would accept.
 */
export const hasValidContractMetadata = (
  value: Record<string, unknown>,
  requireCanonical: boolean,
  requireArgentSalt: boolean,
): boolean => {
  if (!isAccountContractType(value["accountContractType"])) {
    return false;
  }
  const deploymentSalt = value["deploymentSalt"];
  if (value["accountContractType"] === "ml-dsa") {
    return deploymentSalt === undefined && isMobilePqDerivation(value["derivation"]);
  }
  if (value["accountContractType"] === "openzeppelin") {
    return deploymentSalt === undefined;
  }
  if (!sameFelt(value["classHash"], ARGENT_ACCOUNT_CLASS_HASH)) {
    return false;
  }
  if (!requireArgentSalt && deploymentSalt === undefined) {
    return true;
  }
  return (
    typeof deploymentSalt === "string" &&
    canonicalFelt(deploymentSalt) !== null &&
    (!requireCanonical || canonicalFelt(deploymentSalt) === deploymentSalt)
  );
};

/**
 * Rebuilds a validated record's contract claim in canonical form, or null when
 * a felt it carries is not canonicalizable. Carries the family through rather
 * than naming one: an earlier version hardcoded `openzeppelin` here, which
 * silently rewrote every other salt-free family into an OpenZeppelin account on
 * its way out of the migration boundary.
 */
export const canonicalContractMetadata = (
  value: Record<string, unknown> & { readonly accountContractType: AccountContractType },
): AccountContractMetadata | null => {
  if (value.accountContractType === "argent") {
    const deploymentSalt =
      typeof value["deploymentSalt"] === "string" ? canonicalFelt(value["deploymentSalt"]) : null;
    return deploymentSalt === null ? null : { accountContractType: "argent", deploymentSalt };
  }
  if (value.accountContractType === "ml-dsa") {
    return { accountContractType: "ml-dsa" };
  }
  return { accountContractType: "openzeppelin" };
};
