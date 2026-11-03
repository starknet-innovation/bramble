/**
 * The QSB journal store, end to end over the real encrypted store: one key per
 * account, bound to it by the AES-GCM associated data and the journal header;
 * every read failure (tamper, moved envelope, rollback) fails closed; writes
 * are validated and capped before storage is touched; a lost journal is never
 * recreated; and account creation writes the journal before the vault.
 */
import { describe, expect, test } from "bun:test";
import { isJsonWithinBudget, JSON_BUDGETS, QSB_JOURNAL_MAX_BYTES } from "@bramble/core/json";
import {
  createMemoryStore,
  isQsbJournalStorageKey,
  type KeyValueStore,
  storageBudgetFor,
} from "@bramble/store/kv";
import { createEncryptedStore } from "@bramble/vault/encrypted-store";
import { MAX_QSB_ACCOUNTS } from "@bramble/vault/qsb-account";
import {
  bindQsbJournal,
  type QsbJournal,
  qsbJournalBytes,
} from "@bramble/vault/qsb-journal-record";
import {
  planQsbAccountCreation,
  qsbJournalStorageKey,
  readQsbJournal,
  writeQsbJournal,
} from "@bramble/vault/qsb-journal-store";
import {
  exposedVault,
  fundedVault,
  importedAccount,
  JOURNAL_ID_A,
  JOURNAL_ID_B,
  journalFor,
  PHRASE_A,
  writerAccount,
} from "./qsb-fixtures";

const passphrase = "correct horse battery staple";
const account = writerAccount();
const keyA = `bramble:qsb-journal:${JOURNAL_ID_A}`;

// A write that must succeed; a refusal fails the test where it happens.
const written = async (...args: Parameters<typeof writeQsbJournal>): Promise<void> => {
  expect(await writeQsbJournal(...args)).toEqual({ ok: true });
};

const journalStore = (backend: KeyValueStore, journalId = JOURNAL_ID_A) =>
  createEncryptedStore(backend, qsbJournalStorageKey(journalId) ?? "bramble:invalid");

describe("the journal storage key", () => {
  test("is one key per journal id, with the journal's own at-rest budget", () => {
    expect(qsbJournalStorageKey(JOURNAL_ID_A)).toBe(keyA);
    expect(isQsbJournalStorageKey(keyA)).toBe(true);
    expect(storageBudgetFor(keyA)).toBe(JSON_BUDGETS.qsbJournalStorage);
    for (const key of [
      `${keyA}:commit:${"0".repeat(32)}`,
      `${keyA}:legacy`,
      "bramble:qsb-journal",
    ]) {
      expect(isQsbJournalStorageKey(key)).toBe(false);
      expect(storageBudgetFor(key)).toBe(JSON_BUDGETS.provider);
    }
    for (const id of ["qsb-1", JOURNAL_ID_A.toUpperCase(), JOURNAL_ID_A.slice(2), ""]) {
      expect(qsbJournalStorageKey(id)).toBeNull();
    }
  });

  test("all journals together stay a fraction of the 10 MiB storage.local quota", () => {
    // Chrome's storage.local quota without unlimitedStorage (the manifest asks
    // for none; the side panel already needs Chrome 114+, where it is 10 MiB).
    const quota = 10 * 1024 * 1024;
    const journalAtRest = JSON_BUDGETS.qsbJournalStorage.maxStringLength + 1024;
    const vaultAtRest = JSON_BUDGETS.storage.maxStringLength + 1024;
    expect(MAX_QSB_ACCOUNTS * journalAtRest).toBeLessThan(quota * 0.3);
    // The vault and its migration copy keep room beside every full journal.
    expect(MAX_QSB_ACCOUNTS * journalAtRest + 2 * vaultAtRest).toBeLessThan(quota * 0.6);
  });
});

describe("reading a journal", () => {
  test("missing, then present and bindable once written", async () => {
    const store = journalStore(createMemoryStore());
    expect(await readQsbJournal(store, passphrase)).toEqual({ status: "missing" });
    await written(store, account, journalFor(account), passphrase, "create");
    const read = await readQsbJournal(store, passphrase);
    expect(read).toEqual({ status: "present", value: journalFor(account) });
    expect(bindQsbJournal(account, read).status).toBe("bound");
  });

  test("a tampered envelope is unreadable, never empty", async () => {
    const backend = createMemoryStore();
    await written(journalStore(backend), account, journalFor(account), passphrase, "create");
    const envelope = (await backend.get(keyA)) as Record<string, string>;
    const data = envelope["data"] ?? "";
    await backend.set(keyA, { ...envelope, data: `${data.slice(0, -4)}AAAA` });
    expect(await readQsbJournal(journalStore(backend), passphrase)).toEqual({
      status: "unreadable",
    });
    await backend.set(keyA, { not: "an envelope" });
    expect(await readQsbJournal(journalStore(backend), passphrase)).toEqual({
      status: "unreadable",
    });
  });

  test("an envelope moved to another journal's key is unreadable", async () => {
    const backend = createMemoryStore();
    await written(journalStore(backend), account, journalFor(account), passphrase, "create");
    await backend.set(`bramble:qsb-journal:${JOURNAL_ID_B}`, (await backend.get(keyA)) as never);
    expect(await readQsbJournal(journalStore(backend, JOURNAL_ID_B), passphrase)).toEqual({
      status: "unreadable",
    });
  });

  test("a rolled-back journal is unreadable, so an exposed set never looks fresh", async () => {
    const backend = createMemoryStore();
    const store = journalStore(backend);
    const funded = journalFor(account, [fundedVault(0)]);
    await written(store, account, journalFor(account), passphrase, "create");
    await written(store, account, funded, passphrase, "replace");
    const beforeExposure = await backend.get(keyA);
    await written(store, account, journalFor(account, [exposedVault(0)]), passphrase, "replace");
    await backend.set(keyA, beforeExposure as never);
    expect(await readQsbJournal(journalStore(backend), passphrase)).toEqual({
      status: "unreadable",
    });
  });
});

