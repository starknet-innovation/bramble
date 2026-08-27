/**
 * Public signer-account metadata and exact runtime validation. These values
 * carry no signing material and are safe to project outside the vault.
 */
import { hasOnlyKnownKeys, isRecord } from "@mc-wallet/core/json";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  isStarknetNetworkId,
  type StarknetNetworkId,
  sameFelt,
} from "../networks/networks";
import {
  type Bip44Derivation,
  type ImportedKeyDerivation,
  isBip44Derivation,
  isImportedKeyDerivation,
  isKeylessDerivation,
  isLedgerDerivation,
  isMobilePqDerivation,
  type LedgerDerivation,
  type MobilePqDerivation,
} from "./derivations";
import { isMlDsa65PublicKey } from "./signing";

/**
 * Account provenance types, re-exported so `./accounts` stays the one import
 * path for the public account model. Their validators live beside them in
 * `./derivations`.
 */
export type {
  AccountDerivation,
  Bip44Derivation,
  ImportedKeyDerivation,
  LedgerDerivation,
  MobilePqDerivation,
  TransportDescriptor,
} from "./derivations";

/**
 * Supported contract families for accounts controlled by one wallet signer.
 * `ml-dsa` names an account whose on-chain `__validate__` checks post-quantum
 * ML-DSA-65 rather than Stark ECDSA. It is a distinct family, not a flavour of
 * `openzeppelin`: it derives its address from a different constructor, serializes
 * roughly 107 felts of calldata instead of two, cannot be a member of an Argent
 * multisig, and must be named as itself wherever the wallet shows a user what
 * kind of account they hold.
 */
export type AccountContractType = "argent" | "ml-dsa" | "openzeppelin";

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

type AccountRefIdentity = {
  readonly address: string;
  readonly classHash: string;
  readonly id: string;
  readonly networkId: StarknetNetworkId;
  readonly publicKeyX: string;
};

type AccountContractMetadata =
  | {
      readonly accountContractType: "argent";
      /** Exact DEPLOY_ACCOUNT salt used to derive this Argent address. */
      readonly deploymentSalt: string;
    }
  | {
      readonly accountContractType: "ml-dsa" | "openzeppelin";
      readonly deploymentSalt?: never;
    };

type AccountRefCore = AccountRefIdentity & AccountContractMetadata;

type LegacyAccountRefCore = AccountRefIdentity;

/**
 * HD-derived account metadata including its full public-key point.
 */
export type DerivedAccountRef = AccountRefCore & {
  readonly derivation: Bip44Derivation;
  readonly publicKeyY: string;
};

/**
 * Imported account metadata, which retains no public-key y-coordinate.
 */
export type ImportedAccountRef = AccountRefCore & {
  readonly derivation: ImportedKeyDerivation;
};

/**
 * Ledger account metadata containing no locally held signing key.
 */
export type LedgerAccountRef = AccountRefCore & {
  readonly derivation: LedgerDerivation;
};

/**
 * Paired-phone account metadata containing no locally held signing key. The
 * ML-DSA-65 key is 1952 bytes, far past one felt, so `publicKeyX` carries a
 * Poseidon commitment over it (the value the account contract validates
 * against) and `publicKey` carries the encoded key itself, which the
 * verify-before-broadcast gate needs in full.
 */
export type MobilePqAccountRef = AccountRefCore & {
  readonly derivation: MobilePqDerivation;
  readonly publicKey: string;
};

/**
 * Public signer-account metadata safe to expose to granted origins.
 */
export type AccountRef =
  | DerivedAccountRef
  | ImportedAccountRef
  | LedgerAccountRef
  | MobilePqAccountRef;

/**
 * Schema-v6 account metadata before Argent deployment salts were retained.
 * Accepted only by the adjacent encrypted-vault migration.
 */
export type LegacyV6AccountRef =
  | Omit<DerivedAccountRef, "deploymentSalt">
  | Omit<ImportedAccountRef, "deploymentSalt">
  | Omit<LedgerAccountRef, "deploymentSalt">;

/**
 * Historical account metadata accepted only while reading vault schemas v1-v5.
 */
