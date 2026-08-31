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
} from "../networks/networks";
import {
  type AccountContractMetadata,
  canonicalContractMetadata,
  hasValidContractMetadata,
} from "./contract-metadata";
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
 * Account-contract types, re-exported so `./accounts` stays the one import path
 * for the public account model. Their validators live beside them in
 * `./contract-metadata`.
 */
export {
  type AccountContractType,
  ARGENT_ACCOUNT_CLASS_HASH,
  isAccountContractType,
  isStarkCurveContractType,
  OPENZEPPELIN_ACCOUNT_CLASS_HASH,
  type StarkCurveContractType,
} from "./contract-metadata";

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

type AccountRefIdentity = {
  readonly address: string;
  readonly classHash: string;
  readonly id: string;
  readonly networkId: StarknetNetworkId;
  readonly publicKeyX: string;
};

// A contract family and a signer provenance are not independent: an ML-DSA
// contract can only be signed by a paired phone, and a Stark-curve contract can
// never be. `hasValidContractMetadata` enforces that at runtime; splitting the
// core here enforces it in the types too, so a Ledger or HD account cannot even
// be *described* as ML-DSA and every consumer that narrows to one of these refs
// knows which family it holds without re-checking.
type StarkCurveAccountRefCore = AccountRefIdentity &
  Exclude<AccountContractMetadata, { readonly accountContractType: "ml-dsa" }>;

type MlDsaAccountRefCore = AccountRefIdentity &
  Extract<AccountContractMetadata, { readonly accountContractType: "ml-dsa" }>;

type LegacyAccountRefCore = AccountRefIdentity;

/**
 * HD-derived account metadata including its full public-key point.
 */
export type DerivedAccountRef = StarkCurveAccountRefCore & {
  readonly derivation: Bip44Derivation;
  readonly publicKeyY: string;
};

/**
 * Imported account metadata, which retains no public-key y-coordinate.
 */
export type ImportedAccountRef = StarkCurveAccountRefCore & {
  readonly derivation: ImportedKeyDerivation;
};

/**
 * Ledger account metadata containing no locally held signing key.
 */
export type LedgerAccountRef = StarkCurveAccountRefCore & {
  readonly derivation: LedgerDerivation;
};

/**
 * Paired-phone account metadata containing no locally held signing key. The
 * ML-DSA-65 key is 1952 bytes, far past one felt, so `publicKey` carries the
 * encoded key itself — which the verify-before-broadcast gate needs in full —
 * while `publicKeyX` carries the Poseidon commitment to that key's packed
 * expansion — the same felt the account contract binds in its address, doubling
 * as this record's single-felt identity.
 */
export type MobilePqAccountRef = MlDsaAccountRefCore & {
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
  const publicKeyX = canonicalFelt(value.publicKeyX);
  const contract = canonicalContractMetadata(value);
  if (publicKeyX === null || contract === null) {
    return null;
  }
  const identity = {
    address,
    classHash,
    id: `${value.networkId}:${address}`,
    networkId: value.networkId,
    publicKeyX,
  };
  // The family and the derivation are narrowed together, because the record
  // types now pair them: only a paired phone may be ML-DSA, and only ML-DSA may
  // be a paired phone. `isAccountRefShape` already refused every other pairing,
  // so the mismatched branches below are unreachable rather than lenient.
  if (value.derivation.kind === "mobile-pq") {
    // `value.derivation.kind` narrows the derivation but not `value` itself: the
    // ref types are intersections, so the discriminant is nested and TypeScript
    // will not distribute over it. The cast reads the fields the shape check
    // already validated.
    const mobile = value as MobilePqAccountRef;
    return contract.accountContractType === "ml-dsa"
      ? { ...identity, ...contract, derivation: mobile.derivation, publicKey: mobile.publicKey }
      : null;
  }
  if (contract.accountContractType === "ml-dsa") {
    return null;
  }
  if (value.derivation.kind === "starknet-bip44") {
    const derived = value as DerivedAccountRef;
    const publicKeyY = canonicalFelt(derived.publicKeyY);
    return publicKeyY === null
      ? null
      : { ...identity, ...contract, derivation: derived.derivation, publicKeyY };
  }
  // One literal cannot be assigned to a union of record types when only
  // `derivation` differs; the legacy canonicalizer below makes the same
  // assertion for the same reason.
  const device = value as ImportedAccountRef | LedgerAccountRef;
  return { ...identity, ...contract, derivation: device.derivation } as
    | ImportedAccountRef
    | LedgerAccountRef;
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
