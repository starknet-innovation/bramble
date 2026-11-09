/**
 * Legacy vault type declarations (schemas v1–v3) and the shared reference
 * shapes they build on, split from schema.ts on the size budget. Types only —
 * every validator stays beside the current schema in schema.ts.
 */
import type { LegacyAccountRef } from "@bramble/wallet-model/accounts";

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
