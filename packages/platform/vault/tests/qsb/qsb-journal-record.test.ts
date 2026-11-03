/**
 * The QSB journal record and its binding to a vault account. A missing,
 * unreadable, corrupt, or mismatched journal fails closed: the account is not
 * a writer and nothing is bound. An orphan journal (one no account names) is
 * never bound. Writer status has one definition.
 */
import { describe, expect, test } from "bun:test";
import { QSB_JOURNAL_MAX_BYTES } from "@bramble/core/json";
import {
  bindQsbJournal,
  emptyQsbJournal,
  isQsbJournal,
  isQsbWriter,
  type QsbJournal,
  qsbJournalBytes,
} from "@bramble/vault/qsb-journal-record";
import { MAX_QSB_VAULTS_PER_ACCOUNT } from "@bramble/vault/qsb-vault-record";
import {
  allocatedVault,
  exposedVault,
  fundedVault,
  importedAccount,
  JOURNAL_ID_B,
  journalFor,
  writerAccount,
} from "./qsb-fixtures";

const present = (value: unknown) => ({ status: "present" as const, value });

describe("the QSB journal record", () => {
  test("a valid journal carries its header, records, and mark", () => {
    expect(isQsbJournal(journalFor(writerAccount()))).toBe(true);
    expect(isQsbJournal(journalFor(writerAccount(), [allocatedVault(0), exposedVault(3)], 6))).toBe(
      true,
    );
    expect(emptyQsbJournal(writerAccount())).toEqual(journalFor(writerAccount()));
  });

  const invalid: readonly (readonly [string, unknown])[] = [
    ["another schema version", { ...journalFor(writerAccount()), schemaVersion: 2 }],
    ["another profile", { ...journalFor(writerAccount()), profile: "QSB-HORS-v2" }],
    ["a test network", { ...journalFor(writerAccount()), network: "bitcoin-testnet" }],
    ["a malformed account id", { ...journalFor(writerAccount()), accountId: "SN_MAIN:0x1" }],
    ["a malformed journal id", { ...journalFor(writerAccount()), journalId: "00" }],
    ["a mark past 2^31", { ...journalFor(writerAccount()), nextV: 2 ** 31 + 1 }],
    ["a record at the mark", journalFor(writerAccount(), [allocatedVault(2)], 2)],
    ["unsorted records", journalFor(writerAccount(), [allocatedVault(2), allocatedVault(1)], 3)],
    ["a corrupt record", journalFor(writerAccount(), [{ ...allocatedVault(0), root: "zz" }])],
    ["an unknown member", { ...journalFor(writerAccount()), phrase: "kept elsewhere" }],
    ["no records list", { ...journalFor(writerAccount()), vaults: undefined }],
  ];
  for (const [name, journal] of invalid) {
    test(`refuses ${name}`, () => {
      expect(isQsbJournal(journal)).toBe(false);
    });
  }

  test("the record bound and the byte cap both refuse, never truncate", () => {
    const full = Array.from({ length: MAX_QSB_VAULTS_PER_ACCOUNT }, (_, v) => allocatedVault(v));
    expect(isQsbJournal(journalFor(writerAccount(), full))).toBe(true);
    expect(
      isQsbJournal(
        journalFor(writerAccount(), [...full, allocatedVault(MAX_QSB_VAULTS_PER_ACCOUNT)]),
      ),
    ).toBe(false);
    // Full-size records reach the byte cap long before the record bound.
    const heavy = (count: number): QsbJournal =>
      journalFor(
        writerAccount(),
        Array.from({ length: count }, (_, v) => exposedVault(v)),
      );
    let count = 1;
    while (qsbJournalBytes(heavy(count + 1)) <= QSB_JOURNAL_MAX_BYTES) count += 1;
    expect(count).toBeLessThan(MAX_QSB_VAULTS_PER_ACCOUNT);
    expect(count).toBeGreaterThanOrEqual(16);
    expect(isQsbJournal(heavy(count))).toBe(true);
    expect(isQsbJournal(heavy(count + 1))).toBe(false);
    expect(qsbJournalBytes(heavy(count))).toBe(JSON.stringify(heavy(count)).length);
  });
});

