/**
 * Schema v13: Quantum Safe Bitcoin accounts in the encrypted vault, each a
 * dedicated phrase and the id of its separately stored disclosure journal.
 *
 * Old data: a v12 vault migrates to an empty QSB collection and nothing else
 * changes; no account or journal is invented. Current data: valid accounts
 * with dedicated phrases and distinct journal ids validate. Invalid data: any
 * malformed, duplicated, shared-phrase, journal-carrying, or over-bound
 * account makes the whole vault fail closed, like any other corrupt content.
 */
import { describe, expect, test } from "bun:test";
import { isJsonWithinBudget, JSON_BUDGETS } from "@bramble/core/json";
import { migrateVault, VAULT_MIGRATIONS } from "@bramble/vault/migrations";
import { MAX_QSB_ACCOUNTS } from "@bramble/vault/qsb-account";
import { CURRENT_SCHEMA_VERSION, emptyVault, isVaultV12, isVaultV13 } from "@bramble/vault/schema";
import {
  allocatedVault,
  importedAccount,
  JOURNAL_ID_A,
  PHRASE_A,
  PHRASE_B,
  PHRASE_C,
  writerAccount,
} from "../qsb/qsb-fixtures";

const account = {
  accountContractType: "openzeppelin",
  address: "0x5f1c0a3f8d9b2e7a6c4d1b0e9f8a7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0",
  classHash: "0x5400e90f7e0ae78bd02c77cd75527280470e2fe19c54970dd79dc37a9d3645c",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" as const },
  id: "SN_MAIN:0x5f1c0a3f8d9b2e7a6c4d1b0e9f8a7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0",
  networkId: "SN_MAIN",
  publicKeyX: "0x3a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f",
  publicKeyY: "0x2b1c2d3e4f5061728394a5b6c7d8e9f00a1b2c3d4e5f60718293a4b5c6d7e8f",
};

const STARKNET_PHRASE =
  "habit hope tip crystal because grunt nation idea electric witness alert like";

const v12 = {
  accounts: [account],
  accountSecrets: [],
  activeAccountId: account.id,
  importedSeeds: [],
  mnemonic: STARKNET_PHRASE,
  originGrants: [],
  schemaVersion: 12,
  shadowAccountScopes: [],
  signingKeys: [
    {
      accountId: account.id,
      privateKey: "0x6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7",
    },
  ],
};

const v13 = (qsbAccounts: readonly unknown[]) => ({
  ...v12,
  qsbAccounts,
  schemaVersion: 13,
});

const writer = writerAccount();
const imported = importedAccount();

describe("schema v13 (current)", () => {
  test("is the current version, reached by exactly one adjacent step", () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(13);
    expect(VAULT_MIGRATIONS.at(-1)).toMatchObject({ fromVersion: 12, toVersion: 13 });
    expect(isVaultV13(emptyVault())).toBe(true);
    expect(emptyVault().qsbAccounts).toEqual([]);
  });

  test("old: a v12 vault migrates to an empty QSB collection and nothing else", () => {
    expect(isVaultV12(v12)).toBe(true);
    expect(migrateVault(v12) as unknown).toEqual(v13([]));
    expect(migrateVault(structuredClone(v12))).toEqual(migrateVault(v12));
    // A v12 vault cannot already hold the v13 collection, and v13 needs it.
    expect(isVaultV12({ ...v12, qsbAccounts: [] })).toBe(false);
    const { qsbAccounts: _qsb, ...missing } = v13([]);
    expect(isVaultV13(missing)).toBe(false);
    expect(() => migrateVault(missing)).toThrow("Unsupported vault schema");
  });

  test("current: valid QSB accounts with dedicated phrases validate and stay unchanged", () => {
    for (const vault of [v13([]), v13([writer]), v13([writer, imported])]) {
      expect(isVaultV13(vault)).toBe(true);
      expect(migrateVault(vault) as unknown).toBe(vault);
    }
    // A phrase-less vault (Ledger-only, raw key) still holds QSB accounts.
    expect(isVaultV13({ ...v13([writer]), mnemonic: null })).toBe(true);
  });

  const invalid: readonly (readonly [string, readonly unknown[], Record<string, unknown>?])[] = [
    ["a malformed account", [{ ...writer, journalId: "00" }]],
    [
      "an account keeping its journal in the vault",
      [{ ...writer, nextV: 1, vaults: [allocatedVault(0)] }],
    ],
    ["two accounts with one id", [writer, { ...imported, id: writer.id }]],
    ["two accounts with one journal", [writer, { ...imported, journalId: JOURNAL_ID_A }]],
    ["two accounts with one phrase", [writer, { ...imported, mnemonic: PHRASE_A }]],
    ["a QSB phrase that is the founding phrase", [writer], { mnemonic: PHRASE_A }],
    [
      "a QSB phrase that is an imported Starknet phrase",
      [writer],
      { importedSeeds: [{ id: "phrase-1", mnemonic: PHRASE_A }] },
    ],
    ["a non-array collection", "none" as unknown as readonly unknown[]],
  ];
  for (const [name, qsbAccounts, overrides] of invalid) {
    test(`invalid: ${name} fails the whole vault closed`, () => {
      const vault = { ...v13(qsbAccounts), ...overrides };
      expect(isVaultV13(vault)).toBe(false);
      expect(() => migrateVault(vault)).toThrow("Unsupported vault schema");
    });
  }

  // Distinct accounts: each its own id, journal id, and 24-word spelling.
  const many = Array.from({ length: MAX_QSB_ACCOUNTS + 1 }, (_, index) => ({
    ...importedAccount(),
    id: `qsb-${index + 1}`,
    journalId: `${index.toString(16).padStart(2, "0")}${JOURNAL_ID_A.slice(2)}`,
    mnemonic: ([PHRASE_A, PHRASE_B, PHRASE_C][index % 3] ?? PHRASE_A)
      .split(" ")
      .map((word, position) => (position === index ? "zoo" : word))
      .join(" "),
  }));

  test("invalid: one account past the bound is refused, never truncated", () => {
    expect(isVaultV13(v13(many.slice(0, MAX_QSB_ACCOUNTS)))).toBe(true);
    expect(isVaultV13(v13(many))).toBe(false);
  });

  test("a full QSB collection is account-level only and stays small in the vault", () => {
    // Journals live under their own keys, so every QSB account the vault can
    // hold fits in a sixteenth of its budget, whatever their journals hold.
    const sixteenth = { ...JSON_BUDGETS.provider, maxBytes: JSON_BUDGETS.provider.maxBytes / 16 };
    expect(isJsonWithinBudget(many.slice(0, MAX_QSB_ACCOUNTS), sixteenth)).toBe(true);
  });
});