export type LegacyAccountRef =
  | (LegacyAccountRefCore & {
      readonly derivation: Bip44Derivation;
      readonly publicKeyY: string;
    })
  | (LegacyAccountRefCore & { readonly derivation: ImportedKeyDerivation })
  | (LegacyAccountRefCore & { readonly derivation: LedgerDerivation });

const isNonZeroFelt = (value: unknown): value is string =>
  typeof value === "string" && isNonZeroStarkFieldElement(value);

/**
 * Returns the one minimal-hex spelling of an account id, accepting historical
 * leading-zero address aliases as migration input. Invalid ids return null.
 */
export const canonicalAccountId = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const parts = value.split(":");
  const networkId = parts[0];
  const address = parts[1];
  if (parts.length !== 2 || !isStarknetNetworkId(networkId) || !isNonZeroFelt(address)) {
    return null;
  }
  const canonicalAddress = canonicalFelt(address);
  return canonicalAddress === null ? null : `${networkId}:${canonicalAddress}`;
};

/**
 * Validates the canonical account id spelling and its supported-network scope.
 */
export const isAccountId = (value: unknown): value is string => canonicalAccountId(value) === value;

/**
 * Checks that an account id is structurally valid for the claimed network.
 */
export const isAccountIdForNetwork = (value: unknown, networkId: unknown): value is string =>
  isStarknetNetworkId(networkId) && isAccountId(value) && value.startsWith(`${networkId}:`);

const hasValidAccountCore = (
  value: Record<string, unknown>,
  requireCanonical: boolean,
): boolean => {
  if (
    !isNonZeroFelt(value["address"]) ||
    !isNonZeroFelt(value["classHash"]) ||
    !isStarknetNetworkId(value["networkId"])
  ) {
    return false;
  }
  const address = canonicalFelt(value["address"]);
  const id = canonicalAccountId(value["id"]);
  const canonicalFields =
    address === value["address"] && canonicalFelt(value["classHash"]) === value["classHash"];
  return (
    address !== null &&
    id === `${value["networkId"]}:${address}` &&
    (!requireCanonical || (canonicalFields && id === value["id"]))
  );
};

const hasValidSingleSignerCore = (
  value: Record<string, unknown>,
  requireCanonical: boolean,
): boolean =>
  isNonZeroFelt(value["publicKeyX"]) &&
  (!requireCanonical || canonicalFelt(value["publicKeyX"]) === value["publicKeyX"]) &&
  hasValidAccountCore(value, requireCanonical);

