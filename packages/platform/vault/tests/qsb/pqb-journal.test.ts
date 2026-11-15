/** Adjacent migration preserves legacy history; PQB selections cannot be mistaken for QSB disclosures. */
import { describe, expect, test } from "bun:test";
import {
  bindQsbJournal,
  isQsbJournal,
  migrateQsbJournal,
  QSB_JOURNAL_SCHEMA_VERSION,
} from "@bramble/vault/qsb-journal-record";
import { exportQsbManifest } from "@bramble/vault/qsb-manifest";
import { isQsbVaultRecord } from "@bramble/vault/qsb-vault-record";
import { DISCLOSURE, fundedVault, journalFor, writerAccount } from "./qsb-fixtures";

describe("PQB journal version", () => {
  test("migrates v1 without changing reserved indices, funding or exposure history", () => {
    const account = writerAccount(),
      journal = journalFor(account, [
        { ...fundedVault(0), state: "exposed", disclosure: DISCLOSURE },
      ]);
    const legacy = { ...journal, profile: "QSB-HORS-v1", schemaVersion: 1 };
    expect(migrateQsbJournal(legacy)).toEqual({
      ...journal,
      schemaVersion: QSB_JOURNAL_SCHEMA_VERSION,
    });
    expect(bindQsbJournal(account, { status: "present", value: legacy }).status).toBe("bound");
    expect(isQsbJournal(legacy)).toBe(false);
    expect(migrateQsbJournal({ ...legacy, profile: "unsupported" })).toBeUndefined();
    expect(migrateQsbJournal({ ...legacy, nextV: -1 })).toBeUndefined();
    expect(isQsbJournal({ ...journal, schemaVersion: 3 })).toBe(false);
  });
  test("v1 cannot carry PQB records; v2 validates 8+9 disjoint selections and menu bounds", () => {
    const account = writerAccount(),
      record = {
        ...fundedVault(0),
        pqb: true as const,
        root: fundedVault(0).scriptHash ?? "",
        state: "exposed" as const,
        disclosure: {
          ...DISCLOSURE,
          round0: [0, 1, 2, 3, 4, 5, 6, 7],
          round1: [8, 9, 10, 11, 12, 13, 14, 15, 16],
          menus: [11, 15, 15],
        },
      };
    expect(isQsbVaultRecord(record)).toBe(true);
    expect(
      isQsbVaultRecord({ ...record, disclosure: { ...record.disclosure, menus: [12, 15, 15] } }),
    ).toBe(false);
    expect(
      isQsbVaultRecord({
        ...record,
        disclosure: { ...record.disclosure, round1: [0, 9, 10, 11, 12, 13, 14, 15, 16] },
      }),
    ).toBe(false);
    const journal = journalFor(account, [record]);
    expect(isQsbJournal(journal)).toBe(true);
    expect(
      migrateQsbJournal({ ...journal, profile: "QSB-HORS-v1", schemaVersion: 1 }),
    ).toBeUndefined();
    expect(
      exportQsbManifest(bindQsbJournal(account, { status: "present", value: journal })),
    ).toBeNull();
  });
});
