/**
 * Reading QSB accounts back through the real vault service: the listing binds
 * each journal and fails closed (`unavailable`) for a missing, corrupt,
 * rolled-back or foreign one without ever recreating it; the phrase is
 * revealed only after the vault decrypts under the password given; a backup
 * is confirmed only by the right words at distinct positions; and every QSB
 * method runs in the vault's mutation queue.
 */
import { describe, expect, test } from "bun:test";
import { FAKE_GENERATED_MNEMONIC_24 } from "@bramble/testkit/fake-kms";
import { createEncryptedStore } from "@bramble/vault/encrypted-store";
import type { QsbAccountRecord } from "@bramble/vault/qsb-account";
import { emptyQsbJournal } from "@bramble/vault/qsb-journal-record";
import { QSB_ACCOUNT_REFUSALS } from "@bramble/wallet-model/qsb";
import { PHRASE_A, PHRASE_B, PHRASE_C } from "../qsb/qsb-fixtures";
import {
  journalIdFor,
  journalKeyOf,
  PASSPHRASE,
  qsbServiceHarness,
  VAULT_KEY,
} from "./qsb-service-harness";

const WRONG_PASSPHRASE = "not the wallet password";
const JOURNAL_1 = journalIdFor("one");
const words = FAKE_GENERATED_MNEMONIC_24.split(" ");
const check = (positions: readonly number[], at = (index: number) => words[index] ?? "") =>
  positions.map((index) => ({ index, word: at(index) }));

// A wallet holding one freshly generated (unconfirmed) account.
const withGeneratedAccount = async () => {
  const harness = await qsbServiceHarness({ journalIds: [JOURNAL_1] });
  await harness.service.createQsbAccount(PASSPHRASE);
  harness.writes.length = 0;
  return harness;
};

const readFailure = async (run: () => Promise<unknown>): Promise<unknown> =>
  run().then(
    () => "resolved",
    (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : error),
  );

describe("revealing a QSB phrase", () => {
  test("returns the phrase once the vault decrypts under the password given", async () => {
    const harness = await withGeneratedAccount();
    expect(
      await harness.service.revealQsbPhrase({ accountId: "qsb-1", vaultPassphrase: PASSPHRASE }),
    ).toBe(FAKE_GENERATED_MNEMONIC_24);
    expect(harness.writes).toEqual([]);
  });

  test("a wrong password fails exactly as reading the vault does, before any id lookup", async () => {
    const harness = await withGeneratedAccount();
    const expected = await readFailure(() => harness.service.readVault(WRONG_PASSPHRASE));
    expect(expected).not.toBe("resolved");
    for (const accountId of ["qsb-1", "qsb-9"]) {
      expect(
        await readFailure(() =>
          harness.service.revealQsbPhrase({ accountId, vaultPassphrase: WRONG_PASSPHRASE }),
        ),
      ).toEqual(expected);
    }
  });

  test("refuses an unknown account, and reveals one whose journal is gone", async () => {
    const harness = await withGeneratedAccount();
    await expect(
      harness.service.revealQsbPhrase({ accountId: "qsb-2", vaultPassphrase: PASSPHRASE }),
    ).rejects.toThrow(QSB_ACCOUNT_REFUSALS.unknownAccount);
    await harness.backend.remove(journalKeyOf(JOURNAL_1));
    expect(
      await harness.service.revealQsbPhrase({ accountId: "qsb-1", vaultPassphrase: PASSPHRASE }),
    ).toBe(FAKE_GENERATED_MNEMONIC_24);
  });
});

describe("confirming a QSB backup", () => {
  test("the right words make a generated account its journal's writer", async () => {
    const harness = await withGeneratedAccount();
    const view = await harness.service.confirmQsbBackup({
      accountId: "qsb-1",
      vaultPassphrase: PASSPHRASE,
      words: check([2, 13, 23], (index) => ` ${(words[index] ?? "").toUpperCase()} `),
    });
    expect(view).toEqual({
      backupConfirmed: true,
      id: "qsb-1",
      journal: "bound",
      provenance: "generated-here",
      writer: true,
    });
    expect(harness.writes).toContain(VAULT_KEY);
    expect((await harness.storedQsbAccounts())[0]?.backupConfirmed).toBe(true);
  });

  test("is idempotent: a confirmed account is checked again and nothing is written", async () => {
    const harness = await withGeneratedAccount();
    const input = { accountId: "qsb-1", vaultPassphrase: PASSPHRASE, words: check([0, 1, 2]) };
    const first = await harness.service.confirmQsbBackup(input);
    harness.writes.length = 0;
    expect(await harness.service.confirmQsbBackup(input)).toEqual(first);
    expect(harness.writes).toEqual([]);
    await expect(
      harness.service.confirmQsbBackup({ ...input, words: check([0, 1, 3], () => "zoo") }),
    ).rejects.toThrow(QSB_ACCOUNT_REFUSALS.backupMismatch);
  });

  test("any wrong, missing, repeated or out-of-range word is one mismatch, naming none", async () => {
    const harness = await withGeneratedAccount();
    const wrongWord = check([0, 5, 9]).map((entry, position) =>
      position === 2 ? { ...entry, word: "zoo" } : entry,
    );
    for (const attempt of [
      wrongWord,
      check([0, 5]),
      check([0, 5, 9, 12]),
      [],
      check([4, 4, 9]),
      check([0, 5, 24]),
      check([0, 5, -1]),
      check([0, 5, 1.5]),
    ]) {
      const failure = await readFailure(() =>
        harness.service.confirmQsbBackup({
          accountId: "qsb-1",
          vaultPassphrase: PASSPHRASE,
          words: attempt,
        }),
      );
      expect(failure).toBe(`RefusedBeforeWrite: ${QSB_ACCOUNT_REFUSALS.backupMismatch}`);
    }
    expect(harness.writes).toEqual([]);
    expect((await harness.storedQsbAccounts())[0]?.backupConfirmed).toBe(false);
  });

  test("an imported account confirms as a no-op and never becomes a writer", async () => {
    const harness = await qsbServiceHarness({ journalIds: [JOURNAL_1] });
    await harness.service.importQsbAccount({ mnemonic: PHRASE_A, vaultPassphrase: PASSPHRASE });
    harness.writes.length = 0;
    const view = await harness.service.confirmQsbBackup({
      accountId: "qsb-1",
      vaultPassphrase: PASSPHRASE,
      words: [
        { index: 0, word: "abandon" },
        { index: 11, word: "abandon" },
        { index: 23, word: "art" },
      ],
    });
    expect(view).toEqual({
      backupConfirmed: true,
      id: "qsb-1",
      journal: "bound",
      provenance: "imported",
      writer: false,
    });
    expect(harness.writes).toEqual([]);
  });

  test("refuses an unknown account", async () => {
    const harness = await withGeneratedAccount();
    await expect(
      harness.service.confirmQsbBackup({
        accountId: "qsb-7",
        vaultPassphrase: PASSPHRASE,
        words: check([0, 1, 2]),
      }),
    ).rejects.toThrow(QSB_ACCOUNT_REFUSALS.unknownAccount);
  });
});

