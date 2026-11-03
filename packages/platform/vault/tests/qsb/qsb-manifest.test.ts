/**
 * The `qsb-secret-manifest` v1 codec: export never carries the phrase and
 * spells exactly the BIP members; import is strict (duplicate members,
 * unknown members, invalid UTF-8, trailing data, non-integral numbers) and
 * validates every structural rule, then returns imported history as unknown
 * (retired stays retired). Covers the "duplicate JSON members and
 * inconsistent manifest data" and "unknown profiles" custody events.
 */
import { describe, expect, test } from "bun:test";
import { MAX_QSB_VAULTS_PER_ACCOUNT, type QsbAccountRecord } from "@bramble/vault/qsb-account";
import {
  exportQsbManifest,
  importQsbManifest,
  QSB_MANIFEST_BUDGET,
  type QsbManifestRefusal,
} from "@bramble/vault/qsb-manifest";
import { mergeImportedQsbJournal } from "@bramble/vault/qsb-merge";
import {
  allocatedVault,
  DISCLOSURE,
  exposedVault,
  FUNDING,
  fundedVault,
  importedAccount,
  PHRASE_A,
  ROOT_V7,
  SCRIPT,
  SCRIPT_HASH,
  writerAccount,
} from "./qsb-fixtures";

const writer = writerAccount(
  [allocatedVault(0), fundedVault(2), exposedVault(3), { ...fundedVault(5), state: "retired" }],
  7,
);

const manifestText = (account: QsbAccountRecord = writer): string =>
  JSON.stringify(exportQsbManifest(account));

const refusalOf = (input: string | Uint8Array): QsbManifestRefusal | null => {
  const result = importQsbManifest(input);
  return result.ok ? null : result.refusal;
};

// The exported manifest as a plain object to tamper with.
const manifest = (): Record<string, unknown> & { vaults: Record<string, unknown>[] } =>
  JSON.parse(manifestText());

const withVault = (index: number, overrides: Record<string, unknown>): string => {
  const value = manifest();
  value.vaults[index] = { ...value.vaults[index], ...overrides };
  return JSON.stringify(value);
};

describe("exportQsbManifest", () => {
  test("spells exactly the BIP members and never the phrase", () => {
    const text = manifestText();
    expect(text).not.toContain(PHRASE_A);
    expect(text).not.toContain("mnemonic");
    expect(text).not.toContain("backupConfirmed");
    const value = manifest();
    expect(Object.keys(value).sort()).toEqual(
      ["format", "network", "next_v", "profile", "seed_source", "vaults", "version"].sort(),
    );
    expect(value).toMatchObject({
      format: "qsb-secret-manifest",
      network: "bitcoin-mainnet",
      next_v: 7,
      profile: "QSB-HORS-v1",
      seed_source: "bip39",
      version: 1,
    });
    expect(value.vaults[2]).toEqual({
      disclosure: DISCLOSURE,
      funding: { txid: FUNDING.txid, value_sat: FUNDING.valueSat, vout: FUNDING.vout },
      root: exposedVault(3).root,
      script_hash: SCRIPT_HASH,
      script_pubkey: SCRIPT,
      state: "exposed",
      v: 3,
    });
  });

  test("exports nothing for an invalid record", () => {
    expect(exportQsbManifest({ ...writer, nextV: 3 })).toBeNull();
  });
});

