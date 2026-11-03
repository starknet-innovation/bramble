/**
 * Pure QSB journal transitions, and the BIP custody events ("Reference
 * Implementation and Test Vectors") that apply at this layer: durable-record
 * failure before release, power loss after recording, partial response and
 * exact retry, changed transaction or index order, duplicate and out-of-range
 * indices, full storage, allocation exhaustion, and a reorganization after
 * disclosure. No event may make an exposed key set fresh.
 */
import { describe, expect, test } from "bun:test";
import {
  isQsbAccountRecord,
  MAX_QSB_VAULTS_PER_ACCOUNT,
  QSB_VAULT_INDEX_LIMIT,
  type QsbAccountRecord,
  type QsbVaultRecord,
} from "@bramble/vault/qsb-account";
import {
  allocateQsbVault,
  associateQsbScript,
  markQsbVaultUnknown,
  type QsbJournalResult,
  recordQsbExposure,
  recordQsbFunding,
  retireQsbVault,
} from "@bramble/vault/qsb-journal";
import {
  allocatedVault,
  bindingTransaction,
  DISCLOSURE,
  exposedVault,
  FEE_OUTPOINT,
  FUNDING,
  fundedVault,
  importedAccount,
  OTHER_SCRIPT,
  P2TR,
  ROOT_V0,
  ROOT_V7,
  SCRIPT,
  SCRIPT_HASH,
  writerAccount,
} from "./qsb-fixtures";

const accountOf = (result: QsbJournalResult): QsbAccountRecord => {
  if (!result.ok) throw new Error(`refused: ${result.refusal}`);
  return result.account;
};

const deepFrozen = <T>(value: T): T => {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) deepFrozen(child);
    Object.freeze(value);
  }
  return value;
};

// Walks one vault from allocation to its committed disclosure, as the
// background would after each Krusty check.
const exposedJournal = (): QsbAccountRecord => {
  const allocated = accountOf(allocateQsbVault(writerAccount(), { root: ROOT_V0, v: 0 }));
  const scripted = accountOf(
    associateQsbScript(allocated, { scriptHash: SCRIPT_HASH, scriptPubKey: SCRIPT, v: 0 }),
  );
  const funded = accountOf(recordQsbFunding(scripted, { funding: FUNDING, v: 0 }));
  return accountOf(recordQsbExposure(funded, exposedVault(0)));
};

describe("allocation", () => {
  test("reserves nextV, advances the mark, and produces a valid journal", () => {
    const next = accountOf(allocateQsbVault(writerAccount(), { root: ROOT_V0, v: 0 }));
    expect(next.nextV).toBe(1);
    expect(next.vaults).toEqual([allocatedVault(0)]);
    expect(isQsbAccountRecord(next)).toBe(true);
    const again = accountOf(allocateQsbVault(next, { root: ROOT_V7, v: 1 }));
    expect(again.vaults.map((vault) => vault.v)).toEqual([0, 1]);
  });

  test("only a writer allocates", () => {
    expect(allocateQsbVault(importedAccount(), { root: ROOT_V0, v: 0 })).toEqual({
      ok: false,
      refusal: "not-writer",
    });
    const unconfirmed = { ...writerAccount(), backupConfirmed: false };
    expect(allocateQsbVault(unconfirmed, { root: ROOT_V0, v: 0 })).toEqual({
      ok: false,
      refusal: "not-writer",
    });
  });

  test("a root derived for any other index is stale, and a missing index stays reserved", () => {
    // Index 1 was allocated and later dropped from the journal: it stays below
    // nextV, so no allocation can ever reach it again.
    const compacted = writerAccount([allocatedVault(0), allocatedVault(2)], 3);
    for (const v of [0, 1, 2, 4]) {
      expect(allocateQsbVault(compacted, { root: ROOT_V0, v })).toEqual({
        ok: false,
        refusal: "stale-index",
      });
    }
    expect(allocateQsbVault(compacted, { root: ROOT_V0, v: 3 }).ok).toBe(true);
  });

  test("refuses a malformed root", () => {
    expect(allocateQsbVault(writerAccount(), { root: ROOT_V0.toUpperCase(), v: 0 })).toEqual({
      ok: false,
      refusal: "invalid-request",
    });
  });

  test("allocation exhaustion: at 2^31 it fails and never wraps", () => {
    const last = writerAccount([], QSB_VAULT_INDEX_LIMIT - 1);
    const full = accountOf(allocateQsbVault(last, { root: ROOT_V0, v: QSB_VAULT_INDEX_LIMIT - 1 }));
    expect(full.nextV).toBe(QSB_VAULT_INDEX_LIMIT);
    for (const v of [QSB_VAULT_INDEX_LIMIT, 0]) {
      expect(allocateQsbVault(full, { root: ROOT_V0, v })).toEqual({
        ok: false,
        refusal: "allocation-exhausted",
      });
    }
  });

  test("full storage: past the journal bound it refuses and drops nothing", () => {
    const vaults = Array.from({ length: MAX_QSB_VAULTS_PER_ACCOUNT }, (_, v) => allocatedVault(v));
    const account = writerAccount(vaults);
    expect(allocateQsbVault(account, { root: ROOT_V0, v: account.nextV })).toEqual({
      ok: false,
      refusal: "journal-full",
    });
    expect(account.vaults).toHaveLength(MAX_QSB_VAULTS_PER_ACCOUNT);
  });
});

