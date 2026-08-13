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
  isLedgerAccountIndex,
  isLedgerAccountPath,
  LEDGER_EIP2645_APPLICATION,
  ledgerAccountIndexOfPath,
} from "./ledger-path";

/**
 * Supported contract families for accounts controlled by one wallet signer.
 */
export type AccountContractType = "argent" | "openzeppelin";

/**
 * Validates the closed set of supported single-signer account contracts.
 */
export const isAccountContractType = (value: unknown): value is AccountContractType =>
  value === "argent" || value === "openzeppelin";

/**
 * BIP-44 provenance for an account derived from the recovery phrase.
 */
export type Bip44Derivation = {
  readonly accountIndex: number;
  readonly addressIndex: number;
  readonly kind: "starknet-bip44";
};

/**
 * Provenance for an account imported from a raw Starknet signing key.
 */
export type ImportedKeyDerivation = {
  readonly kind: "imported-raw-key";
};

/**
 * Public coordinates needed to ask a Ledger to sign for an account again.
 */
export type LedgerDerivation = {
  readonly accountIndex: number;
  readonly eip2645application: string;
  readonly kind: "ledger";
  readonly path: string;
};

/**
 * Account provenance discriminated by the signer kind.
 */
export type AccountDerivation = Bip44Derivation | ImportedKeyDerivation | LedgerDerivation;

type AccountRefCore = {
  readonly accountContractType: AccountContractType;
  readonly address: string;
  readonly classHash: string;
  readonly id: string;
  readonly networkId: StarknetNetworkId;
  readonly publicKeyX: string;
};

type LegacyAccountRefCore = Omit<AccountRefCore, "accountContractType">;

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
 * Public signer-account metadata safe to expose to granted origins.
 */
export type AccountRef = DerivedAccountRef | ImportedAccountRef | LedgerAccountRef;

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

/**
 * Device-enumerated Ledger account index and public-key x-coordinate. This is
 * public account material; it carries no signing or viewing secret.
 */
export type LedgerPubKeyEntry = {
  readonly accountIndex: number;
  readonly publicKeyX: string;
};

const isSafeIndex = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

const isNonZeroFelt = (value: unknown): value is string =>
  typeof value === "string" && isNonZeroStarkFieldElement(value);

const isBip44Derivation = (value: unknown): value is Bip44Derivation =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["accountIndex", "addressIndex", "kind"]) &&
  value["kind"] === "starknet-bip44" &&
  isSafeIndex(value["accountIndex"]) &&
  isSafeIndex(value["addressIndex"]);

const isImportedKeyDerivation = (value: unknown): value is ImportedKeyDerivation =>
  isRecord(value) && hasOnlyKnownKeys(value, ["kind"]) && value["kind"] === "imported-raw-key";

const isLedgerDerivation = (value: unknown): value is LedgerDerivation =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["accountIndex", "eip2645application", "kind", "path"]) &&
  value["kind"] === "ledger" &&
  isLedgerAccountIndex(value["accountIndex"]) &&
  value["eip2645application"] === LEDGER_EIP2645_APPLICATION &&
  isLedgerAccountPath(value["path"]) &&
  ledgerAccountIndexOfPath(value["path"]) === value["accountIndex"];

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
  "derivation",
  "id",
  "networkId",
  "publicKeyX",
] as const;
const DERIVED_ACCOUNT_KEYS = [...KEYLESS_ACCOUNT_KEYS, "publicKeyY"] as const;
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
  if (!isAccountContractType(value["accountContractType"])) {
    return false;
  }
  if (isImportedKeyDerivation(derivation) || isLedgerDerivation(derivation)) {
    return (
      hasOnlyKnownKeys(value, KEYLESS_ACCOUNT_KEYS) &&
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
  if (publicKeyX === null) {
    return null;
  }
  if (value.derivation.kind === "starknet-bip44") {
    const derived = value as DerivedAccountRef;
    const publicKeyY = canonicalFelt(derived.publicKeyY);
    return publicKeyY === null
      ? null
      : {
          accountContractType: derived.accountContractType,
          address,
          classHash,
          derivation: derived.derivation,
          id,
          networkId: value.networkId,
          publicKeyX,
          publicKeyY,
        };
  }
  if (value.derivation.kind === "ledger") {
    const ledger = value as LedgerAccountRef;
    return {
      accountContractType: ledger.accountContractType,
      address,
      classHash,
      derivation: ledger.derivation,
      id,
      networkId: value.networkId,
      publicKeyX,
    };
  }
  return {
    accountContractType: value.accountContractType,
    address,
    classHash,
    derivation: value.derivation,
    id,
    networkId: value.networkId,
    publicKeyX,
  };
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
 */
export const isKeylessAccount = (account: AccountRef): account is LedgerAccountRef =>
  account.derivation.kind === "ledger";
