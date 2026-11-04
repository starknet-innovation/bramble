/**
 * The open QSB journal stores: one encrypted store per journal key, built on
 * first use through the factory the background root supplies and then kept,
 * so a journal's derived AES keys are reused for the rest of an unlock and are
 * all dropped together when the wallet locks.
 *
 * Trust boundary: the factory is only ever handed a key `qsbJournalStorageKey`
 * built from a valid journal id, so no other storage key can be opened as a
 * journal through here. The root wires every journal exactly like the vault
 * (same `storage.local` area, `storage.sync` commit records, session shadow
 * and local mirror; see docs/WALLET_STORE.md), which this module cannot see
 * and does not check.
 *
 * Memory only. One entry per journal id this worker has addressed: the vault's
 * accounts (at most `MAX_QSB_ACCOUNTS`) plus one per account-creation attempt.
 */
import type { EncryptedStore } from "../encrypted-store";
import { qsbJournalStorageKey } from "./qsb-journal-store";

/** Builds the encrypted store for one journal storage key. */
export type QsbJournalStoreFactory = (storageKey: string) => EncryptedStore;

/**
 * The journal stores the vault service reads and writes QSB journals through.
 * `forJournal` returns the one store for a journal id (the same object on
 * every call) and null for anything that is not a journal id, without calling
 * the factory. A factory that throws throws through `forJournal`, and nothing
 * is kept for that id. `clearKeys` drops every open store's derived keys.
 */
export type QsbJournalStores = {
  readonly clearKeys: () => void;
  readonly forJournal: (journalId: string) => EncryptedStore | null;
};

/** Creates the journal store registry over the root's store factory. */
export const createQsbJournalStores = (factory: QsbJournalStoreFactory): QsbJournalStores => {
  const stores = new Map<string, EncryptedStore>();
  return {
    clearKeys() {
      for (const store of stores.values()) {
        store.clearKeys();
      }
    },
    forJournal(journalId) {
      const key = qsbJournalStorageKey(journalId);
      if (key === null) {
        return null;
      }
      const open = stores.get(key);
      if (open) {
        return open;
      }
      const store = factory(key);
      stores.set(key, store);
      return store;
    },
  };
};
