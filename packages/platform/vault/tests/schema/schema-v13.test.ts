/**
 * Schema v13: Quantum Safe Bitcoin accounts, each a dedicated phrase with its
 * disclosure journal, inside the encrypted vault.
 *
 * Old data: a v12 vault migrates to an empty QSB collection and nothing else
 * changes; no journal is invented. Current data: valid accounts with dedicated
 * phrases validate. Invalid data: any malformed, duplicated, shared-phrase, or
 * over-bound account makes the whole vault fail closed, like any other corrupt
 * vault content.
 */
import { describe, expect, test } from "bun:test";
import { isJson } from "@bramble/core/json";
import { migrateVault, VAULT_MIGRATIONS } from "@bramble/vault/migrations";
import { hasValidQsbAccounts, MAX_QSB_ACCOUNTS } from "@bramble/vault/qsb-account";
import { CURRENT_SCHEMA_VERSION, emptyVault, isVaultV12, isVaultV13 } from "@bramble/vault/schema";
import {
  allocatedVault,
  exposedVault,
  importedAccount,
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

const writer = writerAccount([allocatedVault(0), exposedVault(2)], 4);
const imported = { ...importedAccount([{ ...exposedVault(0), state: "unknown" as const }]) };

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
    ["a malformed account", [{ ...writer, nextV: -1 }]],
    ["an imported account holding an exposed set", [importedAccount([exposedVault(0)])]],
    ["an unconfirmed backup with a vault", [{ ...writer, backupConfirmed: false }]],
    ["two accounts with one id", [writer, { ...imported, id: writer.id }]],
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

  test("invalid: one account past the bound is refused, never truncated", () => {
    const phrases = [PHRASE_A, PHRASE_B, PHRASE_C];
    const many = Array.from({ length: MAX_QSB_ACCOUNTS + 1 }, (_, index) => ({
      ...importedAccount(),
      id: `qsb-${index + 1}`,
      mnemonic: (phrases[index % 3] ?? PHRASE_A)
        .split(" ")
        .map((word, position) => (position === index ? "zoo" : word))
        .join(" "),
    }));
    expect(isVaultV13(v13(many.slice(0, MAX_QSB_ACCOUNTS)))).toBe(true);
    expect(isVaultV13(v13(many))).toBe(false);
  });

  test("invalid: a vault past the shared JSON budget fails on read as on write", () => {
    // QSB records count against the same capacity as everything else in the
    // vault, so a vault the write path would refuse is not readable either.
    // Each exposed record here carries a 6,301-byte script.
    const heavy = writerAccount(Array.from({ length: 64 }, (_, v) => exposedVault(v)));
    expect(hasValidQsbAccounts([heavy], [])).toBe(true);
    expect(isJson(v13([heavy]))).toBe(false);
    expect(isVaultV13(v13([heavy]))).toBe(false);
    const light = writerAccount(Array.from({ length: 4 }, (_, v) => exposedVault(v)));
    expect(isVaultV13(v13([light]))).toBe(true);
  });
});