describe("importQsbManifest", () => {
  test("round-trips an export as imported history, retired kept retired", () => {
    const result = importQsbManifest(manifestText());
    if (!result.ok) throw new Error(result.refusal);
    expect(result.manifest.nextV).toBe(7);
    expect(result.manifest.seedContext).toEqual({ provenance: "imported", source: "bip39" });
    expect(result.manifest.vaults.map((vault) => [vault.v, vault.state])).toEqual([
      [0, "unknown"],
      [2, "unknown"],
      [3, "unknown"],
      [5, "retired"],
    ]);
    expect(result.manifest.vaults[2]).toEqual({ ...exposedVault(3), state: "unknown" });
    // Bytes read the same, and the result merges into a read-only account.
    expect(importQsbManifest(new TextEncoder().encode(manifestText()))).toEqual(result);
    expect(mergeImportedQsbJournal(importedAccount(), result.manifest).ok).toBe(true);
  });

  test("ignores member order and whitespace", () => {
    expect(importQsbManifest(JSON.stringify(manifest(), null, 2)).ok).toBe(true);
    const value = manifest();
    const reversed = Object.fromEntries(Object.entries(value).reverse());
    expect(importQsbManifest(JSON.stringify(reversed)).ok).toBe(true);
  });

  const strict: readonly (readonly [string, string | Uint8Array, QsbManifestRefusal])[] = [
    [
      "a duplicate top-level member",
      manifestText().replace('"next_v":7', '"next_v":7,"next_v":1'),
      "duplicate-member",
    ],
    [
      "a duplicate member inside a vault",
      manifestText().replace('"state":"exposed"', '"state":"exposed","state":"allocated"'),
      "duplicate-member",
    ],
    ["trailing data", `${manifestText()}{}`, "trailing-data"],
    ["a byte-order mark", `﻿${manifestText()}`, "invalid-syntax"],
    [
      "invalid UTF-8",
      new Uint8Array([...new TextEncoder().encode(manifestText().slice(0, -1)), 0xc3, 0x28, 0x7d]),
      "invalid-encoding",
    ],
    [
      "a fractional mark",
      manifestText().replace('"next_v":7', '"next_v":7.0'),
      "non-integral-number",
    ],
    ["an exponent index", manifestText().replace('"v":0', '"v":0e0'), "non-integral-number"],
    ["not JSON", "qsb-secret-manifest", "invalid-syntax"],
    ["an oversized input", " ".repeat(QSB_MANIFEST_BUDGET.maxBytes + 1), "budget-exceeded"],
    // Longer than any script or transaction the format admits: refused as a
    // resource bound before the 10,000-byte script rule is even reached.
    [
      "a script past 10,000 bytes",
      manifestText().replace(SCRIPT, "6a".repeat(10_001)),
      "budget-exceeded",
    ],
  ];
  for (const [name, input, refusal] of strict) {
    test(`refuses ${name}`, () => {
      expect(refusalOf(input)).toBe(refusal);
    });
  }

  const header = (overrides: Record<string, unknown>): string =>
    JSON.stringify({ ...manifest(), ...overrides });
  const headers: readonly (readonly [string, Record<string, unknown>, QsbManifestRefusal])[] = [
    ["another format", { format: "qsb-manifest" }, "unsupported-format"],
    ["version 2", { version: 2 }, "unsupported-version"],
    ["an unknown profile", { profile: "QSB-HORS-v2" }, "unsupported-profile"],
    ["a raw32 seed source", { seed_source: "raw32" }, "unsupported-source"],
    ["an unknown seed source", { seed_source: "slip39" }, "invalid-manifest"],
    ["a test network", { network: "bitcoin-testnet" }, "invalid-manifest"],
    ["an extension member", { comment: "backup" }, "invalid-manifest"],
    ["a mark past 2^31", { next_v: 2 ** 31 + 1 }, "invalid-manifest"],
    ["a mark below a recorded index", { next_v: 5 }, "invalid-manifest"],
    ["no vault list", { vaults: null }, "invalid-manifest"],
  ];
  for (const [name, overrides, refusal] of headers) {
    test(`refuses ${name}`, () => {
      expect(refusalOf(header(overrides))).toBe(refusal);
    });
  }

  const records: readonly (readonly [string, number, Record<string, unknown>])[] = [
    ["an unknown vault member", 0, { label: "savings" }],
    ["a camelCase member", 1, { scriptPubKey: SCRIPT }],
    ["an exposed record without a disclosure", 1, { state: "exposed" }],
    ["an allocated record with a disclosure", 2, { state: "allocated" }],
    ["a script without its hash", 1, { script_hash: null }],
    ["funding without a script", 0, { funding: { txid: FUNDING.txid, value_sat: 1, vout: 0 } }],
    ["an uppercase root", 0, { root: ROOT_V7.toUpperCase() }],
    [
      "funding with an extra member",
      1,
      { funding: { ...(manifest().vaults[1]?.["funding"] as object), note: 1 } },
    ],
    ["funding in camelCase", 1, { funding: { txid: FUNDING.txid, valueSat: 1, vout: 1 } }],
    ["a negative amount", 1, { funding: { txid: FUNDING.txid, value_sat: -1, vout: 1 } }],
    [
      "a disclosure with repeated indices",
      2,
      { disclosure: { ...DISCLOSURE, round1: [1, 1, 2, 3, 4, 5, 6] } },
    ],
    [
      "a disclosure whose T does not spend the funding",
      2,
      { funding: { txid: ROOT_V7, value_sat: 1, vout: 1 } },
    ],
    ["a missing state", 0, { state: undefined }],
    ["an unsorted journal", 0, { v: 4 }],
    ["a duplicate index", 1, { v: 0 }],
  ];
  for (const [name, index, overrides] of records) {
    test(`refuses ${name}`, () => {
      expect(refusalOf(withVault(index, overrides))).toBe("invalid-manifest");
    });
  }

  test("refuses more vault records than an account keeps", () => {
    const value = manifest();
    const many = Array.from({ length: MAX_QSB_VAULTS_PER_ACCOUNT + 1 }, (_, v) => ({
      ...value.vaults[0],
      v,
    }));
    expect(refusalOf(JSON.stringify({ ...value, next_v: many.length, vaults: many }))).toBe(
      "budget-exceeded",
    );
    expect(
      importQsbManifest(JSON.stringify({ ...value, next_v: many.length, vaults: many.slice(1) }))
        .ok,
    ).toBe(true);
  });
});
