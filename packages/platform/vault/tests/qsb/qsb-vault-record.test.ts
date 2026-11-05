/**
 * QSB vault-record validators: every structural rule of the BIP manifest
 * vault record (grammars, ranges, ordered distinct indices, the cross-field
 * rules, and T spending its funding exactly once). Invalid data fails closed.
 */
import { describe, expect, test } from "bun:test";
import {
  isQsbVaultRecord,
  QSB_MAX_SCRIPT_BYTES,
  QSB_MAX_TRANSACTION_BYTES,
  QSB_MAX_VALUE_SAT,
  QSB_VAULT_INDEX_LIMIT,
} from "@bramble/vault/qsb-vault-record";
import {
  allocatedVault,
  bindingTransaction,
  DISCLOSURE,
  exposedVault,
  FEE_OUTPOINT,
  FUNDING,
  fundedVault,
  P2TR,
  ROOT_V7,
  SCRIPT,
} from "./qsb-fixtures";

describe("QSB vault records", () => {
  test("admit every BIP state in its valid shape", () => {
    for (const vault of [
      allocatedVault(0),
      { ...allocatedVault(0), scriptHash: fundedVault(0).scriptHash, scriptPubKey: SCRIPT },
      fundedVault(0),
      exposedVault(0),
      { ...exposedVault(0), state: "retired" as const },
      { ...exposedVault(0), state: "unknown" as const },
      { ...allocatedVault(0), state: "retired" as const },
      { ...allocatedVault(QSB_VAULT_INDEX_LIMIT - 1), state: "unknown" as const },
    ]) {
      expect(isQsbVaultRecord(vault)).toBe(true);
    }
  });

  const invalid: readonly (readonly [string, unknown])[] = [
    ["a negative index", { ...allocatedVault(0), v: -1 }],
    ["an index of 2^31", { ...allocatedVault(0), v: QSB_VAULT_INDEX_LIMIT }],
    ["a fractional index", { ...allocatedVault(0), v: 1.5 }],
    ["a short root", { ...allocatedVault(0), root: ROOT_V7.slice(2) }],
    ["an uppercase root", { ...allocatedVault(0), root: ROOT_V7.toUpperCase() }],
    ["a prefixed root", { ...allocatedVault(0), root: `0x${ROOT_V7.slice(2)}` }],
    ["a script without its hash", { ...allocatedVault(0), scriptPubKey: SCRIPT }],
    ["a hash without its script", { ...fundedVault(0), funding: null, scriptPubKey: null }],
    ["an empty script", { ...fundedVault(0), scriptPubKey: "" }],
    ["an odd-length script", { ...fundedVault(0), scriptPubKey: `${SCRIPT}a` }],
    ["a script past 10,000 bytes", { ...fundedVault(0), scriptPubKey: "6a".repeat(10_001) }],
    ["funding without a script", { ...allocatedVault(0), funding: FUNDING }],
    ["funding with a short txid", { ...fundedVault(0), funding: { ...FUNDING, txid: "ab" } }],
    ["funding past 2^32 - 1", { ...fundedVault(0), funding: { ...FUNDING, vout: 2 ** 32 } }],
    [
      "funding past 21 million BTC",
      { ...fundedVault(0), funding: { ...FUNDING, valueSat: QSB_MAX_VALUE_SAT + 1 } },
    ],
    ["funding with an extra member", { ...fundedVault(0), funding: { ...FUNDING, memo: "x" } }],
    ["an exposed record without a disclosure", { ...fundedVault(0), state: "exposed" }],
    ["an exposed record without funding", { ...exposedVault(0), funding: null }],
    ["an allocated record with a disclosure", { ...exposedVault(0), state: "allocated" }],
    ["a disclosure without funding", { ...exposedVault(0), funding: null, state: "unknown" }],
    ["an unknown state", { ...allocatedVault(0), state: "spent" }],
    ["an unknown member", { ...allocatedVault(0), label: "savings" }],
    ["a missing member", { ...allocatedVault(0), disclosure: undefined }],
  ];
  for (const [name, record] of invalid) {
    test(`refuse ${name}`, () => {
      expect(isQsbVaultRecord(record)).toBe(false);
    });
  }

  const withDisclosure = (overrides: Record<string, unknown>): unknown => ({
    ...exposedVault(0),
    disclosure: { ...DISCLOSURE, ...overrides },
  });
  const disclosures: readonly (readonly [string, Record<string, unknown>])[] = [
    ["seven round-0 indices", { round0: DISCLOSURE.round0.slice(0, 7) }],
    ["nine round-0 indices", { round0: [...DISCLOSURE.round0, 8] }],
    ["a repeated round-0 index", { round0: [0, 1, 2, 3, 4, 5, 6, 6] }],
    ["a round-0 index of 150", { round0: [0, 1, 2, 3, 4, 5, 6, 150] }],
    ["a negative round-1 index", { round1: [-1, 141, 142, 143, 144, 145, 146] }],
    ["eight round-1 indices", { round1: [...DISCLOSURE.round1, 147] }],
    ["a fractional index", { round1: [140.5, 141, 142, 143, 144, 145, 146] }],
    ["a short digest", { digest: DISCLOSURE.digest.slice(2) }],
    ["an empty transaction", { transaction: "" }],
    ["a transaction past the bound", { transaction: "00".repeat(QSB_MAX_TRANSACTION_BYTES + 1) }],
    ["a truncated transaction", { transaction: DISCLOSURE.transaction.slice(0, -2) }],
    ["trailing transaction bytes", { transaction: `${DISCLOSURE.transaction}00` }],
    [
      "a transaction that never spends the vault",
      { transaction: bindingTransaction([FEE_OUTPOINT], [{ script: P2TR, valueSat: 1 }]) },
    ],
    [
      "a transaction that spends the vault twice",
      {
        transaction: bindingTransaction([FUNDING, FUNDING], [{ script: P2TR, valueSat: 1 }]),
      },
    ],
    ["an extra member", { binding: "verified" }],
  ];
  for (const [name, overrides] of disclosures) {
    test(`refuse a disclosure with ${name}`, () => {
      expect(isQsbVaultRecord(withDisclosure(overrides))).toBe(false);
    });
  }

  test("keep disclosure indices in the order given, the same index in both rounds", () => {
    const reordered = { round0: [7, 6, 5, 4, 3, 2, 1, 0], round1: [7, 6, 5, 4, 3, 2, 1] };
    expect(isQsbVaultRecord(withDisclosure(reordered))).toBe(true);
    expect(QSB_MAX_SCRIPT_BYTES).toBe(10_000);
  });
});
