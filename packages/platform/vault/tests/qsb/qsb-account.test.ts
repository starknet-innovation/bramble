/**
 * QSB account records as the vault keeps them: ids, dedicated phrases, the
 * journal id, and the collection's uniqueness and bound. The journal-side
 * rules are pinned in qsb-journal-record.test.ts. Invalid data fails closed;
 * limits refuse rather than drop.
 */
import { describe, expect, test } from "bun:test";
import {
  hasValidQsbAccounts,
  isQsbAccountId,
  isQsbAccountRecord,
  isQsbJournalId,
  isQsbMnemonic,
  MAX_QSB_ACCOUNTS,
  nextQsbAccountId,
} from "@bramble/vault/qsb-account";
import { canonicalAccountId, isAccountId, isImportedSeedId } from "@bramble/wallet-model/accounts";
import {
  importedAccount,
  JOURNAL_ID_A,
  JOURNAL_ID_B,
  PHRASE_A,
  PHRASE_B,
  PHRASE_C,
  writerAccount,
} from "./qsb-fixtures";

describe("QSB account ids", () => {
  test("are sequential and never confusable with a Starknet account or phrase handle", () => {
    for (const id of ["qsb-1", "qsb-8", "qsb-9999"]) {
      expect(isQsbAccountId(id)).toBe(true);
      expect(isAccountId(id)).toBe(false);
      expect(canonicalAccountId(id)).toBeNull();
      expect(isImportedSeedId(id)).toBe(false);
    }
    for (const id of ["qsb-0", "qsb-01", "qsb-10000", "QSB-1", "SN_MAIN:0x1", "phrase-1", ""]) {
      expect(isQsbAccountId(id)).toBe(false);
    }
  });

  test("the next id is one past the highest, refused at the account bound", () => {
    expect(nextQsbAccountId([])).toBe("qsb-1");
    expect(nextQsbAccountId([{ id: "qsb-1" }, { id: "qsb-3" }])).toBe("qsb-4");
    const full = Array.from({ length: MAX_QSB_ACCOUNTS }, (_, index) => ({
      id: `qsb-${index + 1}`,
    }));
    expect(nextQsbAccountId(full)).toBeNull();
    expect(nextQsbAccountId([{ id: "qsb-9999" }])).toBeNull();
  });
});

describe("QSB phrases", () => {
  test("are exactly 24 lowercase words in one spelling", () => {
    expect(isQsbMnemonic(PHRASE_A)).toBe(true);
    expect(isQsbMnemonic(PHRASE_B)).toBe(true);
    const words = PHRASE_B.split(" ");
    for (const variant of [
      words.slice(0, 12).join(" "),
      words.slice(0, 23).join(" "),
      `${PHRASE_B} title`,
      ` ${PHRASE_B}`,
      PHRASE_B.replace(" ", "  "),
      PHRASE_B.replace(" ", "\t"),
      PHRASE_B.toUpperCase(),
      "",
      42,
      null,
    ]) {
      expect(isQsbMnemonic(variant)).toBe(false);
    }
  });
});

describe("QSB accounts", () => {
  test("hold account-level data only, journal named by id", () => {
    expect(isQsbAccountRecord(writerAccount())).toBe(true);
    expect(isQsbAccountRecord(importedAccount())).toBe(true);
    expect(isQsbAccountRecord({ ...writerAccount(), backupConfirmed: false })).toBe(true);
    expect(isQsbJournalId(JOURNAL_ID_A)).toBe(true);
    for (const id of [
      JOURNAL_ID_A.toUpperCase(),
      JOURNAL_ID_A.slice(2),
      `0x${JOURNAL_ID_A}`,
      "qsb-1",
    ]) {
      expect(isQsbJournalId(id)).toBe(false);
    }
  });

  const accounts: readonly (readonly [string, unknown])[] = [
    ["a Starknet account id", { ...writerAccount(), id: "SN_MAIN:0x1" }],
    ["a 12-word phrase", { ...writerAccount(), mnemonic: PHRASE_A.split(" ").slice(12).join(" ") }],
    [
      "a raw32 seed source",
      { ...writerAccount(), seedContext: { provenance: "imported", source: "raw32" } },
    ],
    [
      "an unknown provenance",
      { ...writerAccount(), seedContext: { provenance: "copied", source: "bip39" } },
    ],
    ["a test network", { ...writerAccount(), network: "bitcoin-testnet" }],
    ["a non-boolean backup flag", { ...writerAccount(), backupConfirmed: "yes" }],
    ["a short journal id", { ...writerAccount(), journalId: JOURNAL_ID_A.slice(2) }],
    ["no journal id", { ...writerAccount(), journalId: undefined }],
    ["a journal kept in the vault", { ...writerAccount(), nextV: 0, vaults: [] }],
    ["an unknown member", { ...writerAccount(), label: "Savings" }],
  ];
  for (const [name, account] of accounts) {
    test(`refuse an account with ${name}`, () => {
      expect(isQsbAccountRecord(account)).toBe(false);
    });
  }
});

describe("the QSB account collection", () => {
  const second = { ...importedAccount(), mnemonic: PHRASE_C };

  test("admits distinct accounts with dedicated phrases and journals", () => {
    expect(hasValidQsbAccounts([], [])).toBe(true);
    expect(hasValidQsbAccounts([writerAccount(), second], [PHRASE_B])).toBe(true);
  });

  test("refuses a phrase held twice, even spelled differently elsewhere", () => {
    expect(hasValidQsbAccounts([writerAccount(), { ...second, mnemonic: PHRASE_A }], [])).toBe(
      false,
    );
    expect(hasValidQsbAccounts([writerAccount()], [PHRASE_A])).toBe(false);
    expect(hasValidQsbAccounts([writerAccount()], [`  ${PHRASE_A.replaceAll(" ", "\n")} `])).toBe(
      false,
    );
    expect(hasValidQsbAccounts([writerAccount()], [PHRASE_A.toUpperCase()])).toBe(false);
  });

  test("refuses a repeated id or journal id, and a collection past the bound", () => {
    expect(hasValidQsbAccounts([writerAccount(), { ...second, id: "qsb-1" }], [])).toBe(false);
    expect(hasValidQsbAccounts([writerAccount(), { ...second, journalId: JOURNAL_ID_A }], [])).toBe(
      false,
    );
    expect(hasValidQsbAccounts([writerAccount(), { ...second, journalId: JOURNAL_ID_B }], [])).toBe(
      true,
    );
    const many = manyAccounts(MAX_QSB_ACCOUNTS + 1);
    expect(hasValidQsbAccounts(many.slice(0, MAX_QSB_ACCOUNTS), [])).toBe(true);
    expect(hasValidQsbAccounts(many, [])).toBe(false);
    expect(hasValidQsbAccounts("none", [])).toBe(false);
  });
});

// Distinct accounts: each its own id, journal id, and 24-word spelling.
const manyAccounts = (count: number) => {
  const phrases = [PHRASE_A, PHRASE_B, PHRASE_C];
  return Array.from({ length: count }, (_, index) => ({
    ...importedAccount(),
    id: `qsb-${index + 1}`,
    journalId: `${index.toString(16).padStart(2, "0")}${JOURNAL_ID_A.slice(2)}`,
    mnemonic: (phrases[index % 3] ?? PHRASE_A)
      .split(" ")
      .map((word, position) => (position === index ? "zoo" : word))
      .join(" "),
  }));
};
