/**
 * Encrypted records of the STRK20 shadow-account scopes a wallet account has
 * used (#443, PR 5). A shadow account is bound to one site: only this wallet,
 * deriving the scope from that origin and the site's label, can drive it. If
 * the site disappears, or a `diff`/`exact` collect policy leaves a remainder,
 * the funds are stuck unless the wallet remembers which scopes and nonces it
 * used — dapps choose nonces, so the exact nonces are kept, not a maximum.
 *
 * The record reveals which sites someone used privately. It is vault-internal
 * data: it must never enter preferences, account projections, activity, logs,
 * session storage, or messages beyond the privileged panel's own view of it.
 */
import {
  hasOnlyKnownKeys,
  hasUniqueStrings,
  isJsonWithinBudget,
  isRecord,
  JSON_BUDGETS,
  type JsonBudget,
} from "@bramble/core/json";
import { isWalletOrigin } from "@bramble/core/origin";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
  STARKNET_NETWORKS,
  type StarknetNetworkId,
  sameFelt,
} from "@bramble/wallet-model/networks";

/**
 * Stable error code: a scope or nonce bound refuses a new record (never an
 * eviction). A code, not copy; pinned by a test so the panel's curated error
 * copy can map it with one entry.
 */
export const SHADOW_ACCOUNT_RECORD_LIMIT = "shadow account record limit reached";

/** Stable error code: a malformed scope, or one on another account's chain. */
export const SHADOW_ACCOUNT_RECORD_INVALID = "invalid shadow account record";

/**
 * The share of the vault's capacity (the provider JSON budget its validators
 * apply) the scope records may use together: half, so the records can never
 * push the vault past its budget, and accounts, keys and grants always keep
 * the other half. Dapps choose nonces, and 128 scopes of 64 full-width nonces
 * would need about four times the whole budget, so this byte share is the
 * binding bound; the count caps below only bound validator work (release audit
 * S1). A record past it is refused, never evicted.
 */
export const SHADOW_ACCOUNT_SCOPES_BUDGET: JsonBudget = {
  ...JSON_BUDGETS.provider,
  maxBytes: Math.floor(JSON_BUDGETS.provider.maxBytes / 2),
};

/** Most scope records one vault keeps; a further scope is refused, never evicted. */
export const MAX_SHADOW_ACCOUNT_SCOPES = 128;

/** Most exact nonces one scope keeps; a further nonce is refused, never evicted. */
export const MAX_SHADOW_ACCOUNT_NONCES = 64;

/**
 * One (account, chain, pool, anonymizer, origin, label) scope and the exact
 * nonces used under it. `label` is the site's own scope label exactly as it
 * sent it; the shadow-account identity is derived from `origin` and `label`
 * together. `nonces` is empty when only the partial commitment was shared.
 */
export type ShadowAccountScopeRef = {
  readonly accountId: string;
  readonly anonymizer: string;
  readonly chainId: string;
  readonly label: string;
  readonly nonces: readonly string[];
  readonly origin: string;
  readonly poolAddress: string;
};

type ScopeOwner = { readonly id: string; readonly networkId: StarknetNetworkId };

const isCanonicalNonZeroFelt = (value: unknown): value is string =>
  typeof value === "string" && isNonZeroStarkFieldElement(value) && canonicalFelt(value) === value;

const isCanonicalFelt = (value: unknown): value is string =>
  typeof value === "string" && isStarkFieldElement(value) && canonicalFelt(value) === value;

// The wire grammar (`isStrk20DappName`: one felt, or printable ASCII up to 31
// bytes) lives in wallet-protocol, which the vault does not depend on. This is
// its printable-ASCII superset, bounded by the longest felt spelling: the
// writer only ever stores a label that grammar already admitted.
const isScopeLabel = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 66 &&
  /^[\x20-\x7e]+$/.test(value);

const ascending = (left: string, right: string): number => {
  const difference = BigInt(left) - BigInt(right);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
};

const isScopeRef = (value: unknown): value is ShadowAccountScopeRef =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, [
    "accountId",
    "anonymizer",
    "chainId",
    "label",
    "nonces",
    "origin",
    "poolAddress",
  ]) &&
  typeof value["accountId"] === "string" &&
  isCanonicalNonZeroFelt(value["anonymizer"]) &&
  isCanonicalNonZeroFelt(value["chainId"]) &&
  isScopeLabel(value["label"]) &&
  typeof value["origin"] === "string" &&
  isWalletOrigin(value["origin"]) &&
  isCanonicalNonZeroFelt(value["poolAddress"]) &&
  Array.isArray(value["nonces"]) &&
  value["nonces"].length <= MAX_SHADOW_ACCOUNT_NONCES &&
  value["nonces"].every(isCanonicalFelt) &&
  hasUniqueStrings(value["nonces"]) &&
  value["nonces"].every(
    (nonce, index, nonces) => index === 0 || ascending(nonces[index - 1] ?? "0x0", nonce) < 0,
  );

