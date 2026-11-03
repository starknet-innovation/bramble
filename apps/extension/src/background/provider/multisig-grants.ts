/**
 * Encrypted record of which multisigs a site may see. Origin grants for
 * single-signer accounts stay in the vault. This ledger is a separate
 * encrypted blob so a multisig id, which is not a vault account, never has to
 * enter that schema. A locked session cannot read it. Downgrade-safe: an older
 * build ignores the key and the vault still opens.
 */

import { WalletError } from "@bramble/core/errors";
import { hasOnlyKnownKeys, isJson, isRecord } from "@bramble/core/json";
import { type ConnectedSite, isWalletOrigin } from "@bramble/core/origin";
import type { EncryptedStore } from "@bramble/vault/encrypted-store";
import { isAccountId } from "@bramble/wallet-model/accounts";

/**
 * Storage key for the encrypted multisig-origin ledger.
 */
export const MULTISIG_ORIGIN_GRANTS_KEY = "bramble:multisig-origin-grants";

type OriginGrant = {
  readonly multisigIds: readonly string[];
  readonly origin: string;
};

type GrantDocument = {
  readonly grants: readonly OriginGrant[];
  readonly schemaVersion: 1;
};

/**
 * Privileged ledger of multisig connection grants. `credential` is the vault
 * unlock secret; callers already hold it and this module only forwards it to
 * the encrypted store.
 */
export type MultisigOriginGrantStore = {
  readonly clear: () => Promise<void>;
  readonly clearKeys: () => void;
  readonly grant: (input: {
    readonly credential: string;
    readonly isAuthorized: () => boolean;
    readonly multisigId: string;
    readonly origin: string;
  }) => Promise<void>;
  readonly idsFor: (origin: string, credential: string) => Promise<readonly string[]>;
  readonly revoke: (origin: string, credential: string) => Promise<void>;
  readonly sites: (credential: string) => Promise<readonly ConnectedSite[]>;
};

const emptyDocument = (): GrantDocument => ({ grants: [], schemaVersion: 1 });

const isGrant = (value: unknown): value is OriginGrant =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["multisigIds", "origin"]) &&
  typeof value["origin"] === "string" &&
  isWalletOrigin(value["origin"]) &&
  Array.isArray(value["multisigIds"]) &&
  value["multisigIds"].length > 0 &&
  value["multisigIds"].every((id) => isAccountId(id));

const parseDocument = (value: unknown): GrantDocument | null => {
  if (!isRecord(value) || !isJson(value) || !hasOnlyKnownKeys(value, ["grants", "schemaVersion"])) {
    return null;
  }
  if (value["schemaVersion"] !== 1 || !Array.isArray(value["grants"])) return null;
  if (!value["grants"].every(isGrant)) return null;
  const origins = value["grants"].map((grant) => grant.origin);
  if (new Set(origins).size !== origins.length) return null;
  return value as GrantDocument;
};

const byOrigin = (left: ConnectedSite, right: ConnectedSite): number =>
  left.origin < right.origin ? -1 : left.origin > right.origin ? 1 : 0;

/**
 * In-memory ledger for tests and for a worker with no browser storage.
 */
export const memoryMultisigGrantStore = (): MultisigOriginGrantStore => {
  let ledger = emptyDocument();
  const read = (): GrantDocument => ledger;
  const write = (next: GrantDocument, isAuthorized?: () => boolean): void => {
    if (isAuthorized && !isAuthorized()) throw new WalletError("wallet locked");
    ledger = next;
  };
  return {
    async clear() {
      ledger = emptyDocument();
    },
    clearKeys() {
      // Nothing derived is cached in memory.
    },
    async grant(input) {
      if (!input.isAuthorized()) throw new WalletError("wallet locked");
      const current = read();
      const rest = current.grants.filter((grant) => grant.origin !== input.origin);
      const existing = current.grants.find((grant) => grant.origin === input.origin);
      const multisigIds = [...new Set([...(existing?.multisigIds ?? []), input.multisigId])];
      write(
        { grants: [...rest, { multisigIds, origin: input.origin }], schemaVersion: 1 },
        input.isAuthorized,
      );
    },
    async idsFor(origin) {
      return read().grants.find((grant) => grant.origin === origin)?.multisigIds ?? [];
    },
    async revoke(origin) {
      ledger = {
        grants: ledger.grants.filter((grant) => grant.origin !== origin),
        schemaVersion: 1,
      };
    },
    async sites() {
      return read()
        .grants.map((grant) => ({ accountCount: grant.multisigIds.length, origin: grant.origin }))
        .sort(byOrigin);
    },
  };
};

const readEncrypted = async (store: EncryptedStore, credential: string): Promise<GrantDocument> => {
  try {
    const value = await store.read(credential);
    if (value === undefined) return emptyDocument();
    return parseDocument(value) ?? emptyDocument();
  } catch {
    // An unreadable blob (a previous vault's ciphertext, a torn write) grants
    // nothing. The next successful grant replaces it.
    return emptyDocument();
  }
};

/**
 * Encrypts the ledger with the vault unlock secret. `clearKeys` drops the
 * derived key and must run on lock beside the vault store.
 */
export const encryptedMultisigGrantStore = (store: EncryptedStore): MultisigOriginGrantStore => ({
  async clear() {
    await store.remove();
  },
  clearKeys() {
    store.clearKeys();
  },
  async grant(input) {
    if (!input.isAuthorized()) throw new WalletError("wallet locked");
    if (!isWalletOrigin(input.origin) || !isAccountId(input.multisigId)) {
      throw new WalletError("Invalid multisig grant");
    }
    const current = await readEncrypted(store, input.credential);
    const rest = current.grants.filter((grant) => grant.origin !== input.origin);
    const existing = current.grants.find((grant) => grant.origin === input.origin);
    const multisigIds = [...new Set([...(existing?.multisigIds ?? []), input.multisigId])];
    const next: GrantDocument = {
      grants: [...rest, { multisigIds, origin: input.origin }],
      schemaVersion: 1,
    };
    await store.write(next, input.credential, () => {
      if (!input.isAuthorized()) throw new WalletError("wallet locked");
    });
  },
  async idsFor(origin, credential) {
    const ledger = await readEncrypted(store, credential);
    return ledger.grants.find((grant) => grant.origin === origin)?.multisigIds ?? [];
  },
  async revoke(origin, credential) {
    const current = await readEncrypted(store, credential);
    const grants = current.grants.filter((grant) => grant.origin !== origin);
    if (grants.length === current.grants.length) return;
    await store.write({ grants, schemaVersion: 1 }, credential);
  },
  async sites(credential) {
    const ledger = await readEncrypted(store, credential);
    return ledger.grants
      .map((grant) => ({ accountCount: grant.multisigIds.length, origin: grant.origin }))
      .sort(byOrigin);
  },
});

/**
 * Merges single-signer and multisig connected-site rows. An origin present in
 * both is one row whose count is the sum.
 */
export const mergeConnectedSites = (
  vaultSites: readonly ConnectedSite[],
  multisigSites: readonly ConnectedSite[],
): readonly ConnectedSite[] => {
  const counts = new Map<string, number>();
  for (const site of [...vaultSites, ...multisigSites]) {
    counts.set(site.origin, (counts.get(site.origin) ?? 0) + site.accountCount);
  }
  return [...counts.entries()]
    .map(([origin, accountCount]) => ({ accountCount, origin }))
    .sort(byOrigin);
};
