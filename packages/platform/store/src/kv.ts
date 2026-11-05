/**
 * Minimal key-value storage boundary for browser storage and tests.
 */
import { WalletError } from "@bramble/core/errors";
import { isJsonWithinBudget, JSON_BUDGETS, type Json, type JsonBudget } from "@bramble/core/json";

const STORAGE_KEY_PATTERN = /^bramble:[a-z0-9]+(?:[-:][a-z0-9]+)*$/;

/**
 * Minimal async key-value store abstraction used by encrypted storage.
 */
export type KeyValueStore = {
  readonly get: (key: string) => Promise<unknown>;
  readonly remove: (key: string) => Promise<void>;
  readonly set: (key: string, value: Json) => Promise<void>;
};

/**
 * Throws when a storage key is outside the wallet namespace.
 */
export function assertStorageKey(key: string): void {
  if (!STORAGE_KEY_PATTERN.test(key)) {
    throw new WalletError("Storage key must be namespaced");
  }
}

/**
 * The only keys that hold an encrypted vault envelope: the vault and the
 * staging copy an interrupted migration leaves (`store-migration.ts` names
 * them; a test pins the two lists together). Their base64 ciphertext can
 * outgrow the provider budget the plaintext was held to (Sherlock 261).
 */
export const ENCRYPTED_ENVELOPE_KEYS: ReadonlySet<string> = new Set([
  "bramble:vault",
  "bramble:vault-migration",
]);

/**
 * Prefix of the per-account QSB disclosure journal keys,
 * `bramble:qsb-journal:<journalId>`, each an encrypted envelope of its own.
 * The vault's journal store builds its keys from this one spelling.
 */
export const QSB_JOURNAL_KEY_PREFIX = "bramble:qsb-journal:";

const QSB_JOURNAL_KEY_PATTERN = /^bramble:qsb-journal:[0-9a-f]{64}$/;

/**
 * Prefix of the per-account QSB pending-deposit keys,
 * `bramble:qsb-deposit:<journalId>`, each an encrypted envelope of its own
 * under the provider budget. The vault's journal stores build these keys
 * from this one spelling, beside the journal of the same id.
 */
export const QSB_DEPOSIT_KEY_PREFIX = "bramble:qsb-deposit:";

/**
 * Prefix of the per-account QSB withdrawal keys,
 * `bramble:qsb-withdrawal:<journalId>`, each an encrypted envelope of its own
 * under the provider budget, beside the journal of the same id and built
 * from this one spelling.
 */
export const QSB_WITHDRAWAL_KEY_PREFIX = "bramble:qsb-withdrawal:";

/**
 * Checks for exactly one QSB journal envelope key: the prefix and a 64-digit
 * lowercase-hex journal id, nothing after it. The journal's own commit and
 * marker records (`…:commit:<lineage>`) are not journal keys.
 */
export const isQsbJournalStorageKey = (key: string): boolean => QSB_JOURNAL_KEY_PATTERN.test(key);

/**
 * The budget a write to `key` is held to. The vault envelope keys get the
 * larger at-rest budget (`JSON_BUDGETS.storage`) and each QSB journal key the
 * at-rest budget of one capped journal (`JSON_BUDGETS.qsbJournalStorage`);
 * every other key keeps the provider budget, so no other value can grow
 * toward the browser's shared storage quota.
 */
export const storageBudgetFor = (key: string): JsonBudget => {
  if (ENCRYPTED_ENVELOPE_KEYS.has(key)) {
    return JSON_BUDGETS.storage;
  }
  return isQsbJournalStorageKey(key) ? JSON_BUDGETS.qsbJournalStorage : JSON_BUDGETS.provider;
};

/**
 * Throws when a value would serialize as lossy JSON or exceed `budget`, by
 * default the at-rest storage budget, which admits the encrypted envelope of
 * any value the provider budget admits. Adapters pass `storageBudgetFor(key)`.
 */
export function assertJsonValue(
  value: unknown,
  budget: JsonBudget = JSON_BUDGETS.storage,
): asserts value is Json {
  if (!isJsonWithinBudget(value, budget)) {
    throw new WalletError("Invalid JSON value");
  }
}

const cloneJson = (value: Json): Json => structuredClone(value) as Json;

/**
 * Creates an in-memory key-value store for deterministic tests.
 */
export const createMemoryStore = (): KeyValueStore => {
  const values = new Map<string, Json>();

  return {
    async get(key) {
      assertStorageKey(key);
      const value = values.get(key);
      return value === undefined ? undefined : cloneJson(value);
    },
    async remove(key) {
      assertStorageKey(key);
      values.delete(key);
    },
    async set(key, value) {
      assertStorageKey(key);
      assertJsonValue(value, storageBudgetFor(key));
      values.set(key, cloneJson(value));
    },
  };
};
