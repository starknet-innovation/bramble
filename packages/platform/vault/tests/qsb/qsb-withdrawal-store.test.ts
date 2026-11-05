/**
 * The withdrawal record's validators: bound to one account and journal, each
 * withdrawal in its grammar, signed bytes always with an outcome and a
 * `refused` outcome never with them, strictly ascending by vault with
 * distinct helpers and job ids, within the count and byte caps. Nothing
 * invalid is ever built, and an unreadable or foreign record is unavailable.
 */
import { describe, expect, test } from "bun:test";
import {
  QSB_MAX_WITHDRAWAL_TX_BYTES,
  QSB_MAX_WITHDRAWALS,
  type QsbWithdrawalRecord,
  qsbWithdrawalStorageKey,
  qsbWithdrawalsRecord,
  readQsbWithdrawals,
} from "@bramble/vault/qsb-withdrawal-store";

const JOURNAL = "ab".repeat(32);
const ACCOUNT = { id: "qsb-1", journalId: JOURNAL };

const withdrawal = (v: number, fields: Partial<QsbWithdrawalRecord> = {}): QsbWithdrawalRecord => ({
  destination: "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
  feeSat: 9_449,
  helper: { txid: v.toString(16).padStart(2, "0").repeat(32), valueSat: 1_449, vout: 1 },
  jobCreated: true,
  jobId: `0b8f7f9e-1c2d-4e3f-8a9b-${v.toString(16).padStart(12, "0")}`,
  manifestHash: "cd".repeat(32),
  manifestJson: '{"vaultId":"x"}',
  outcome: null,
  outputSat: 92_000,
  signed: null,
  v,
  ...fields,
});

const SIGNED = { rawTxHex: "01".repeat(1_400), txid: "ef".repeat(32) };

describe("the withdrawal record", () => {
  test("is keyed beside its journal", () => {
    expect(qsbWithdrawalStorageKey(JOURNAL)).toBe(`bramble:qsb-withdrawal:${JOURNAL}`);
    expect(qsbWithdrawalStorageKey("not a journal id")).toBeNull();
  });

  test("holds valid withdrawals sorted by vault", () => {
    const record = qsbWithdrawalsRecord(ACCOUNT, [
      withdrawal(3, { outcome: "pending", signed: SIGNED }),
      withdrawal(1, { outcome: "refused" }),
    ]);
    expect(record?.withdrawals.map(({ v }) => v)).toEqual([1, 3]);
  });

  test.each([
    [
      "two for one vault",
      [withdrawal(1), withdrawal(1, { jobId: "1b8f7f9e-1c2d-4e3f-8a9b-0c1d2e3f4a5b" })],
    ],
    ["one helper twice", [withdrawal(1), withdrawal(2, { helper: withdrawal(1).helper })]],
    ["one job id twice", [withdrawal(1), withdrawal(2, { jobId: withdrawal(1).jobId })]],
    ["signed bytes without an outcome", [withdrawal(1, { signed: SIGNED })]],
    ["an outcome without signed bytes", [withdrawal(1, { outcome: "submitted" })]],
    ["refused with signed bytes", [withdrawal(1, { outcome: "refused", signed: SIGNED })]],
    [
      "oversized signed bytes",
      [
        withdrawal(1, {
          outcome: "pending",
          signed: { ...SIGNED, rawTxHex: "01".repeat(QSB_MAX_WITHDRAWAL_TX_BYTES + 1) },
        }),
      ],
    ],
    [
      "a job id that is not a v4 uuid",
      [withdrawal(1, { jobId: "0b8f7f9e-1c2d-1e3f-8a9b-0c1d2e3f4a5b" })],
    ],
    ["a manifest that is not JSON", [withdrawal(1, { manifestJson: "{" })]],
    ["a zero fee", [withdrawal(1, { feeSat: 0 })]],
    ["too many", Array.from({ length: QSB_MAX_WITHDRAWALS + 1 }, (_, v) => withdrawal(v))],
  ])("refuses %s", (_label, withdrawals) => {
    expect(qsbWithdrawalsRecord(ACCOUNT, withdrawals)).toBeNull();
  });

  test("reads empty, bound, foreign and unreadable records", async () => {
    const stored = (value: unknown) => ({ read: async () => value });
    const failing = {
      read: async () => {
        throw new Error("decryption failed");
      },
    };
    const record = qsbWithdrawalsRecord(ACCOUNT, [withdrawal(1)]);
    expect(await readQsbWithdrawals(stored(undefined), ACCOUNT, "pw")).toEqual({
      status: "bound",
      withdrawals: [],
    });
    expect(await readQsbWithdrawals(stored(record), ACCOUNT, "pw")).toEqual({
      status: "bound",
      withdrawals: [withdrawal(1)],
    });
    expect(await readQsbWithdrawals(stored(record), { ...ACCOUNT, id: "qsb-2" }, "pw")).toEqual({
      status: "unavailable",
    });
    expect(await readQsbWithdrawals(failing, ACCOUNT, "pw")).toEqual({ status: "unavailable" });
  });
});
