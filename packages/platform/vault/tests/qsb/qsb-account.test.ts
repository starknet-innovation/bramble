/**
 * QSB account and vault-record validators: every structural rule of the BIP
 * manifest record, Bramble's writer rules, and the single-sourced limits.
 * Invalid data fails closed; limits refuse rather than drop.
 */
import { describe, expect, test } from "bun:test";
import {
  hasValidQsbAccounts,
  isQsbAccountId,
  isQsbAccountRecord,
  isQsbMnemonic,
  isQsbVaultRecord,
  isQsbWriter,
  MAX_QSB_ACCOUNTS,
  MAX_QSB_VAULTS_PER_ACCOUNT,
  nextQsbAccountId,
  QSB_MAX_SCRIPT_BYTES,
  QSB_MAX_TRANSACTION_BYTES,
  QSB_MAX_VALUE_SAT,
  QSB_VAULT_INDEX_LIMIT,
} from "@bramble/vault/qsb-account";
import { canonicalAccountId, isAccountId, isImportedSeedId } from "@bramble/wallet-model/accounts";
import {
  allocatedVault,
  bindingTransaction,
  DISCLOSURE,
  exposedVault,
  FEE_OUTPOINT,
  FUNDING,
  fundedVault,
  importedAccount,
  P2TR,
  PHRASE_A,
  PHRASE_B,
  PHRASE_C,
  ROOT_V7,
  SCRIPT,
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

describe("QSB accounts", () => {
  test("admit a writer's journal and an imported read-only one", () => {
    const writer = writerAccount([allocatedVault(0), exposedVault(3)], 5);
    expect(isQsbAccountRecord(writer)).toBe(true);
    expect(isQsbWriter(writer)).toBe(true);
    const imported = importedAccount([
      { ...exposedVault(0), state: "unknown" },
      { ...allocatedVault(2), state: "retired" },
    ]);
    expect(isQsbAccountRecord(imported)).toBe(true);
    expect(isQsbWriter(imported)).toBe(false);
  });

  test("an imported journal holds nothing it could still disclose from", () => {
    expect(isQsbAccountRecord(importedAccount([allocatedVault(0)]))).toBe(false);
    expect(isQsbAccountRecord(importedAccount([exposedVault(0)]))).toBe(false);
  });

  test("nothing is allocated before the backup is confirmed", () => {
    const fresh = { ...writerAccount(), backupConfirmed: false };
    expect(isQsbAccountRecord(fresh)).toBe(true);
    expect(isQsbWriter(fresh)).toBe(false);
    expect(isQsbAccountRecord({ ...fresh, nextV: 1 })).toBe(false);
    expect(
      isQsbAccountRecord({ ...writerAccount([allocatedVault(0)]), backupConfirmed: false }),
    ).toBe(false);
  });

  test("the journal is strictly ascending and below its high-water mark", () => {
    expect(isQsbAccountRecord(writerAccount([allocatedVault(2), allocatedVault(1)], 3))).toBe(
      false,
    );
    expect(isQsbAccountRecord(writerAccount([allocatedVault(1), allocatedVault(1)], 3))).toBe(
      false,
    );
    expect(isQsbAccountRecord(writerAccount([allocatedVault(3)], 3))).toBe(false);
    expect(isQsbAccountRecord(writerAccount([], QSB_VAULT_INDEX_LIMIT))).toBe(true);
    expect(isQsbAccountRecord(writerAccount([], QSB_VAULT_INDEX_LIMIT + 1))).toBe(false);
  });

  test("the journal is bounded: one past the limit fails, never truncated", () => {
    const vaults = Array.from({ length: MAX_QSB_VAULTS_PER_ACCOUNT + 1 }, (_, v) =>
      allocatedVault(v),
    );
    expect(isQsbAccountRecord(writerAccount(vaults.slice(0, MAX_QSB_VAULTS_PER_ACCOUNT)))).toBe(
      true,
    );
    expect(isQsbAccountRecord(writerAccount(vaults))).toBe(false);
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
    ["a missing journal", { ...writerAccount(), vaults: undefined }],
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

  test("admits distinct accounts with dedicated phrases", () => {
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

  test("refuses a repeated id and a collection past the account bound", () => {
    expect(hasValidQsbAccounts([writerAccount(), { ...second, id: "qsb-1" }], [])).toBe(false);
    const phrases = [PHRASE_A, PHRASE_B, PHRASE_C];
    const many = Array.from({ length: MAX_QSB_ACCOUNTS + 1 }, (_, index) => ({
      ...importedAccount(),
      id: `qsb-${index + 1}`,
      // Distinct 24-word spellings: each account's own word order.
      mnemonic: [...(phrases[index % 3] ?? PHRASE_A).split(" ")]
        .map((word, position) => (position === index ? "zoo" : word))
        .join(" "),
    }));
    expect(hasValidQsbAccounts(many.slice(0, MAX_QSB_ACCOUNTS), [])).toBe(true);
    expect(hasValidQsbAccounts(many, [])).toBe(false);
    expect(hasValidQsbAccounts("none", [])).toBe(false);
  });
});
