/**
 * Public signer-account metadata and exact runtime validation. These values
 * carry no signing material and are safe to project outside the vault.
 */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  isStarknetNetworkId,
  type StarknetNetworkId,
} from "../networks/networks";
import { type AccountRecordEra, hasValidContractMetadata } from "./account-contract-types";
import {
  isLedgerAccountIndex,
  isLedgerAccountPathFor,
  isLedgerEip2645Application,
  LEDGER_EIP2645_APPLICATION,
  type LedgerEip2645Application,
  READY_EIP2645_APPLICATION,
} from "./ledger-path";

export {
  type AccountContractType,
  isAccountContractType,
  isCreatableAccountContractType,
  isLedgerAccountContractType,
  type LedgerAccountContractType,
} from "./account-contract-types";

// Path schemes a Ledger derivation may name: both at the current vault schema,
// Bramble's alone before v9 (all those vaults could ever have stored).
const CURRENT_LEDGER_APPLICATIONS: readonly LedgerEip2645Application[] = [
  LEDGER_EIP2645_APPLICATION,
  READY_EIP2645_APPLICATION,
];
const LEDGERW_ONLY: readonly LedgerEip2645Application[] = [LEDGER_EIP2645_APPLICATION];

/**
 * Pinned OpenZeppelin AccountUpgradeable 3.0 class understood by the account
 * model. The value is identical on the supported Mainnet and Sepolia networks.
 */
export const OPENZEPPELIN_ACCOUNT_CLASS_HASH =
  "0x01d1777db36cdd06dd62cfde77b1b6ae06412af95d57a13dc40ac77b8a702381";

// Owned by the class table in ./account-families, which is where every other
// account class hash lives; re-exported here so the many callers that import it
// from this module are unaffected. The table cannot import from this module, or
// the validators below that consult it would form a dependency cycle.
export { ARGENT_ACCOUNT_CLASS_HASH } from "./account-families";

/** BIP-44 provenance; `seedId` names the imported phrase, absent = founding. */
export type Bip44Derivation = {
  readonly accountIndex: number;
  readonly addressIndex: number;
  readonly kind: "starknet-bip44";
  readonly seedId?: string;
};

/** Imported-phrase handle grammar: sequential vault-allocated, bounded. */
export const isImportedSeedId = (value: unknown): value is string =>
  typeof value === "string" && /^phrase-[1-9][0-9]{0,3}$/.test(value);

/**
 * Provenance for an account imported from a raw Starknet signing key.
 */
export type ImportedKeyDerivation = {
  readonly kind: "imported-raw-key";
};

/**
 * Public coordinates needed to ask a Ledger to sign for an account again; the
 * marker names the path scheme (`LedgerW` created here, `argentx` from Ready).
 */
export type LedgerDerivation = {
  readonly accountIndex: number;
  readonly eip2645application: LedgerEip2645Application;
  readonly kind: "ledger";
  readonly path: string;
};

/**
 * Account provenance discriminated by the signer kind.
 */
export type AccountDerivation = Bip44Derivation | ImportedKeyDerivation | LedgerDerivation;

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
      readonly accountContractType: "braavos";
      /**
       * Exact DEPLOY_ACCOUNT salt this Braavos address derives from. Retained
       * for the same reason as Argent's: the address is a function of the salt
       * and the class used at deployment, neither of which can be recovered
       * from the account afterwards.
       */
      readonly deploymentSalt: string;
    }
  | {
      readonly accountContractType: "openzeppelin";
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
 *
 * A device account is only ever OpenZeppelin (created here) or Argent (detected
 * from Ready); Braavos is refused at the message boundary by
 * {@link isLedgerAccountContractType} rather than in this type, so the guard is
 * one runtime check instead of a narrowing threaded through every caller.
 */
export type LedgerAccountRef = AccountRefCore & {
  readonly derivation: LedgerDerivation;
};

/**
 * Public signer-account metadata safe to expose to granted origins.
 */
export type AccountRef = DerivedAccountRef | ImportedAccountRef | LedgerAccountRef;

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
  hasOnlyKnownKeys(value, ["accountIndex", "addressIndex", "kind", "seedId"]) &&
  value["kind"] === "starknet-bip44" &&
  isSafeIndex(value["accountIndex"]) &&
  isSafeIndex(value["addressIndex"]) &&
  (value["seedId"] === undefined || isImportedSeedId(value["seedId"]));

const isImportedKeyDerivation = (value: unknown): value is ImportedKeyDerivation =>
  isRecord(value) && hasOnlyKnownKeys(value, ["kind"]) && value["kind"] === "imported-raw-key";

const isLedgerDerivation = (
  value: unknown,
  applications: readonly LedgerEip2645Application[],
): value is LedgerDerivation =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["accountIndex", "eip2645application", "kind", "path"]) &&
  value["kind"] === "ledger" &&
  isLedgerAccountIndex(value["accountIndex"]) &&
  isLedgerEip2645Application(value["eip2645application"]) &&
  applications.includes(value["eip2645application"]) &&
  isLedgerAccountPathFor(value["path"], value["eip2645application"], value["accountIndex"]);

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
 * Non-strings canonicalise to null and must never compare equal to it.
 */