describe("listing QSB accounts", () => {
  test("reports a missing, corrupt, rolled-back or foreign journal as unavailable", async () => {
    const harness = await qsbServiceHarness({
      journalIds: ["1", "2", "3", "4", "5"].map(journalIdFor),
      phrases: [PHRASE_A, PHRASE_B, PHRASE_C, `${"zoo ".repeat(23)}vote`],
    });
    for (let created = 0; created < 4; created += 1) {
      await harness.service.createQsbAccount(PASSPHRASE);
    }
    const stored = await harness.storedQsbAccounts();
    const [missing, corrupt, rolledBack, foreign] = stored as readonly QsbAccountRecord[];
    if (!missing || !corrupt || !rolledBack || !foreign) throw new Error("four accounts expected");

    await harness.backend.remove(journalKeyOf(missing.journalId));
    await harness.backend.set(journalKeyOf(corrupt.journalId), { not: "an envelope" });
    const rolledBackKey = journalKeyOf(rolledBack.journalId);
    const older = await harness.backend.get(rolledBackKey);
    await harness.journals
      .forJournal(rolledBack.journalId)
      ?.write(emptyQsbJournal(rolledBack), PASSPHRASE);
    await harness.backend.set(rolledBackKey, older as never);
    // A valid journal, but for another account, under this account's key.
    await createEncryptedStore(harness.backend, journalKeyOf(foreign.journalId)).remove();
    await harness.journals
      .forJournal(foreign.journalId)
      ?.write(emptyQsbJournal({ id: "qsb-8", journalId: foreign.journalId }), PASSPHRASE);

    const views = await harness.service.qsbAccounts(PASSPHRASE);
    expect(views.map((view) => [view.id, view.journal, view.writer])).toEqual([
      ["qsb-1", "unavailable", false],
      ["qsb-2", "unavailable", false],
      ["qsb-3", "unavailable", false],
      ["qsb-4", "unavailable", false],
    ]);
    // Reading never recreates a lost journal.
    expect(await harness.backend.get(journalKeyOf(missing.journalId))).toBeUndefined();
    const serialized = JSON.stringify(views);
    for (const account of stored) {
      expect(serialized).not.toContain(account.mnemonic);
      expect(serialized).not.toContain(account.journalId);
    }
  });

  test("without QSB wiring every account lists, with its journal unavailable", async () => {
    const wired = await withGeneratedAccount();
    const vault = await wired.service.readVault(PASSPHRASE);
    const unwired = await qsbServiceHarness({ vault, wired: false });
    expect(await unwired.service.qsbAccounts(PASSPHRASE)).toEqual([
      {
        backupConfirmed: false,
        id: "qsb-1",
        journal: "unavailable",
        provenance: "generated-here",
        writer: false,
      },
    ]);
  });
});

describe("the mutation queue", () => {
  test("concurrent creations each see the other's account", async () => {
    const harness = await qsbServiceHarness({ phrases: [PHRASE_A, PHRASE_B, PHRASE_C] });
    const views = await Promise.all([
      harness.service.createQsbAccount(PASSPHRASE),
      harness.service.importQsbAccount({
        mnemonic: `${"zoo ".repeat(23)}vote`,
        vaultPassphrase: PASSPHRASE,
      }),
      harness.service.createQsbAccount(PASSPHRASE),
    ]);
    expect(views.map((view) => view.id)).toEqual(["qsb-1", "qsb-2", "qsb-3"]);
    expect((await harness.storedQsbAccounts()).map((account) => account.id)).toEqual([
      "qsb-1",
      "qsb-2",
      "qsb-3",
    ]);
  });
});
