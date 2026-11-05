/**
 * The open QSB journal, pending-deposit and withdrawal stores: one encrypted store
 * per key, built on first use through the factory the background root
 * supplies and then kept, so their derived AES keys are reused for the rest
 * of an unlock and are all dropped together when the wallet locks.
 *
 * Trust boundary: the factory is only ever handed a key built from a valid
 * journal id, `qsbJournalStorageKey`, `qsbDepositStorageKey` or
 * `qsbWithdrawalStorageKey`, so no other
 * storage key can be opened through here. The root wires every one exactly
 * like the vault (same `storage.local` area, `storage.sync` commit records,
 * session shadow and local mirror; see docs/WALLET_STORE.md), which this
 * module cannot see and does not check.
 *
 * Memory only. One entry per key this worker has addressed: per QSB account
 * (at most `MAX_QSB_ACCOUNTS`) its journal, pending deposits and withdrawals, plus one
 * journal per account-creation attempt.
 */
import type { EncryptedStore } from "../encrypted-store";
import { qsbDepositStorageKey } from "./qsb-deposit-store";
import { qsbJournalStorageKey } from "./qsb-journal-store";
import { qsbWithdrawalStorageKey } from "./qsb-withdrawal-store";

/** Builds the encrypted store for one journal storage key. */
export type QsbJournalStoreFactory = (storageKey: string) => EncryptedStore;

/**
 * The stores the vault service reads and writes QSB journals, pending
 * deposits and withdrawals through. `forJournal`, `forDeposits` and
 * `forWithdrawals` return the one store for a
 * journal id's key (the same object on every call) and null for anything that
 * is not a journal id, without calling the factory. A factory that throws
 * throws through them, and nothing is kept for that key. `clearKeys` drops
 * every open store's derived keys.
 */
export type QsbJournalStores = {
  readonly clearKeys: () => void;
  readonly forDeposits: (journalId: string) => EncryptedStore | null;
  readonly forJournal: (journalId: string) => EncryptedStore | null;
  readonly forWithdrawals: (journalId: string) => EncryptedStore | null;
};

/** Creates the journal store registry over the root's store factory. */
export const createQsbJournalStores = (factory: QsbJournalStoreFactory): QsbJournalStores => {
  const stores = new Map<string, EncryptedStore>();
  const storeFor = (key: string | null): EncryptedStore | null => {
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
  };
  return {
    clearKeys() {
      for (const store of stores.values()) {
        store.clearKeys();
      }
    },
    forDeposits: (journalId) => storeFor(qsbDepositStorageKey(journalId)),
    forJournal: (journalId) => storeFor(qsbJournalStorageKey(journalId)),
    forWithdrawals: (journalId) => storeFor(qsbWithdrawalStorageKey(journalId)),
  };
};
