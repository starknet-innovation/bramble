/**
 * Pure QSB journal transitions over a bound journal, and the BIP custody
 * events ("Reference Implementation and Test Vectors") that apply at this
 * layer: durable-record failure before release, power loss after recording,
 * partial response and exact retry, changed transaction or index order,
 * duplicate and out-of-range indices, corrupt and full storage, allocation
 * exhaustion, and a reorganization after disclosure. No event may make an
 * exposed key set fresh, and an unbound journal refuses everything.
 */
import { describe, expect, test } from "bun:test";
import { QSB_JOURNAL_MAX_BYTES } from "@bramble/core/json";
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
  type BoundQsbJournal,
  bindQsbJournal,
  isQsbJournal,
  type QsbJournalBinding,
  qsbJournalBytes,
} from "@bramble/vault/qsb-journal-record";
import {
  MAX_QSB_VAULTS_PER_ACCOUNT,
  QSB_VAULT_INDEX_LIMIT,
  type QsbVaultRecord,
} from "@bramble/vault/qsb-vault-record";
import {
  allocatedVault,
  bindingTransaction,
  bound,
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

const writer = (vaults: readonly QsbVaultRecord[] = [], nextV?: number): BoundQsbJournal =>
  bound(writerAccount(), vaults, nextV);

// The journal a transition returned, bound again to its account for the next step.
const stepped = (result: QsbJournalResult, account = writerAccount()): BoundQsbJournal => {
  if (!result.ok) throw new Error(`refused: ${result.refusal}`);
  const binding = bindQsbJournal(account, { status: "present", value: result.journal });
  if (binding.status !== "bound") throw new Error(`unbound: ${binding.reason}`);
  return binding;
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
const exposedJournal = (): BoundQsbJournal => {
  const allocated = stepped(allocateQsbVault(writer(), { root: ROOT_V0, v: 0 }));
  const scripted = stepped(
    associateQsbScript(allocated, { scriptHash: SCRIPT_HASH, scriptPubKey: SCRIPT, v: 0 }),
  );
  const funded = stepped(recordQsbFunding(scripted, { funding: FUNDING, v: 0 }));
  return stepped(recordQsbExposure(funded, exposedVault(0)));
};

describe("an unavailable journal", () => {
  const unavailable: readonly QsbJournalBinding[] = [
    bindQsbJournal(writerAccount(), { status: "missing" }),
    bindQsbJournal(writerAccount(), { status: "unreadable" }),
    bindQsbJournal(writerAccount(), { status: "present", value: { corrupt: true } }),
  ];

  test("refuses every transition, for a writer account too", () => {
    for (const binding of unavailable) {
      const refusals = [
        allocateQsbVault(binding, { root: ROOT_V0, v: 0 }),
        associateQsbScript(binding, { scriptHash: SCRIPT_HASH, scriptPubKey: SCRIPT, v: 0 }),
        recordQsbFunding(binding, { funding: FUNDING, v: 0 }),
        recordQsbExposure(binding, exposedVault(0)),
        retireQsbVault(binding, 0),
        markQsbVaultUnknown(binding, 0),
      ];
      for (const result of refusals) {
        expect(result).toEqual({ ok: false, refusal: "journal-unavailable" });
      }
    }
  });
});

describe("allocation", () => {
  test("reserves nextV, advances the mark, and produces a valid journal", () => {
    const next = stepped(allocateQsbVault(writer(), { root: ROOT_V0, v: 0 }));
    expect(next.journal.nextV).toBe(1);
    expect(next.journal.vaults).toEqual([allocatedVault(0)]);
    expect(isQsbJournal(next.journal)).toBe(true);
    const again = stepped(allocateQsbVault(next, { root: ROOT_V7, v: 1 }));
    expect(again.journal.vaults.map((vault) => vault.v)).toEqual([0, 1]);
  });

  test("only a writer allocates", () => {
    expect(allocateQsbVault(bound(importedAccount()), { root: ROOT_V0, v: 0 })).toEqual({
      ok: false,
      refusal: "not-writer",
    });
    const unconfirmed = bound({ ...writerAccount(), backupConfirmed: false });
    expect(allocateQsbVault(unconfirmed, { root: ROOT_V0, v: 0 })).toEqual({
      ok: false,
      refusal: "not-writer",
    });
  });

  test("a root derived for any other index is stale, and a missing index stays reserved", () => {
    // Index 1 was allocated and later dropped from the journal: it stays below
    // nextV, so no allocation can ever reach it again.
    const compacted = writer([allocatedVault(0), allocatedVault(2)], 3);
    for (const v of [0, 1, 2, 4]) {
      expect(allocateQsbVault(compacted, { root: ROOT_V0, v })).toEqual({
        ok: false,
        refusal: "stale-index",
      });
    }
    expect(allocateQsbVault(compacted, { root: ROOT_V0, v: 3 }).ok).toBe(true);
  });

  test("refuses a malformed root", () => {
    expect(allocateQsbVault(writer(), { root: ROOT_V0.toUpperCase(), v: 0 })).toEqual({
      ok: false,
      refusal: "invalid-request",
    });
  });

  test("allocation exhaustion: at 2^31 it fails and never wraps", () => {
    const last = writer([], QSB_VAULT_INDEX_LIMIT - 1);
    const full = stepped(allocateQsbVault(last, { root: ROOT_V0, v: QSB_VAULT_INDEX_LIMIT - 1 }));
    expect(full.journal.nextV).toBe(QSB_VAULT_INDEX_LIMIT);
    for (const v of [QSB_VAULT_INDEX_LIMIT, 0]) {
      expect(allocateQsbVault(full, { root: ROOT_V0, v })).toEqual({
        ok: false,
        refusal: "allocation-exhausted",
      });
    }
  });

  test("full storage: past the record bound it refuses and drops nothing", () => {
    const vaults = Array.from({ length: MAX_QSB_VAULTS_PER_ACCOUNT }, (_, v) => allocatedVault(v));
    const binding = writer(vaults);
    expect(allocateQsbVault(binding, { root: ROOT_V0, v: binding.journal.nextV })).toEqual({
      ok: false,
      refusal: "journal-full",
    });
    expect(binding.journal.vaults).toHaveLength(MAX_QSB_VAULTS_PER_ACCOUNT);
  });

  test("full storage: past the byte cap a funding record refuses, never truncates", () => {
    // Full-size exposed records, then one scripted record whose script is sized
    // to leave 50 bytes of room: recording its funding needs more than that.
    const scripted = (v: number, script: string): QsbVaultRecord => ({
      ...allocatedVault(v),
      scriptHash: SCRIPT_HASH,
      scriptPubKey: script,
    });
    const journalWith = (n: number, script: string) => ({
      ...writer().journal,
      nextV: n + 1,
      vaults: [...Array.from({ length: n }, (_, v) => exposedVault(v)), scripted(n, script)],
    });
    let n = 0;
    while (qsbJournalBytes(journalWith(n + 1, "6a")) <= QSB_JOURNAL_MAX_BYTES - 50) n += 1;
    const room = QSB_JOURNAL_MAX_BYTES - 50 - qsbJournalBytes(journalWith(n, "6a"));
    const script = "6a".repeat(1 + Math.floor(room / 2));
    const binding = writer(journalWith(n, script).vaults, n + 1);
    expect(QSB_JOURNAL_MAX_BYTES - qsbJournalBytes(binding.journal)).toBeLessThanOrEqual(51);
    expect(recordQsbFunding(binding, { funding: FUNDING, v: n })).toEqual({
      ok: false,
      refusal: "journal-full",
    });
    expect(binding.journal.vaults[n]?.funding).toBeNull();
  });
});

describe("script and funding association", () => {
  const allocated = writer([allocatedVault(0)]);

  test("a script is set once; the same again is a no-op, another is refused", () => {
    const request = { scriptHash: SCRIPT_HASH, scriptPubKey: SCRIPT, v: 0 };
    const scripted = stepped(associateQsbScript(allocated, request));
    expect(scripted.journal.vaults[0]?.scriptPubKey).toBe(SCRIPT);
    expect(stepped(associateQsbScript(scripted, request)).journal).toBe(scripted.journal);
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
    const funded = writer([fundedVault(0)]);
    expect(stepped(recordQsbFunding(funded, { funding: FUNDING, v: 0 })).journal).toBe(
      funded.journal,
    );
    expect(recordQsbFunding(funded, { funding: { ...FUNDING, vout: 0 }, v: 0 })).toEqual({
      ok: false,
      refusal: "record-mismatch",
    });
  });
});

describe("disclosure", () => {
  test("commits exposed from allocated, with root, script, and funding unchanged", () => {
    const binding = exposedJournal();
    expect(binding.journal.vaults).toEqual([exposedVault(0)]);
    expect(isQsbJournal(binding.journal)).toBe(true);
  });

  test("durable-record failure before release: the input journal is never mutated", () => {
    // If the write of the returned journal fails, the caller still holds the
    // untouched allocated journal and has released nothing.
    const funded = deepFrozen(writer([fundedVault(0)]));
    const result = recordQsbExposure(funded, exposedVault(0));
    expect(result.ok).toBe(true);
    expect(funded.journal.vaults[0]?.state).toBe("allocated");
  });

  test("power loss after recording, partial response: only the exact retry passes", () => {
    const binding = exposedJournal();
    expect(stepped(recordQsbExposure(binding, exposedVault(0))).journal).toBe(binding.journal);
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
      expect(recordQsbExposure(exposedJournal(), proposed)).toEqual({
        ok: false,
        refusal: "record-mismatch",
      });
    });
  }

  test("refuses duplicate and out-of-range indices before any state check", () => {
    const funded = writer([fundedVault(0)]);
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
    const scripted = writer([{ ...fundedVault(0), funding: null }]);
    expect(recordQsbExposure(scripted, exposedVault(0))).toEqual({
      ok: false,
      refusal: "record-mismatch",
    });
    const funded = writer([fundedVault(0)]);
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
    const imported = bound(importedAccount(), [{ ...fundedVault(0), state: "unknown" }]);
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
    const unknown = stepped(markQsbVaultUnknown(exposed, 0));
    expect(unknown.journal.vaults[0]).toEqual({ ...exposedVault(0), state: "unknown" });
    expect(recordQsbExposure(unknown, exposedVault(0))).toEqual({
      ok: false,
      refusal: "state-conflict",
    });
    const retired = stepped(retireQsbVault(unknown, 0));
    expect(retired.journal.vaults[0]).toEqual({ ...exposedVault(0), state: "retired" });
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
    const retired = stepped(retireQsbVault(writer([allocatedVault(0)]), 0));
    expect(stepped(retireQsbVault(retired, 0)).journal).toBe(retired.journal);
    const unknown = stepped(markQsbVaultUnknown(writer([fundedVault(0)]), 0));
    expect(unknown.journal.vaults[0]).toEqual({ ...fundedVault(0), state: "unknown" });
    expect(stepped(markQsbVaultUnknown(unknown, 0)).journal).toBe(unknown.journal);
    expect(retireQsbVault(unknown, 9)).toEqual({ ok: false, refusal: "unknown-vault" });
    expect(markQsbVaultUnknown(unknown, 9)).toEqual({ ok: false, refusal: "unknown-vault" });
  });

  test("an imported account may still restrict its own records", () => {
    const imported = bound(importedAccount(), [{ ...fundedVault(0), state: "unknown" }]);
    expect(stepped(retireQsbVault(imported, 0), importedAccount()).journal.vaults[0]?.state).toBe(
      "retired",
    );
  });
});