const scopeKey = (scope: Omit<ShadowAccountScopeRef, "nonces">): string =>
  [
    scope.accountId,
    scope.chainId,
    scope.poolAddress,
    scope.anonymizer,
    scope.origin,
    scope.label,
  ].join("|");

/**
 * Validates the whole collection against the vault's accounts: every record is
 * well formed and canonical, belongs to a retained account on that account's
 * own chain, and names a distinct scope. Fails closed on anything else.
 */
export const hasValidShadowAccountScopes = (
  accounts: readonly ScopeOwner[],
  scopes: unknown,
): scopes is readonly ShadowAccountScopeRef[] =>
  Array.isArray(scopes) &&
  scopes.length <= MAX_SHADOW_ACCOUNT_SCOPES &&
  scopes.every(isScopeRef) &&
  hasUniqueStrings(scopes.map(scopeKey)) &&
  scopes.every((scope) => {
    const account = accounts.find((candidate) => candidate.id === scope.accountId);
    return (
      account !== undefined && sameFelt(scope.chainId, STARKNET_NETWORKS[account.networkId].chainId)
    );
  });

/**
 * Canonicalizes one scope to record, or null when any field is malformed. The
 * nonces are deduplicated and sorted so the stored record is deterministic.
 */
export const canonicalShadowAccountScope = (
  input: ShadowAccountScopeRef,
): ShadowAccountScopeRef | null => {
  const anonymizer = canonicalFelt(input.anonymizer);
  const chainId = canonicalFelt(input.chainId);
  const poolAddress = canonicalFelt(input.poolAddress);
  const nonces = input.nonces.map(canonicalFelt);
  if (
    anonymizer === null ||
    chainId === null ||
    poolAddress === null ||
    nonces.some((nonce) => nonce === null)
  ) {
    return null;
  }
  const scope: ShadowAccountScopeRef = {
    accountId: input.accountId,
    anonymizer,
    chainId,
    label: input.label,
    nonces: [...new Set(nonces as string[])].sort(ascending),
    origin: input.origin,
    poolAddress,
  };
  return isScopeRef(scope) ? scope : null;
};

/**
 * Merges one canonical scope into the collection: a new scope is appended, an
 * existing one gains the nonces it did not hold. Returns the same reference
 * when nothing changes (so the caller skips the write), or null when the
 * result would exceed a count bound or {@link SHADOW_ACCOUNT_SCOPES_BUDGET} —
 * the caller refuses rather than drop a record.
 */
export const withShadowAccountScope = (
  scopes: readonly ShadowAccountScopeRef[],
  next: ShadowAccountScopeRef,
): readonly ShadowAccountScopeRef[] | null => {
  const key = scopeKey(next);
  const existing = scopes.find((scope) => scopeKey(scope) === key);
  if (!existing) {
    return scopes.length >= MAX_SHADOW_ACCOUNT_SCOPES ? null : withinShare([...scopes, next]);
  }
  const nonces = [...new Set([...existing.nonces, ...next.nonces])].sort(ascending);
  if (nonces.length === existing.nonces.length) {
    return scopes;
  }
  if (nonces.length > MAX_SHADOW_ACCOUNT_NONCES) {
    return null;
  }
  return withinShare(
    scopes.map((scope) => (scopeKey(scope) === key ? { ...scope, nonces } : scope)),
  );
};

const withinShare = (
  scopes: readonly ShadowAccountScopeRef[],
): readonly ShadowAccountScopeRef[] | null =>
  isJsonWithinBudget(scopes, SHADOW_ACCOUNT_SCOPES_BUDGET) ? scopes : null;

/** The recorded scopes for one account on one chain and pool, in record order. */
export const shadowAccountScopesFor = (
  scopes: readonly ShadowAccountScopeRef[],
  accountId: string,
  chainId: string,
  poolAddress: string,
): readonly ShadowAccountScopeRef[] =>
  scopes.filter(
    (scope) =>
      scope.accountId === accountId &&
      sameFelt(scope.chainId, chainId) &&
      sameFelt(scope.poolAddress, poolAddress),
  );
