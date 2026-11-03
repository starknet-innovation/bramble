/**
 * Merging an imported QSB journal (BIP "Backup, restoration, and multiple
 * devices"): exposed or retired information is never weakened, conflicts
 * become unknown, the larger high-water mark is kept without granting writer
 * authority, and a writer's own journal is never merged into. Covers the
 * stale-backup restoration and conflicting-writer custody events.
 */
import { describe, expect, test } from "bun:test";
import {
  isQsbWriter,
  MAX_QSB_VAULTS_PER_ACCOUNT,
  type QsbAccountRecord,
  type QsbVaultRecord,
} from "@bramble/vault/qsb-account";
import { allocateQsbVault, type QsbJournalResult } from "@bramble/vault/qsb-journal";
import { mergeImportedQsbJournal } from "@bramble/vault/qsb-merge";
import {
  allocatedVault,
  bindingTransaction,
  DISCLOSURE,
  exposedVault,
  FUNDING,
  fundedVault,
  importedAccount,
  OTHER_SCRIPT,
  P2TR,
  ROOT_V0,
  ROOT_V7,
  SCRIPT_HASH,
  sha256Hex,
  writerAccount,
} from "./qsb-fixtures";

const accountOf = (result: QsbJournalResult): QsbAccountRecord => {
  if (!result.ok) throw new Error(`refused: ${result.refusal}`);
  return result.account;
};

const unknown = (vault: QsbVaultRecord): QsbVaultRecord => ({ ...vault, state: "unknown" });
const retired = (vault: QsbVaultRecord): QsbVaultRecord => ({ ...vault, state: "retired" });

describe("mergeImportedQsbJournal", () => {
  test("adds imported records and keeps the larger mark, still read-only", () => {
    const local = importedAccount([unknown(fundedVault(1))], 2);
    const merged = accountOf(
      mergeImportedQsbJournal(local, {
        nextV: 9,
        vaults: [unknown(allocatedVault(0)), unknown(allocatedVault(7, ROOT_V7))],
      }),
    );
    expect(merged.vaults.map((vault) => [vault.v, vault.state])).toEqual([
      [0, "unknown"],
      [1, "unknown"],
      [7, "unknown"],
    ]);
    expect(merged.nextV).toBe(9);
    expect(isQsbWriter(merged)).toBe(false);
    expect(allocateQsbVault(merged, { root: ROOT_V0, v: 9 })).toEqual({
      ok: false,
      refusal: "not-writer",
    });
  });

  test("stale-backup restoration never lowers the mark or drops a local record", () => {
    const local = importedAccount([unknown(fundedVault(0)), retired(allocatedVault(4))], 12);
    const merged = accountOf(
      mergeImportedQsbJournal(local, { nextV: 1, vaults: [unknown(allocatedVault(0))] }),
    );
    expect(merged.nextV).toBe(12);
    expect(merged.vaults).toEqual([unknown(fundedVault(0)), retired(allocatedVault(4))]);
  });

  test("agreeing histories fill each other's gaps", () => {
    const local = importedAccount([unknown(allocatedVault(0))]);
    const merged = accountOf(
      mergeImportedQsbJournal(local, { nextV: 1, vaults: [unknown(exposedVault(0))] }),
    );
    expect(merged.vaults).toEqual([unknown(exposedVault(0))]);
  });

  test("retired information is never weakened, from either side", () => {
    const local = importedAccount([retired(fundedVault(0)), unknown(fundedVault(1))]);
    const merged = accountOf(
      mergeImportedQsbJournal(local, {
        nextV: 2,
        vaults: [unknown(exposedVault(0)), retired(fundedVault(1))],
      }),
    );
    expect(merged.vaults).toEqual([retired(exposedVault(0)), retired(fundedVault(1))]);
  });

  const conflicts: readonly (readonly [string, QsbVaultRecord])[] = [
    ["a different root", unknown({ ...fundedVault(0), root: ROOT_V7 })],
    [
      "a different script",
      unknown({
        ...fundedVault(0),
        scriptHash: sha256Hex(OTHER_SCRIPT),
        scriptPubKey: OTHER_SCRIPT,
      }),
    ],
    ["different funding", unknown({ ...fundedVault(0), funding: { ...FUNDING, valueSat: 1 } })],
    [
      "a different disclosure",
      unknown({
        ...exposedVault(0),
        disclosure: {
          ...DISCLOSURE,
          transaction: bindingTransaction([FUNDING], [{ script: P2TR, valueSat: 249_000 }]),
        },
      }),
    ],
  ];
  for (const [name, incoming] of conflicts) {
    test(`conflicting writers: ${name} keeps the local record and makes it unknown`, () => {
      const local = importedAccount([unknown(exposedVault(0))]);
      const merged = accountOf(mergeImportedQsbJournal(local, { nextV: 1, vaults: [incoming] }));
      expect(merged.vaults).toEqual([unknown(exposedVault(0))]);
      // A retired local record stays retired through the same conflict.
      const local2 = importedAccount([retired(exposedVault(0))]);
      expect(
        accountOf(mergeImportedQsbJournal(local2, { nextV: 1, vaults: [incoming] })).vaults,
      ).toEqual([retired(exposedVault(0))]);
    });
  }

  test("never merges into the writer's own journal", () => {
    const writer = writerAccount([fundedVault(0)]);
    expect(
      mergeImportedQsbJournal(writer, { nextV: 1, vaults: [unknown(fundedVault(0))] }),
    ).toEqual({ ok: false, refusal: "writer-journal" });
  });

  test("refuses a journal that is not imported history", () => {
    const local = importedAccount();
    for (const journal of [
      { nextV: 1, vaults: [allocatedVault(0)] },
      { nextV: 1, vaults: [exposedVault(0)] },
      { nextV: 0, vaults: [unknown(allocatedVault(0))] },
      { nextV: 2, vaults: [unknown(allocatedVault(1)), unknown(allocatedVault(0))] },
      { nextV: 2 ** 31 + 1, vaults: [] },
      { nextV: 1, vaults: [{ ...unknown(fundedVault(0)), scriptHash: SCRIPT_HASH.slice(2) }] },
    ]) {
      expect(mergeImportedQsbJournal(local, journal)).toEqual({
        ok: false,
        refusal: "invalid-request",
      });
    }
  });

  test("a union past the journal bound is refused whole, never truncated", () => {
    const half = MAX_QSB_VAULTS_PER_ACCOUNT / 2;
    const local = importedAccount(
      Array.from({ length: half }, (_, v) => unknown(allocatedVault(v))),
    );
    const incoming = Array.from({ length: half + 1 }, (_, index) =>
      unknown(allocatedVault(half + index)),
    );
    expect(mergeImportedQsbJournal(local, { nextV: 2 * half + 1, vaults: incoming })).toEqual({
      ok: false,
      refusal: "journal-full",
    });
    expect(
      mergeImportedQsbJournal(local, { nextV: 2 * half, vaults: incoming.slice(0, half) }).ok,
    ).toBe(true);
  });
});
