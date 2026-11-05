/**
 * The QSB model: which state each valid account view shows,
 * which words a backup asks for (always the contract's count, at distinct
 * positions, never chosen by the phrase), the exact words sent for the check,
 * and the line a failed write shows.
 */
import { describe, expect, test } from "bun:test";
import {
  QSB_ACCOUNT_REFUSALS,
  QSB_BACKUP_CHECK_WORDS,
  QSB_PHRASE_WORDS,
  type QsbAccountView,
} from "@bramble/wallet-model/qsb";
import { SubmissionUnknownError } from "@bramble/wallet-protocol/submission-unknown";
import {
  qsbAccountLabel,
  qsbAccountState,
  qsbBackupWords,
  qsbCheckPositions,
  qsbImported,
  qsbWriteFailure,
} from "../../../../src/sidepanel/journeys/qsb/qsb-model";
import { REQUEST_UNKNOWN } from "../../../../src/sidepanel/runtime/friendly-error-copy";

const view = (overrides: Partial<QsbAccountView>): QsbAccountView => ({
  backupConfirmed: true,
  id: "qsb-7",
  journal: "bound",
  provenance: "generated-here",
  writer: true,
  ...overrides,
});

const UNKNOWN = "Bramble couldn't confirm this finished. Refresh before trying again.";

describe("qsbAccountState", () => {
  test("names each state, most urgent first", () => {
    expect(qsbAccountState(view({ backupConfirmed: false, writer: false }))).toBe("backup-needed");
    // An unbacked phrase still needs its backup when the history is unreadable.
    expect(
      qsbAccountState(view({ backupConfirmed: false, journal: "unavailable", writer: false })),
    ).toBe("backup-needed");
    expect(qsbAccountState(view({ journal: "unavailable", writer: false }))).toBe(
      "history-unavailable",
    );
    expect(
      qsbAccountState(view({ journal: "unavailable", provenance: "imported", writer: false })),
    ).toBe("history-unavailable");
    expect(qsbAccountState(view({}))).toBe("ready");
    expect(qsbAccountState(view({ provenance: "imported", writer: false }))).toBe("read-only");
  });

  test("labels an account by its number", () => {
    expect(qsbAccountLabel("qsb-1")).toBe("QSB vault 1");
    expect(qsbAccountLabel("qsb-9999")).toBe("QSB vault 9999");
    expect(qsbImported("qsb-3")).toBe("Imported as QSB vault 3.");
  });
});

describe("qsbCheckPositions", () => {
  test("always asks the contract's count of distinct positions, one per band", () => {
    const band = QSB_PHRASE_WORDS / QSB_BACKUP_CHECK_WORDS;
    for (const variation of [0, 1, 7, 8, 63, 64, 511, 1_730_000_000_000, -5, Number.NaN]) {
      const positions = qsbCheckPositions(variation);
      expect(positions).toHaveLength(QSB_BACKUP_CHECK_WORDS);
      expect(new Set(positions).size).toBe(QSB_BACKUP_CHECK_WORDS);
      positions.forEach((position, index) => {
        expect(position).toBeGreaterThan(index * band);
        expect(position).toBeLessThanOrEqual((index + 1) * band);
      });
    }
  });

  test("different clock readings ask different words", () => {
    const sets = new Set(
      [0, 1, 2, 9, 77, 300].map((variation) => qsbCheckPositions(variation).join(",")),
    );
    expect(sets.size).toBeGreaterThan(1);
  });
});

describe("qsbBackupWords", () => {
  test("sends each answer at its 0-based index, trimmed and lowercased", () => {
    expect(qsbBackupWords([3, 12, 24], [" Abandon", "ABANDON ", "art"])).toEqual([
      { index: 2, word: "abandon" },
      { index: 11, word: "abandon" },
      { index: 23, word: "art" },
    ]);
  });

  test("is null until exactly three distinct, in-range positions each have a word", () => {
    expect(qsbBackupWords([3, 12, 24], ["abandon", "", "art"])).toBeNull();
    expect(qsbBackupWords([3, 12, 24], ["abandon", "   ", "art"])).toBeNull();
    expect(qsbBackupWords([3, 12, 24], ["abandon", "abandon"])).toBeNull();
    expect(qsbBackupWords([3, 3, 24], ["a", "b", "c"])).toBeNull();
    expect(qsbBackupWords([0, 12, 24], ["a", "b", "c"])).toBeNull();
    expect(qsbBackupWords([3, 12, 25], ["a", "b", "c"])).toBeNull();
    expect(qsbBackupWords([3, 12], ["a", "b"])).toBeNull();
    expect(qsbBackupWords([1, 2, 3, 4], ["a", "b", "c", "d"])).toBeNull();
  });
});

describe("qsbWriteFailure", () => {
  test("says the outcome is unknown when the write may have run", () => {
    expect(qsbWriteFailure(new SubmissionUnknownError(REQUEST_UNKNOWN, null), "x")).toBe(UNKNOWN);
    expect(qsbWriteFailure(new Error("wallet request failed"), "x")).toBe(UNKNOWN);
  });

  test("shows a refusal's reviewed sentence", () => {
    expect(qsbWriteFailure(new Error(QSB_ACCOUNT_REFUSALS.backupMismatch), "x")).toBe(
      "Those words don't match your phrase. Check them and try again.",
    );
    expect(qsbWriteFailure(new Error(QSB_ACCOUNT_REFUSALS.notDedicated), "x")).toBe(
      "This is your Starknet recovery phrase. A QSB vault needs a phrase of its own.",
    );
    expect(qsbWriteFailure(null, QSB_ACCOUNT_REFUSALS.creationFailed)).toBe(
      "Couldn't create the QSB vault. Try again.",
    );
  });
});
