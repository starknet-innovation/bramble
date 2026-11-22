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
  /**
   * Drops a removed multisig from every site, so re-adding it later does not
   * reconnect anything. Throws, changing nothing, when the ledger can't be read.
   */
  readonly removeAccount: (input: {
    readonly credential: string;
    readonly isAuthorized: () => boolean;
    readonly multisigId: string;
  }) => Promise<void>;
  /**
   * Drops `origin`'s multisig grant, or only `multisigId` from it when given
   * (the site goes once none remain). Only removes; an id the site was not
   * granted changes nothing. Throws, changing nothing, when the ledger can't
   * be read.
   */
  readonly revoke: (origin: string, credential: string, multisigId?: string) => Promise<void>;
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

const requireAuthorized = (isAuthorized: () => boolean): void => {
  if (!isAuthorized()) throw new WalletError("wallet locked");
};

const withGrantedId = (
  current: GrantDocument,
  origin: string,
  multisigId: string,
): GrantDocument => {
  const rest = current.grants.filter((grant) => grant.origin !== origin);
  const existing = current.grants.find((grant) => grant.origin === origin);
  const multisigIds = [...new Set([...(existing?.multisigIds ?? []), multisigId])];
  return { grants: [...rest, { multisigIds, origin }], schemaVersion: 1 };
};

/** What a grant or revoke reports when the ledger can't be read. */
export const GRANTS_UNREADABLE = "Couldn't read your connected sites. Try again.";

const withoutId = (current: GrantDocument, multisigId: string): GrantDocument => ({
  grants: current.grants
    .map((grant) => ({
      ...grant,
      multisigIds: grant.multisigIds.filter((id) => id !== multisigId),
    }))
    .filter((grant) => grant.multisigIds.length > 0),
  schemaVersion: 1,
});

const withoutOriginAccess = (
  current: GrantDocument,
  origin: string,
  multisigId?: string,
): GrantDocument => ({
  grants: current.grants
    .map((grant) =>
      grant.origin !== origin
        ? grant
        : {
            ...grant,
            multisigIds:
              multisigId === undefined ? [] : grant.multisigIds.filter((id) => id !== multisigId),
          },
    )
    .filter((grant) => grant.multisigIds.length > 0),
  schemaVersion: 1,
});

// Both removals only remove, so an unchanged count means nothing to write.
const idCount = (ledger: GrantDocument): number =>
  ledger.grants.reduce((total, grant) => total + grant.multisigIds.length, 0);

const byOrigin = (left: ConnectedSite, right: ConnectedSite): number =>
  left.origin < right.origin ? -1 : left.origin > right.origin ? 1 : 0;

const sitesOf = (ledger: GrantDocument): readonly ConnectedSite[] =>
  ledger.grants
    .map((grant) => ({
      accountCount: grant.multisigIds.length,
      accountIds: [],
      multisigIds: [...grant.multisigIds],
      origin: grant.origin,
    }))
    .sort(byOrigin);

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
    async removeAccount(input) {
      write(withoutId(read(), input.multisigId), input.isAuthorized);
    },
    async revoke(origin, _credential, multisigId) {
      ledger = withoutOriginAccess(ledger, origin, multisigId);
    },
    async sites() {
      return sitesOf(read());
    },
  };
};

// No blob, or one that doesn't parse, grants nothing. A read or decrypt
// failure throws: a write built from it could claim a revoke it never stored,
// or drop every other site's grant.
const readForWrite = async (store: EncryptedStore, credential: string): Promise<GrantDocument> => {
  let value: unknown;
  try {
    value = await store.read(credential);
  } catch {
    throw new WalletError(GRANTS_UNREADABLE);
  }
  if (value === undefined) return emptyDocument();
  return parseDocument(value) ?? emptyDocument();
};

// Read-only callers fail closed: an unreadable ledger grants nothing.
const readEncrypted = (store: EncryptedStore, credential: string): Promise<GrantDocument> =>
  readForWrite(store, credential).catch(() => emptyDocument());

/**
 * Encrypts the ledger with the vault unlock secret. `clearKeys` drops the
 * derived key and must run on lock beside the vault store.
 */
export const encryptedMultisigGrantStore = (store: EncryptedStore): MultisigOriginGrantStore => {
  let pending: Promise<unknown> = Promise.resolve();
  const serialize = <T>(run: () => Promise<T>): Promise<T> => {
    const next = pending.then(run, run);
    pending = next.catch(() => undefined);
    return next;
  };
  return {
    clear: () => serialize(() => store.remove()),
    clearKeys() {
      store.clearKeys();
    },
    grant: (input) =>
      serialize(async () => {
        requireAuthorized(input.isAuthorized);
        if (!isWalletOrigin(input.origin) || !isAccountId(input.multisigId)) {
          throw new WalletError("Invalid multisig grant");
        }
        const current = await readForWrite(store, input.credential);
        requireAuthorized(input.isAuthorized);
        const next = withGrantedId(current, input.origin, input.multisigId);
        // Re-checked after encryption, right before the commit starts. A lock during
        // the storage writes themselves is rolled back to the pre-grant snapshot,
        // the same window the vault origin grant closes (Sherlock 255).
        await store.write(next, input.credential, () => {
          requireAuthorized(input.isAuthorized);
        });
        if (input.isAuthorized()) return;
        await store.write(current, input.credential);
        throw new WalletError("wallet locked");
      }),
    async idsFor(origin, credential) {
      const ledger = await readEncrypted(store, credential);
      return ledger.grants.find((grant) => grant.origin === origin)?.multisigIds ?? [];
    },
    removeAccount: (input) =>
      serialize(async () => {
        requireAuthorized(input.isAuthorized);
        const current = await readForWrite(store, input.credential);
        requireAuthorized(input.isAuthorized);
        const next = withoutId(current, input.multisigId);
        if (idCount(next) === idCount(current)) return;
        await store.write(next, input.credential, () => {
          requireAuthorized(input.isAuthorized);
        });
      }),
    revoke: (origin, credential, multisigId) =>
      serialize(async () => {
        const current = await readForWrite(store, credential);
        const next = withoutOriginAccess(current, origin, multisigId);
        if (idCount(next) === idCount(current)) return;
        await store.write(next, credential);
      }),
    async sites(credential) {
      return sitesOf(await readEncrypted(store, credential));
    },
  };
};

/**
 * Merges single-signer and multisig connected-site rows. An origin present in
 * both is one row carrying both id lists, whose count is the sum.
 */
export const mergeConnectedSites = (
  vaultSites: readonly ConnectedSite[],
  multisigSites: readonly ConnectedSite[],
): readonly ConnectedSite[] => {
  const merged = new Map<string, ConnectedSite>();
  for (const site of [...vaultSites, ...multisigSites]) {
    const existing = merged.get(site.origin);
    merged.set(
      site.origin,
      existing
        ? {
            accountCount: existing.accountCount + site.accountCount,
            accountIds: [...existing.accountIds, ...site.accountIds],
            multisigIds: [...existing.multisigIds, ...site.multisigIds],
            origin: site.origin,
          }
        : site,
    );
  }
  return [...merged.values()].sort(byOrigin);
};