const hasValidContractMetadata = (
  value: Record<string, unknown>,
  requireCanonical: boolean,
  requireArgentSalt: boolean,
): boolean => {
  if (!isAccountContractType(value["accountContractType"])) {
    return false;
  }
  const deploymentSalt = value["deploymentSalt"];
  if (
    value["accountContractType"] === "openzeppelin" ||
    value["accountContractType"] === "ml-dsa"
  ) {
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

const KEYLESS_ACCOUNT_KEYS = [
  "accountContractType",
  "address",
  "classHash",
  "deploymentSalt",
  "derivation",
  "id",
  "networkId",
  "publicKeyX",
] as const;
const DERIVED_ACCOUNT_KEYS = [...KEYLESS_ACCOUNT_KEYS, "publicKeyY"] as const;
const MOBILE_PQ_ACCOUNT_KEYS = [...KEYLESS_ACCOUNT_KEYS, "publicKey"] as const;
const LEGACY_V6_KEYLESS_ACCOUNT_KEYS = [
  "accountContractType",
  "address",
  "classHash",
  "derivation",
  "id",
  "networkId",
  "publicKeyX",
] as const;
const LEGACY_V6_DERIVED_ACCOUNT_KEYS = [...LEGACY_V6_KEYLESS_ACCOUNT_KEYS, "publicKeyY"] as const;
const LEGACY_KEYLESS_ACCOUNT_KEYS = [
  "address",
  "classHash",
  "derivation",
  "id",
  "networkId",
  "publicKeyX",
] as const;
const LEGACY_DERIVED_ACCOUNT_KEYS = [...LEGACY_KEYLESS_ACCOUNT_KEYS, "publicKeyY"] as const;
/**
 * Validates public account metadata. Imported and Ledger accounts omit
 * `publicKeyY`; an HD-derived account must include it.
 */
const isAccountRefShape = (value: unknown, requireCanonical: boolean): value is AccountRef => {
  if (!isRecord(value)) {
    return false;
  }
  const derivation = value["derivation"];
  if (!hasValidContractMetadata(value, requireCanonical, true)) {
    return false;
  }
  if (isImportedKeyDerivation(derivation) || isLedgerDerivation(derivation)) {
    return (
      hasOnlyKnownKeys(value, KEYLESS_ACCOUNT_KEYS) &&
      hasValidSingleSignerCore(value, requireCanonical)
    );
  }
  if (isMobilePqDerivation(derivation)) {
    return (
      hasOnlyKnownKeys(value, MOBILE_PQ_ACCOUNT_KEYS) &&
      value["accountContractType"] === "ml-dsa" &&
      isMlDsa65PublicKey(value["publicKey"]) &&
      hasValidSingleSignerCore(value, requireCanonical)
    );
  }
  return (
    hasOnlyKnownKeys(value, DERIVED_ACCOUNT_KEYS) &&
    isBip44Derivation(derivation) &&
    isNonZeroFelt(value["publicKeyY"]) &&
    (!requireCanonical || canonicalFelt(value["publicKeyY"]) === value["publicKeyY"]) &&
    hasValidSingleSignerCore(value, requireCanonical)
  );
};

const isLegacyV6AccountRefShape = (
  value: unknown,
  requireCanonical: boolean,
): value is LegacyV6AccountRef => {
  if (!isRecord(value) || !hasValidContractMetadata(value, requireCanonical, false)) {
    return false;
  }
  if (value["deploymentSalt"] !== undefined) {
    return false;
  }
  const derivation = value["derivation"];
  if (isImportedKeyDerivation(derivation) || isLedgerDerivation(derivation)) {
    return (
      hasOnlyKnownKeys(value, LEGACY_V6_KEYLESS_ACCOUNT_KEYS) &&
      hasValidSingleSignerCore(value, requireCanonical)
    );
  }
  return (
    hasOnlyKnownKeys(value, LEGACY_V6_DERIVED_ACCOUNT_KEYS) &&
    isBip44Derivation(derivation) &&
    isNonZeroFelt(value["publicKeyY"]) &&
    (!requireCanonical || canonicalFelt(value["publicKeyY"]) === value["publicKeyY"]) &&
    hasValidSingleSignerCore(value, requireCanonical)
  );
};

const isLegacyAccountRefShape = (
  value: unknown,
  requireCanonical: boolean,
): value is LegacyAccountRef => {
  if (!isRecord(value)) {
    return false;
  }
  const derivation = value["derivation"];
  if (isImportedKeyDerivation(derivation) || isLedgerDerivation(derivation)) {
    return (
      hasOnlyKnownKeys(value, LEGACY_KEYLESS_ACCOUNT_KEYS) &&
      hasValidSingleSignerCore(value, requireCanonical)
    );
  }
  return (
    hasOnlyKnownKeys(value, LEGACY_DERIVED_ACCOUNT_KEYS) &&
    isBip44Derivation(derivation) &&
    isNonZeroFelt(value["publicKeyY"]) &&
    (!requireCanonical || canonicalFelt(value["publicKeyY"]) === value["publicKeyY"]) &&
    hasValidSingleSignerCore(value, requireCanonical)
  );
};

/**
 * Validates public account metadata in its single canonical felt spelling.
 */
export const isAccountRef = (value: unknown): value is AccountRef => isAccountRefShape(value, true);

/** Validates phrase-derived account metadata at runtime boundaries. */
export const isDerivedAccountRef = (value: unknown): value is DerivedAccountRef =>
  isAccountRef(value) && value.derivation.kind === "starknet-bip44";

/**
 * Validates canonical schema-v6 account metadata for its one-step migration.
 */
export const isLegacyV6AccountRef = (value: unknown): value is LegacyV6AccountRef =>
  isLegacyV6AccountRefShape(value, true);

/**
 * Validates a historical schema-v1-v5 account with no contract discriminator.
 * This parser must never be used for current runtime messages or writes.
 */
export const isLegacyAccountRef = (value: unknown): value is LegacyAccountRef =>
  isLegacyAccountRefShape(value, true);

/**
 * Canonicalizes an otherwise valid historical account record. This is the
 * deterministic compatibility boundary used by the vault schema migration;
 * production writers should already emit a value accepted by
 * {@link isAccountRef}.
 */
export const canonicalAccountRef = (value: unknown): AccountRef | null => {
  if (!isAccountRefShape(value, false)) {
    return null;
  }
  const address = canonicalFelt(value.address);
  const classHash = canonicalFelt(value.classHash);
  if (address === null || classHash === null) {
    return null;
  }
  const id = `${value.networkId}:${address}`;
  const publicKeyX = canonicalFelt(value.publicKeyX);
  const deploymentSalt =
    value.accountContractType === "argent" && typeof value.deploymentSalt === "string"
      ? canonicalFelt(value.deploymentSalt)
      : undefined;
  if (publicKeyX === null || deploymentSalt === null) {
    return null;
  }
  const contract: AccountContractMetadata =
    value.accountContractType === "argent"
      ? { accountContractType: "argent", deploymentSalt: deploymentSalt as string }
      : // Carry the family through rather than naming one: this used to hardcode
        // "openzeppelin", which silently rewrote any other salt-free family into
        // an OpenZeppelin account on its way out of the migration boundary.
        { accountContractType: value.accountContractType };
  if (value.derivation.kind === "starknet-bip44") {
    const derived = value as DerivedAccountRef;
    const publicKeyY = canonicalFelt(derived.publicKeyY);
    return publicKeyY === null
      ? null
      : {
          ...contract,
          address,
          classHash,
          derivation: derived.derivation,
          id,
          networkId: value.networkId,
          publicKeyX,
          publicKeyY,
        };
  }
  // Every non-HD kind carries the same fields, so they share one shape; only a
  // paired phone adds its full enclave key, which is already validated above.
  const keyless = {
    ...contract,
    address,
    classHash,
    id,
    networkId: value.networkId,
    publicKeyX,
  };
  if (value.derivation.kind === "mobile-pq") {
    const mobile = value as MobilePqAccountRef;
    return { ...keyless, derivation: mobile.derivation, publicKey: mobile.publicKey };
  }
  // Same assertion the legacy canonicalizer below makes: one literal cannot be
  // assigned to a union of record types when only `derivation` differs.
  const device = value as ImportedAccountRef | LedgerAccountRef;
  return { ...keyless, derivation: device.derivation } as ImportedAccountRef | LedgerAccountRef;
};

/**
 * Canonicalizes historical schema-v1-v5 account metadata without assigning a
 * contract family. The v5-to-v6 migration performs that assignment explicitly.
 */
export const canonicalLegacyAccountRef = (value: unknown): LegacyAccountRef | null => {
  if (!isLegacyAccountRefShape(value, false)) {
    return null;
  }
  const address = canonicalFelt(value.address);
  const classHash = canonicalFelt(value.classHash);
  const publicKeyX = canonicalFelt(value.publicKeyX);
  if (address === null || classHash === null || publicKeyX === null) {
    return null;
  }
  const core = {
    address,
    classHash,
    id: `${value.networkId}:${address}`,
    networkId: value.networkId,
    publicKeyX,
  };
  if (value.derivation.kind === "starknet-bip44") {
    const derived = value as Extract<LegacyAccountRef, { readonly publicKeyY: string }>;
    const publicKeyY = canonicalFelt(derived.publicKeyY);
    return publicKeyY === null ? null : { ...core, derivation: derived.derivation, publicKeyY };
  }
  return { ...core, derivation: value.derivation } as LegacyAccountRef;
};

/**
 * True when an account delegates every signing request to a Ledger device.
 * Callers that go on to read a Ledger derivation path, account index, or
 * viewing-key scope want this one, not {@link isKeylessAccount}.
 */
export const isLedgerAccount = (account: AccountRef): account is LedgerAccountRef =>
  account.derivation.kind === "ledger";

/**
 * True when the vault holds nothing that can authorize this account, so every
 * request has to go out to an external device. A caller that assumes the device
 * is a Ledger must narrow further with {@link isLedgerAccount}.
 */
export const isKeylessAccount = (
  account: AccountRef,
): account is LedgerAccountRef | MobilePqAccountRef => isKeylessDerivation(account.derivation);
