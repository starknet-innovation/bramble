/**
 * Encrypted, account-scoped optional secret records. This module defines only
 * vault-internal data: none of these types may enter public account projections,
 * extension messages, preferences, activity, or UI state.
 */
import { hasOnlyKnownKeys, hasUniqueStrings, isRecord } from "@mc-wallet/core/json";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  isStarkPrivateKey,
  STARKNET_NETWORKS,
  type StarknetNetworkId,
  sameFelt,
} from "@mc-wallet/wallet-model/networks";

type AccountSecretOwner = {
  readonly derivation: { readonly kind: string };
  readonly id: string;
  readonly networkId: StarknetNetworkId;
};

/**
 * Versioned provenance for a cached Ledger STRK20 viewing key. The future
 * hardware ceremony must bind its typed data to the account, chain, pool, and
 * this exact scheme before it may write the resulting key.
 */
export const LEDGER_STRK20_VIEWING_KEY_SCHEME = "ledger-strk20-typed-data-v1";

/**
 * Maximum retained pool-scoped Ledger viewing keys for one account.
 */
export const MAX_LEDGER_STRK20_VIEWING_KEYS = 8;

/**
 * One Ledger-derived STRK20 viewing key, scoped to exactly one chain and pool.
 * `viewingKey` is sensitive metadata even though it cannot authorize spends.
 */
export type LedgerStrk20ViewingKeyRef = {
  readonly chainId: string;
  readonly poolAddress: string;
  readonly scheme: typeof LEDGER_STRK20_VIEWING_KEY_SCHEME;
  readonly viewingKey: string;
};

/**
 * Optional encrypted secrets owned by one public account id. A record exists
 * only when that account has retained optional material.
 */
export type AccountSecretRef = {
  readonly accountId: string;
  readonly ledgerStrk20ViewingKeys: readonly LedgerStrk20ViewingKeyRef[];
};

/**
 * Canonical chain/pool scope accepted for one Ledger account.
 */
export type LedgerStrk20Scope = {
  readonly chainId: string;
  readonly poolAddress: string;
};

const isCanonicalNonZeroFelt = (value: unknown): value is string =>
  typeof value === "string" && isNonZeroStarkFieldElement(value) && canonicalFelt(value) === value;

const isLedgerStrk20ViewingKeyRef = (value: unknown): value is LedgerStrk20ViewingKeyRef =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["chainId", "poolAddress", "scheme", "viewingKey"]) &&
  isCanonicalNonZeroFelt(value["chainId"]) &&
  isCanonicalNonZeroFelt(value["poolAddress"]) &&
  value["scheme"] === LEDGER_STRK20_VIEWING_KEY_SCHEME &&
  typeof value["viewingKey"] === "string" &&
  isStarkPrivateKey(value["viewingKey"]) &&
  canonicalFelt(value["viewingKey"]) === value["viewingKey"];

const viewingKeyScope = (value: LedgerStrk20ViewingKeyRef): string =>
  `${value.chainId}:${value.poolAddress}`;

/**
 * Canonicalizes and validates a requested viewing-key scope against a Ledger
 * account and its configured network.
 */
export const ledgerStrk20ScopeFor = (
  account: AccountSecretOwner,
  chainIdInput: string,
  poolAddressInput: string,
): LedgerStrk20Scope | null => {
  const chainId = canonicalFelt(chainIdInput);
  const poolAddress = canonicalFelt(poolAddressInput);
  return account.derivation.kind === "ledger" &&
    chainId !== null &&
    poolAddress !== null &&
    isNonZeroStarkFieldElement(chainId) &&
    isNonZeroStarkFieldElement(poolAddress) &&
    sameFelt(chainId, STARKNET_NETWORKS[account.networkId].chainId)
    ? { chainId, poolAddress }
    : null;
};

/**
 * Validates the shape and internal scope uniqueness of one encrypted optional
 * secret record. Account ownership is checked separately against the vault.
 */
