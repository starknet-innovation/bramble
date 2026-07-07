/**
 * Versioned vault schema and validators for decrypted wallet state.
 */
import { hasOnlyKnownKeys, isJson, isRecord } from "../shared/json";
import { isWalletOrigin } from "../shared/origin";
import {
  isNonZeroStarkFieldElement,
  isStarknetNetworkId,
  type StarknetNetworkId,
} from "../starknet/networks";

/**
 * Current vault schema version accepted by validators and writers.
 */
export const CURRENT_SCHEMA_VERSION = 2;

/**
 * Public account metadata safe to expose to granted origins.
 */
export type AccountRef = {
  readonly address: string;
  readonly classHash: string;
  readonly derivation: {
    readonly accountIndex: number;
    readonly addressIndex: number;
    readonly kind: "starknet-bip44";
  };
  readonly id: string;
  readonly networkId: StarknetNetworkId;
  readonly publicKeyX: string;
  readonly publicKeyY: string;
};

/**
 * Encrypted-vault reference from an account id to its private key.
 */
export type SigningKeyRef = {
  readonly accountId: string;
  readonly privateKey: string;
};

/**
 * Origin permission grant scoped to selected account ids.
 */
export type OriginGrant = {
  readonly accountIds: readonly string[];
  readonly origin: string;
};

/**
 * Legacy vault schema without a retained recovery phrase. Only reachable
 * through migration; new writes always use the current schema.
 */
export type VaultV1 = {
  readonly accounts: readonly AccountRef[];
  readonly activeAccountId: string | null;
  readonly originGrants: readonly OriginGrant[];
  readonly schemaVersion: 1;
  readonly signingKeys: readonly SigningKeyRef[];
};

/**
 * Current encrypted vault schema. `mnemonic` retains the wallet recovery
 * phrase so more accounts can be derived and the phrase can be revealed after
 * re-authentication; it is `null` for vaults migrated from schema v1 (where
 * the phrase was never stored) so those wallets stay read-only for those
 * operations without failing closed.
 */
export type VaultV2 = {
  readonly accounts: readonly AccountRef[];
  readonly activeAccountId: string | null;
  readonly mnemonic: string | null;
  readonly originGrants: readonly OriginGrant[];
  readonly schemaVersion: 2;
  readonly signingKeys: readonly SigningKeyRef[];
};

/**
 * Alias for the latest supported vault schema.
 */
export type Vault = VaultV2;

const isSafeIndex = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

const isNonZeroFelt = (value: unknown): value is string =>
  typeof value === "string" && isNonZeroStarkFieldElement(value);

const isDerivation = (value: unknown): value is AccountRef["derivation"] =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["accountIndex", "addressIndex", "kind"]) &&
  value.kind === "starknet-bip44" &&
  isSafeIndex(value.accountIndex) &&
  isSafeIndex(value.addressIndex);

/**
 * Validates account ids used in public metadata and references.
 */
export const isAccountId = (value: unknown): value is string => {
  if (typeof value !== "string") {
    return false;
  }

  const parts = value.split(":");
  const networkId = parts[0];
  const address = parts[1];
  return parts.length === 2 && isStarknetNetworkId(networkId) && isNonZeroFelt(address);
};

/**
 * Validates public account metadata from decrypted vault data.
 */
export const isAccountRef = (value: unknown): value is AccountRef =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, [
    "address",
    "classHash",
    "derivation",
    "id",
    "networkId",
    "publicKeyX",
    "publicKeyY",
  ]) &&
  isNonZeroFelt(value.address) &&
  isNonZeroFelt(value.classHash) &&
  isDerivation(value.derivation) &&
  isAccountId(value.id) &&
  isStarknetNetworkId(value.networkId) &&
  value.id === `${value.networkId}:${value.address}` &&
  isNonZeroFelt(value.publicKeyX) &&
  isNonZeroFelt(value.publicKeyY);

const isSigningKeyRef = (value: unknown): value is SigningKeyRef =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["accountId", "privateKey"]) &&
  isAccountId(value.accountId) &&
  typeof value.privateKey === "string" &&
  isNonZeroStarkFieldElement(value.privateKey);

const isOriginGrant = (value: unknown): value is OriginGrant =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["accountIds", "origin"]) &&
  Array.isArray(value.accountIds) &&
  value.accountIds.length > 0 &&
  value.accountIds.every(isAccountId) &&
  typeof value.origin === "string" &&
  isWalletOrigin(value.origin);

const hasUniqueStrings = (values: readonly string[]): boolean =>
  new Set(values).size === values.length;

/**
 * Creates a deterministic empty current vault.
 */
export const emptyVault = (): VaultV2 => ({
  accounts: [],
  activeAccountId: null,
  mnemonic: null,
  originGrants: [],
  schemaVersion: CURRENT_SCHEMA_VERSION,
  signingKeys: [],
});

const isRetainedMnemonic = (value: unknown): value is string | null =>
  value === null || (typeof value === "string" && value.trim().length > 0);

const hasValidVaultReferences = (value: Record<string, unknown>): boolean => {
  if (
    (!isAccountId(value.activeAccountId) && value.activeAccountId !== null) ||
    !Array.isArray(value.accounts) ||
    !Array.isArray(value.originGrants) ||
    !Array.isArray(value.signingKeys)
  ) {
    return false;
  }

  const accounts = value.accounts;
  const originGrants = value.originGrants;
  const signingKeys = value.signingKeys;

  return (
    accounts.every(isAccountRef) &&
    hasUniqueStrings(accounts.map((account) => account.id)) &&
    originGrants.every(isOriginGrant) &&
    hasUniqueStrings(originGrants.map((grant) => grant.origin)) &&
    originGrants.every((grant) => hasUniqueStrings(grant.accountIds)) &&
    originGrants.every((grant) =>
      grant.accountIds.every((accountId) => accounts.some((account) => account.id === accountId)),
    ) &&
    signingKeys.every(isSigningKeyRef) &&
    hasUniqueStrings(signingKeys.map((key) => key.accountId)) &&
    signingKeys.every((key) => accounts.some((account) => account.id === key.accountId)) &&
    accounts.every((account) => signingKeys.some((key) => key.accountId === account.id)) &&
    (accounts.length === 0
      ? value.activeAccountId === null
      : value.activeAccountId !== null &&
        accounts.some((account) => account.id === value.activeAccountId))
  );
};

/**
 * Validates the legacy schema-v1 vault used only as a migration source.
 */
export const isVaultV1 = (value: unknown): value is VaultV1 =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, [
    "accounts",
    "activeAccountId",
    "originGrants",
    "schemaVersion",
    "signingKeys",
  ]) &&
  value.schemaVersion === 1 &&
  hasValidVaultReferences(value);

/**
 * Validates the current vault schema and internal references.
 */
export const isVaultV2 = (value: unknown): value is VaultV2 =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, [
    "accounts",
    "activeAccountId",
    "mnemonic",
    "originGrants",
    "schemaVersion",
    "signingKeys",
  ]) &&
  value.schemaVersion === CURRENT_SCHEMA_VERSION &&
  isRetainedMnemonic(value.mnemonic) &&
  hasValidVaultReferences(value);
