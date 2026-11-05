/**
 * Legacy vault type declarations (schemas v1–v12) and the shared reference
 * shapes they build on, split from schema.ts on the size budget. Types only —
 * every validator stays beside the current schema in schema.ts.
 */
import type {
  AccountRef,
  LegacyAccountRef,
  LegacyV6AccountRef,
} from "@bramble/wallet-model/accounts";
import type { AccountSecretRef } from "../accounts/account-secrets";
import type { ShadowAccountScopeRef } from "../accounts/shadow-account-scopes";
import type { ImportedSeedRef } from "./schema-seeds";

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
  readonly accounts: readonly LegacyAccountRef[];
  readonly activeAccountId: string | null;
  readonly originGrants: readonly OriginGrant[];
  readonly schemaVersion: 1;
  readonly signingKeys: readonly SigningKeyRef[];
};

/**
 * Legacy schema-v2 vault, reachable only through migration. Its accounts are
 * key-backed only (`starknet-bip44` or `imported-raw-key`); a keyless Ledger
 * account is invalid at this version. `mnemonic` retains the recovery phrase
 * (null for vaults migrated from v1). New writes always use {@link VaultV4}.
 */
export type VaultV2 = {
  readonly accounts: readonly LegacyAccountRef[];
  readonly activeAccountId: string | null;
  readonly mnemonic: string | null;
  readonly originGrants: readonly OriginGrant[];
  readonly schemaVersion: 2;
  readonly signingKeys: readonly SigningKeyRef[];
};

/**
 * Legacy schema-v3 vault. Identical in shape to v2 but its accounts may
 * include the keyless {@link LedgerAccountRef} variant, so the account↔signingKey
 * bijection is relaxed to require a key for every non-Ledger account only.
 *
 * `mnemonic` is `null` when the vault retains no recovery phrase. That covers two
 * cases and needs no shape change beyond v2: a vault migrated from schema v1
 * (where the phrase was never stored, so its seed accounts stay signable through
 * their retained keys but phrase-dependent operations are read-only), and a
 * Ledger-only wallet created with no seed material at all. The phrase-coverage
 * rule is enforced at the mutation boundary, not the schema: `addDerivedAccount`
 * refuses to derive a new HD account when `mnemonic` is null (it has nothing to
 * derive from), and `createLedgerVault` only ever writes null over a fresh store.
 * The grandfathered legacy null-with-seed shape stays valid at this schema so
 * those v1-migrated wallets never fail closed — which is exactly why the coverage
 * rule cannot be a validator invariant.
 */
export type VaultV3 = {
  readonly accounts: readonly LegacyAccountRef[];
  readonly activeAccountId: string | null;
  readonly mnemonic: string | null;
  readonly originGrants: readonly OriginGrant[];
  readonly schemaVersion: 3;
  readonly signingKeys: readonly SigningKeyRef[];
};

/**
 * Current encrypted vault schema. Optional account secrets are deliberately
 * separate from {@link AccountRef}: account metadata is safe to project to the
 * UI and granted origins, while this collection never leaves the privileged
 * encrypted-vault boundary. An account has no record until it retains an
 * optional secret.
 */
export type VaultV4 = {
  readonly accounts: readonly LegacyAccountRef[];
  readonly accountSecrets: readonly AccountSecretRef[];
  readonly activeAccountId: string | null;
  readonly mnemonic: string | null;
  readonly originGrants: readonly OriginGrant[];
  readonly schemaVersion: 4;
  readonly signingKeys: readonly SigningKeyRef[];
};

/**
 * Current encrypted vault schema. Version 5 makes every account identity and
 * public-key felt canonical so aliases cannot survive as distinct records.
 */
export type VaultV5 = Omit<VaultV4, "schemaVersion"> & { readonly schemaVersion: 5 };

/**
 * Current encrypted vault schema. Every account carries explicit contract
 * semantics; historical accounts migrate deterministically to OpenZeppelin.
 */
export type VaultV6 = Omit<VaultV4, "accounts" | "schemaVersion"> & {
  readonly accounts: readonly LegacyV6AccountRef[];
  readonly schemaVersion: 6;
};

/**
 * Current encrypted vault schema. Argent accounts retain the exact deployment
 * salt so externally created accounts remain deployable at their real address.
 */
export type VaultV7 = Omit<VaultV4, "accounts" | "schemaVersion"> & {
  readonly accounts: readonly AccountRef[];
  readonly schemaVersion: 7;
};

/**
 * Legacy encrypted vault schema. Version 8 retains imported seeds so accounts
 * recovered from another wallet's phrase stay re-derivable and revealable; its
 * Ledger derivations may only follow Bramble's `LedgerW` scheme.
 */
export type VaultV8 = Omit<VaultV7, "schemaVersion"> & {
  readonly importedSeeds: readonly ImportedSeedRef[];
  readonly schemaVersion: 8;
};

/**
 * Schema-v9 vault, accepted only by the adjacent v10 migration. Admits a Ledger
 * derivation under Ready's `argentx` path scheme beside Bramble's `LedgerW`; the
 * record shape is unchanged from v8.
 */
export type VaultV9 = Omit<VaultV8, "schemaVersion"> & { readonly schemaVersion: 9 };

/**
 * Current encrypted vault schema. Version 10 admits Braavos accounts, and Argent
 * accounts at any release they could have been deployed with; the record shape
 * is unchanged, only the values a record may hold have widened.
 */
export type VaultV10 = Omit<VaultV9, "schemaVersion"> & { readonly schemaVersion: 10 };

/**
 * Schema-v11 vault, accepted only by the adjacent v12 migration. Version 11
 * admits accounts derived with Ready's ETH-seeded scheme (`argentx-bip44`,
 * issue 505); the record shape is unchanged from v10.
 */
export type VaultV11 = Omit<VaultV10, "schemaVersion"> & { readonly schemaVersion: 11 };

/**
 * Schema-v12 vault, accepted only by the adjacent v13 migration. Version 12
 * adds the shadow-account scope records (#443): which sites, labels, and exact nonces each account drove a
 * shadow account through, so the wallet can find and sweep funds a site left.
 * They reveal which sites someone used privately and so live only here.
 */
export type VaultV12 = Omit<VaultV11, "schemaVersion"> & {
  readonly schemaVersion: 12;
  readonly shadowAccountScopes: readonly ShadowAccountScopeRef[];
};