export const isAccountSecretRef = (value: unknown): value is AccountSecretRef =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["accountId", "ledgerStrk20ViewingKeys"]) &&
  typeof value["accountId"] === "string" &&
  Array.isArray(value["ledgerStrk20ViewingKeys"]) &&
  value["ledgerStrk20ViewingKeys"].length > 0 &&
  value["ledgerStrk20ViewingKeys"].length <= MAX_LEDGER_STRK20_VIEWING_KEYS &&
  value["ledgerStrk20ViewingKeys"].every(isLedgerStrk20ViewingKeyRef) &&
  hasUniqueStrings(value["ledgerStrk20ViewingKeys"].map(viewingKeyScope));

/**
 * Enforces vault cross-references: optional viewing keys belong only to a
 * retained Ledger account and their chain must match that account's network.
 */
export const hasValidAccountSecretBindings = (
  accounts: readonly AccountSecretOwner[],
  accountSecrets: readonly AccountSecretRef[],
): boolean =>
  accountSecrets.every((secret) => {
    const account = accounts.find((candidate) => candidate.id === secret.accountId);
    return (
      account?.derivation.kind === "ledger" &&
      secret.ledgerStrk20ViewingKeys.every((key) =>
        sameFelt(key.chainId, STARKNET_NETWORKS[account.networkId].chainId),
      )
    );
  });

/**
 * Returns the retained Ledger viewing key for an exact numeric chain/pool
 * scope, or null. The key remains inside the privileged vault boundary.
 */
export const ledgerStrk20ViewingKeyFor = (
  accountSecrets: readonly AccountSecretRef[],
  accountId: string,
  chainId: string,
  poolAddress: string,
): string | null =>
  accountSecrets
    .find((secret) => secret.accountId === accountId)
    ?.ledgerStrk20ViewingKeys.find(
      (key) => sameFelt(key.chainId, chainId) && sameFelt(key.poolAddress, poolAddress),
    )?.viewingKey ?? null;

/**
 * Upserts one canonical, scope-bound Ledger viewing key without disturbing
 * secrets owned by any other account or pool. Invalid input fails closed.
 */
export const withLedgerStrk20ViewingKey = (
  accountSecrets: readonly AccountSecretRef[],
  next: AccountSecretRef & {
    readonly ledgerStrk20ViewingKeys: readonly [LedgerStrk20ViewingKeyRef];
  },
): readonly AccountSecretRef[] | null => {
  if (!isAccountSecretRef(next)) {
    return null;
  }
  const existing = accountSecrets.find((secret) => secret.accountId === next.accountId);
  const addition = next.ledgerStrk20ViewingKeys[0];
  const retained =
    existing?.ledgerStrk20ViewingKeys.filter(
      (key) =>
        !sameFelt(key.chainId, addition.chainId) ||
        !sameFelt(key.poolAddress, addition.poolAddress),
    ) ?? [];
  if (retained.length === MAX_LEDGER_STRK20_VIEWING_KEYS) {
    return null;
  }
  const keys = [...retained, addition];
  const record: AccountSecretRef = {
    accountId: next.accountId,
    ledgerStrk20ViewingKeys: keys,
  };
  return [...accountSecrets.filter((secret) => secret.accountId !== next.accountId), record];
};

/**
 * Removes one exact Ledger viewing-key scope. Empty account-secret records are
 * removed instead of retaining ambiguous placeholders.
 */
export const withoutLedgerStrk20ViewingKey = (
  accountSecrets: readonly AccountSecretRef[],
  accountId: string,
  chainId: string,
  poolAddress: string,
): readonly AccountSecretRef[] =>
  accountSecrets.flatMap((secret) => {
    if (secret.accountId !== accountId) {
      return [secret];
    }
    const ledgerStrk20ViewingKeys = secret.ledgerStrk20ViewingKeys.filter(
      (key) => !sameFelt(key.chainId, chainId) || !sameFelt(key.poolAddress, poolAddress),
    );
    return ledgerStrk20ViewingKeys.length > 0 ? [{ ...secret, ledgerStrk20ViewingKeys }] : [];
  });
