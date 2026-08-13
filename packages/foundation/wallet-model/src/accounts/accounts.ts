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
  readonly address: string;
  readonly classHash: string;
  readonly id: string;
  readonly networkId: StarknetNetworkId;
  readonly publicKeyX: string;
};

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
    !isStarknetNetworkId(value["networkId"]) ||
    !isNonZeroFelt(value["publicKeyX"])
  ) {
    return false;
  }
  const address = canonicalFelt(value["address"]);
  const id = canonicalAccountId(value["id"]);
  const canonicalFields =
    address === value["address"] &&
    canonicalFelt(value["classHash"]) === value["classHash"] &&
    canonicalFelt(value["publicKeyX"]) === value["publicKeyX"];
  return (
    address !== null &&
    id === `${value["networkId"]}:${address}` &&
    (!requireCanonical || (canonicalFields && id === value["id"]))
  );
};

const KEYLESS_ACCOUNT_KEYS = [
  "address",
  "classHash",
  "derivation",
  "id",
  "networkId",
  "publicKeyX",
] as const;
const DERIVED_ACCOUNT_KEYS = [...KEYLESS_ACCOUNT_KEYS, "publicKeyY"] as const;

/**
 * Validates public account metadata. Imported and Ledger accounts omit
 * `publicKeyY`; an HD-derived account must include it.
 */
const isAccountRefShape = (value: unknown, requireCanonical: boolean): value is AccountRef => {
  if (!isRecord(value)) {
    return false;
  }
  const derivation = value["derivation"];
  if (isImportedKeyDerivation(derivation) || isLedgerDerivation(derivation)) {
    return (
      hasOnlyKnownKeys(value, KEYLESS_ACCOUNT_KEYS) && hasValidAccountCore(value, requireCanonical)
    );
  }
  return (
    hasOnlyKnownKeys(value, DERIVED_ACCOUNT_KEYS) &&
    isBip44Derivation(derivation) &&
    isNonZeroFelt(value["publicKeyY"]) &&
    (!requireCanonical || canonicalFelt(value["publicKeyY"]) === value["publicKeyY"]) &&
    hasValidAccountCore(value, requireCanonical)
  );
};

/**
 * Validates public account metadata in its single canonical felt spelling.
 */
export const isAccountRef = (value: unknown): value is AccountRef => isAccountRefShape(value, true);

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
  const publicKeyX = canonicalFelt(value.publicKeyX);
  if (address === null || classHash === null || publicKeyX === null) {
    return null;
  }
  const id = `${value.networkId}:${address}`;
  if (value.derivation.kind === "starknet-bip44") {
    const publicKeyY = canonicalFelt((value as DerivedAccountRef).publicKeyY);
    return publicKeyY === null
      ? null
      : {
          address,
          classHash,
          derivation: value.derivation,
          id,
          networkId: value.networkId,
          publicKeyX,
          publicKeyY,
        };
  }
  if (value.derivation.kind === "ledger") {
    return {
      address,
      classHash,
      derivation: value.derivation,
      id,
      networkId: value.networkId,
      publicKeyX,
    };
  }
  return {
    address,
    classHash,
    derivation: value.derivation,
    id,
    networkId: value.networkId,
    publicKeyX,
  };
};

/**
 * True when an account delegates every signing request to a Ledger device.
 */
export const isKeylessAccount = (account: AccountRef): account is LedgerAccountRef =>
  account.derivation.kind === "ledger";