export const isAccountId = (value: unknown): value is string =>
  typeof value === "string" && canonicalAccountId(value) === value;

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
const LEGACY_V6_KEYLESS_ACCOUNT_KEYS = [
  "accountContractType",
  "address",
  "classHash",
  "derivation",
  "id",
  "networkId",
  "publicKeyX",
] as const;
const LEGACY_KEYLESS_ACCOUNT_KEYS = [
  "address",
  "classHash",
  "derivation",
  "id",
  "networkId",
  "publicKeyX",
] as const;

// Shared body of every account shape: imported and Ledger accounts carry the
// keyless key set and omit `publicKeyY`; an HD-derived account adds it and must
// include it. `ledgerApplications` is the set of path schemes a Ledger
// derivation may name at the schema being validated.
const hasValidSignerShape = (
  value: Record<string, unknown>,
  keylessKeys: readonly string[],
  requireCanonical: boolean,
  ledgerApplications: readonly LedgerEip2645Application[],
): boolean => {
  const derivation = value["derivation"];
  if (isImportedKeyDerivation(derivation) || isLedgerDerivation(derivation, ledgerApplications)) {
    return (
      hasOnlyKnownKeys(value, keylessKeys) && hasValidSingleSignerCore(value, requireCanonical)
    );
  }
  return (
    hasOnlyKnownKeys(value, [...keylessKeys, "publicKeyY"]) &&
    isBip44Derivation(derivation) &&
    isNonZeroFelt(value["publicKeyY"]) &&
    (!requireCanonical || canonicalFelt(value["publicKeyY"]) === value["publicKeyY"]) &&
    hasValidSingleSignerCore(value, requireCanonical)
  );
};

const isAccountRefShape = (
  value: unknown,
  requireCanonical: boolean,
  ledgerApplications: readonly LedgerEip2645Application[] = CURRENT_LEDGER_APPLICATIONS,
  era: AccountRecordEra = "current",
): value is AccountRef =>
  isRecord(value) &&
  hasValidContractMetadata(value, requireCanonical, true, era) &&
  hasValidSignerShape(value, KEYLESS_ACCOUNT_KEYS, requireCanonical, ledgerApplications);

const isLegacyV6AccountRefShape = (
  value: unknown,
  requireCanonical: boolean,
): value is LegacyV6AccountRef =>
  isRecord(value) &&
  hasValidContractMetadata(value, requireCanonical, false) &&
  value["deploymentSalt"] === undefined &&
  hasValidSignerShape(value, LEGACY_V6_KEYLESS_ACCOUNT_KEYS, requireCanonical, LEDGERW_ONLY);

const isLegacyAccountRefShape = (
  value: unknown,
  requireCanonical: boolean,
): value is LegacyAccountRef =>
  isRecord(value) &&
  hasValidSignerShape(value, LEGACY_KEYLESS_ACCOUNT_KEYS, requireCanonical, LEDGERW_ONLY);

/**
 * Validates public account metadata in its single canonical felt spelling.
 */
export const isAccountRef = (value: unknown): value is AccountRef => isAccountRefShape(value, true);

/** Validates phrase-derived account metadata at runtime boundaries. */
export const isDerivedAccountRef = (value: unknown): value is DerivedAccountRef =>
  isAccountRef(value) && value.derivation.kind === "starknet-bip44";

/**
 * Validates canonical schema-v9 account metadata for its one-step migration:
 * the current shape, but no Braavos record and Argent only at the release this
 * wallet creates. No v9 writer produced anything else, so a v9 record claiming
 * otherwise is corrupt rather than merely new. Legacy vault validators only.
 */
export const isLegacyV9AccountRef = (value: unknown): value is AccountRef =>
  isAccountRefShape(value, true, CURRENT_LEDGER_APPLICATIONS, "pre-braavos");

/**
 * Validates canonical schema-v7/v8 account metadata: the v9 shape, but a Ledger
 * derivation may only follow Bramble's `LedgerW` scheme (Ready's `argentx` is
 * admitted from schema v9). Legacy vault validators only.
 */
export const isLegacyV8AccountRef = (value: unknown): value is AccountRef =>
  isAccountRefShape(value, true, LEDGERW_ONLY, "pre-braavos");

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
      : { accountContractType: "openzeppelin" };
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
  if (value.derivation.kind === "ledger") {
    const ledger = value as LedgerAccountRef;
    return {
      ...contract,
      address,
      classHash,
      derivation: ledger.derivation,
      id,
      networkId: value.networkId,
      publicKeyX,
    };
  }
  const imported = value as ImportedAccountRef;
  return {
    ...contract,
    address,
    classHash,
    derivation: imported.derivation,
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