describe("writing a journal", () => {
  test("create refuses an occupied key or a non-empty journal", async () => {
    const store = journalStore(createMemoryStore());
    expect(
      await writeQsbJournal(
        store,
        account,
        journalFor(account, [exposedVault(0)]),
        passphrase,
        "create",
      ),
    ).toEqual({ ok: false, refusal: "invalid-journal" });
    await written(store, account, journalFor(account), passphrase, "create");
    expect(
      await writeQsbJournal(store, account, journalFor(account), passphrase, "create"),
    ).toEqual({
      ok: false,
      refusal: "journal-exists",
    });
  });

  test("a lost journal is never recreated by a later write", async () => {
    const backend = createMemoryStore();
    const store = journalStore(backend);
    await written(store, account, journalFor(account), passphrase, "create");
    await backend.remove(keyA);
    expect(
      await writeQsbJournal(store, account, journalFor(account), passphrase, "replace"),
    ).toEqual({
      ok: false,
      refusal: "journal-missing",
    });
    expect(await backend.get(keyA)).toBeUndefined();
  });

  test("refuses a journal bound to another account before touching storage", async () => {
    const backend = createMemoryStore();
    expect(
      await writeQsbJournal(
        journalStore(backend),
        account,
        journalFor(importedAccount()),
        passphrase,
        "create",
      ),
    ).toEqual({ ok: false, refusal: "invalid-journal" });
    expect(await backend.get(keyA)).toBeUndefined();
  });

  test("budget: a full journal writes; one past the cap is refused, nothing stored", async () => {
    const heavy = (count: number): QsbJournal =>
      journalFor(
        account,
        Array.from({ length: count }, (_, v) => exposedVault(v)),
      );
    let count = 1;
    while (qsbJournalBytes(heavy(count + 1)) <= QSB_JOURNAL_MAX_BYTES) count += 1;
    const backend = createMemoryStore();
    const store = journalStore(backend);
    await written(store, account, journalFor(account), passphrase, "create");
    await written(store, account, heavy(count), passphrase, "replace");
    const envelope = await backend.get(keyA);
    // The full journal's envelope needs the journal key's own budget.
    expect(isJsonWithinBudget(envelope, JSON_BUDGETS.provider)).toBe(false);
    expect(await writeQsbJournal(store, account, heavy(count + 1), passphrase, "replace")).toEqual({
      ok: false,
      refusal: "journal-full",
    });
    expect(await backend.get(keyA)).toEqual(envelope);
  });
});

describe("creating a QSB account", () => {
  const input = {
    account,
    accounts: [importedAccount()],
    journalSlot: "absent" as const,
    otherPhrases: [] as readonly string[],
  };

  test("writes the empty journal first, then the vault account naming it", () => {
    const plan = planQsbAccountCreation(input);
    if (!plan.ok) throw new Error(plan.refusal);
    const [first, second] = plan.writes;
    expect(first).toEqual({ journal: journalFor(account), key: keyA, kind: "journal" });
    expect(second).toEqual({ kind: "vault", qsbAccounts: [importedAccount(), account] });
  });

  test("a crash between the two writes leaves a harmless orphan, never adopted", async () => {
    const backend = createMemoryStore();
    const plan = planQsbAccountCreation(input);
    if (!plan.ok) throw new Error(plan.refusal);
    // Step 1 lands; the vault write never happens.
    await written(journalStore(backend), account, plan.writes[0].journal, passphrase, "create");
    // A retry with the same journal id refuses the occupied key ...
    expect(planQsbAccountCreation({ ...input, journalSlot: "occupied" })).toEqual({
      ok: false,
      refusal: "journal-exists",
    });
    // ... and a retry draws a fresh one; the orphan is never read or bound.
    const retried = { ...account, journalId: `${"ab".repeat(31)}cd` };
    const fresh = planQsbAccountCreation({ ...input, account: retried });
    expect(fresh.ok && fresh.writes[0].key).toBe(`bramble:qsb-journal:${retried.journalId}`);
    expect(
      bindQsbJournal(
        retried,
        await readQsbJournal(journalStore(backend, retried.journalId), passphrase),
      ),
    ).toMatchObject({ reason: "missing", status: "unavailable" });
  });

  test("refuses invalid, duplicate, shared-phrase, and over-bound accounts", () => {
    const refusalOf = (overrides: Partial<typeof input>) => {
      const plan = planQsbAccountCreation({ ...input, ...overrides });
      return plan.ok ? null : plan.refusal;
    };
    expect(refusalOf({ account: { ...account, journalId: "00" } })).toBe("invalid-account");
    expect(refusalOf({ accounts: [account] })).toBe("duplicate-account");
    expect(refusalOf({ accounts: [{ ...importedAccount(), journalId: JOURNAL_ID_A }] })).toBe(
      "duplicate-account",
    );
    expect(refusalOf({ otherPhrases: [PHRASE_A] })).toBe("invalid-account");
    const full = Array.from({ length: MAX_QSB_ACCOUNTS }, (_, index) => ({
      ...importedAccount(),
      id: `qsb-${index + 2}`,
    }));
    expect(refusalOf({ accounts: full })).toBe("account-limit");
  });
});