describe("script and funding association", () => {
  const allocated = writerAccount([allocatedVault(0)]);

  test("a script is set once; the same again is a no-op, another is refused", () => {
    const request = { scriptHash: SCRIPT_HASH, scriptPubKey: SCRIPT, v: 0 };
    const scripted = accountOf(associateQsbScript(allocated, request));
    expect(scripted.vaults[0]?.scriptPubKey).toBe(SCRIPT);
    expect(accountOf(associateQsbScript(scripted, request))).toBe(scripted);
    expect(associateQsbScript(scripted, { ...request, scriptPubKey: OTHER_SCRIPT })).toEqual({
      ok: false,
      refusal: "record-mismatch",
    });
    expect(associateQsbScript(allocated, { ...request, scriptHash: "00" })).toEqual({
      ok: false,
      refusal: "invalid-request",
    });
    expect(associateQsbScript(allocated, { ...request, v: 1 })).toEqual({
      ok: false,
      refusal: "unknown-vault",
    });
  });

  test("a vault is funded once and only after its script exists", () => {
    expect(recordQsbFunding(allocated, { funding: FUNDING, v: 0 })).toEqual({
      ok: false,
      refusal: "state-conflict",
    });
    const funded = writerAccount([fundedVault(0)]);
    expect(accountOf(recordQsbFunding(funded, { funding: FUNDING, v: 0 }))).toBe(funded);
    expect(recordQsbFunding(funded, { funding: { ...FUNDING, vout: 0 }, v: 0 })).toEqual({
      ok: false,
      refusal: "record-mismatch",
    });
  });
});