describe("binding a journal to its account", () => {
  test("binds a valid journal with the account's own ids", () => {
    const binding = bindQsbJournal(writerAccount(), present(journalFor(writerAccount())));
    expect(binding.status).toBe("bound");
    expect(isQsbWriter(binding)).toBe(true);
  });

  test("a missing journal fails closed and is never treated as empty", () => {
    const binding = bindQsbJournal(writerAccount(), { status: "missing" });
    expect(binding).toEqual({ account: writerAccount(), reason: "missing", status: "unavailable" });
    expect(isQsbWriter(binding)).toBe(false);
  });

  test("an unreadable journal (failed decryption, rollback) fails closed", () => {
    const binding = bindQsbJournal(writerAccount(), { status: "unreadable" });
    expect(binding).toMatchObject({ reason: "unreadable", status: "unavailable" });
    expect(isQsbWriter(binding)).toBe(false);
  });

  test("a corrupt journal fails closed", () => {
    for (const value of [null, "journal", { ...journalFor(writerAccount()), nextV: -1 }]) {
      const binding = bindQsbJournal(writerAccount(), present(value));
      expect(binding).toMatchObject({ reason: "invalid", status: "unavailable" });
      expect(isQsbWriter(binding)).toBe(false);
    }
  });

  test("a journal bound to another account id or journal id fails closed", () => {
    const account = writerAccount();
    for (const journal of [
      { ...journalFor(account), accountId: "qsb-2" },
      { ...journalFor(account), journalId: JOURNAL_ID_B },
    ]) {
      expect(isQsbJournal(journal)).toBe(true);
      expect(bindQsbJournal(account, present(journal))).toMatchObject({
        reason: "mismatched",
        status: "unavailable",
      });
    }
  });

  test("after a reset, a reused account id never binds the old account's journal", () => {
    // The old wallet's qsb-1 left its journal behind; the new qsb-1 has a fresh
    // journal id, so the leftover is an orphan it can never bind.
    const oldAccount = { ...writerAccount(), journalId: JOURNAL_ID_B };
    const leftover = journalFor(oldAccount, [exposedVault(0)]);
    expect(bindQsbJournal(writerAccount(), present(leftover))).toMatchObject({
      reason: "mismatched",
      status: "unavailable",
    });
    expect(bindQsbJournal(oldAccount, present(leftover)).status).toBe("bound");
  });

  test("an imported journal holds nothing it could still disclose from", () => {
    const account = importedAccount();
    const readOnly = journalFor(account, [
      { ...exposedVault(0), state: "unknown" },
      { ...fundedVault(2), state: "retired" },
    ]);
    const binding = bindQsbJournal(account, present(readOnly));
    expect(binding.status).toBe("bound");
    expect(isQsbWriter(binding)).toBe(false);
    for (const vault of [allocatedVault(0), exposedVault(0)]) {
      expect(bindQsbJournal(account, present(journalFor(account, [vault])))).toMatchObject({
        reason: "invalid",
        status: "unavailable",
      });
    }
  });

  test("nothing is allocated before the backup is confirmed", () => {
    const unconfirmed = { ...writerAccount(), backupConfirmed: false };
    const binding = bindQsbJournal(unconfirmed, present(journalFor(unconfirmed)));
    expect(binding.status).toBe("bound");
    expect(isQsbWriter(binding)).toBe(false);
    expect(bindQsbJournal(unconfirmed, present(journalFor(unconfirmed, [], 1)))).toMatchObject({
      reason: "invalid",
      status: "unavailable",
    });
    expect(
      bindQsbJournal(unconfirmed, present(journalFor(unconfirmed, [allocatedVault(0)]))),
    ).toMatchObject({ reason: "invalid", status: "unavailable" });
  });

  test("writer status needs all three: generated here, backup confirmed, journal bound", () => {
    const account = writerAccount();
    const cases = [
      [account, present(journalFor(account)), true],
      [account, { status: "missing" as const }, false],
      [{ ...account, backupConfirmed: false }, present(journalFor(account)), false],
      [
        { ...account, seedContext: { provenance: "imported" as const, source: "bip39" as const } },
        present(journalFor(account)),
        false,
      ],
    ] as const;
    for (const [owner, read, writer] of cases) {
      expect(isQsbWriter(bindQsbJournal(owner, read))).toBe(writer);
    }
  });
});