describe("disclosure", () => {
  test("commits exposed from allocated, with root, script, and funding unchanged", () => {
    const account = exposedJournal();
    expect(account.vaults).toEqual([exposedVault(0)]);
    expect(isQsbAccountRecord(account)).toBe(true);
  });

  test("durable-record failure before release: the input record is never mutated", () => {
    // If the write of the returned record fails, the caller still holds the
    // untouched allocated journal and has released nothing.
    const funded = deepFrozen(writerAccount([fundedVault(0)]));
    const result = recordQsbExposure(funded, exposedVault(0));
    expect(result.ok).toBe(true);
    expect(funded.vaults[0]?.state).toBe("allocated");
  });

  test("power loss after recording, partial response: only the exact retry passes", () => {
    const account = exposedJournal();
    expect(accountOf(recordQsbExposure(account, exposedVault(0)))).toBe(account);
  });

  const retries: readonly (readonly [string, QsbVaultRecord])[] = [
    [
      "a reordered round-0 index list",
      { ...exposedVault(0), disclosure: { ...DISCLOSURE, round0: [1, 0, 2, 3, 4, 5, 6, 7] } },
    ],
    [
      "a different round-1 index",
      {
        ...exposedVault(0),
        disclosure: { ...DISCLOSURE, round1: [140, 141, 142, 143, 144, 145, 149] },
      },
    ],
    [
      "a changed transaction (fee replacement)",
      {
        ...exposedVault(0),
        disclosure: {
          ...DISCLOSURE,
          transaction: bindingTransaction(
            [FUNDING, FEE_OUTPOINT],
            [{ script: P2TR, valueSat: 230_000 }],
          ),
        },
      },
    ],
    [
      "a changed sequence",
      {
        ...exposedVault(0),
        disclosure: {
          ...DISCLOSURE,
          transaction: bindingTransaction(
            [FUNDING, FEE_OUTPOINT],
            [{ script: P2TR, valueSat: 240_000 }],
            "ffffffff",
          ),
        },
      },
    ],
    ["a different digest", { ...exposedVault(0), disclosure: { ...DISCLOSURE, digest: ROOT_V7 } }],
  ];
  for (const [name, proposed] of retries) {
    test(`after exposure, refuses ${name}`, () => {
      const account = exposedJournal();
      expect(recordQsbExposure(account, proposed)).toEqual({
        ok: false,
        refusal: "record-mismatch",
      });
    });
  }

  test("refuses duplicate and out-of-range indices before any state check", () => {
    const funded = writerAccount([fundedVault(0)]);
    for (const round0 of [
      [0, 0, 1, 2, 3, 4, 5, 6],
      [0, 1, 2, 3, 4, 5, 6, 150],
    ]) {
      const proposed = { ...exposedVault(0), disclosure: { ...DISCLOSURE, round0 } };
      expect(recordQsbExposure(funded, proposed)).toEqual({
        ok: false,
        refusal: "invalid-request",
      });
    }
    expect(recordQsbExposure(funded, fundedVault(0))).toEqual({
      ok: false,
      refusal: "invalid-request",
    });
  });

  test("an exposure must match what is committed, and funding must be recorded first", () => {
    const scripted = writerAccount([{ ...fundedVault(0), funding: null }]);
    expect(recordQsbExposure(scripted, exposedVault(0))).toEqual({
      ok: false,
      refusal: "record-mismatch",
    });
    const funded = writerAccount([fundedVault(0)]);
    expect(recordQsbExposure(funded, { ...exposedVault(0), root: ROOT_V7 })).toEqual({
      ok: false,
      refusal: "record-mismatch",
    });
    expect(recordQsbExposure(funded, exposedVault(1))).toEqual({
      ok: false,
      refusal: "unknown-vault",
    });
  });

  test("an imported account never discloses", () => {
    const imported = importedAccount([{ ...fundedVault(0), state: "unknown" }]);
    expect(recordQsbExposure(imported, exposedVault(0))).toEqual({
      ok: false,
      refusal: "not-writer",
    });
  });
});

describe("retirement and uncertainty", () => {
  test("a reorganization after disclosure never makes the key set fresh", () => {
    const exposed = exposedJournal();
    // The background may mark the history uncertain or retire it; neither path
    // leads back to allocated, and no exposure is accepted afterwards.
    const unknown = accountOf(markQsbVaultUnknown(exposed, 0));
    expect(unknown.vaults[0]).toEqual({ ...exposedVault(0), state: "unknown" });
    expect(recordQsbExposure(unknown, exposedVault(0))).toEqual({
      ok: false,
      refusal: "state-conflict",
    });
    const retired = accountOf(retireQsbVault(unknown, 0));
    expect(retired.vaults[0]).toEqual({ ...exposedVault(0), state: "retired" });
    expect(markQsbVaultUnknown(retired, 0)).toEqual({ ok: false, refusal: "state-conflict" });
    expect(recordQsbExposure(retired, exposedVault(0))).toEqual({
      ok: false,
      refusal: "state-conflict",
    });
    expect(allocateQsbVault(retired, { root: ROOT_V0, v: 0 })).toEqual({
      ok: false,
      refusal: "stale-index",
    });
  });

  test("retire and markUnknown are idempotent and keep every field", () => {
    const retired = accountOf(retireQsbVault(writerAccount([allocatedVault(0)]), 0));
    expect(accountOf(retireQsbVault(retired, 0))).toBe(retired);
    const unknown = accountOf(markQsbVaultUnknown(writerAccount([fundedVault(0)]), 0));
    expect(unknown.vaults[0]).toEqual({ ...fundedVault(0), state: "unknown" });
    expect(accountOf(markQsbVaultUnknown(unknown, 0))).toBe(unknown);
    expect(retireQsbVault(unknown, 9)).toEqual({ ok: false, refusal: "unknown-vault" });
    expect(markQsbVaultUnknown(unknown, 9)).toEqual({ ok: false, refusal: "unknown-vault" });
  });

  test("an imported account may still restrict its own records", () => {
    const imported = importedAccount([{ ...fundedVault(0), state: "unknown" }]);
    expect(accountOf(retireQsbVault(imported, 0)).vaults[0]?.state).toBe("retired");
  });
});
