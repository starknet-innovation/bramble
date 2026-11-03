/**
 * Structural checks on the QSB binding transaction `T`: one complete legacy
 * transaction, empty scriptSigs, no witness serialization, canonical compact
 * sizes, and exactly one input spending the vault outpoint (whose txid is
 * stored in display order and serialized reversed).
 */
import { describe, expect, test } from "bun:test";
import { qsbTransactionOutpoints, spendsOutpointOnce } from "../../src/qsb/qsb-transaction";
import { bindingTransaction, FEE_OUTPOINT, FUNDING, P2TR, TRANSACTION } from "./qsb-fixtures";

const OUTPUT = { script: P2TR, valueSat: 240_000 };

describe("the binding transaction T", () => {
  test("parses to its outpoints in order, txids in display order", () => {
    expect(qsbTransactionOutpoints(TRANSACTION)).toEqual([
      { txid: FUNDING.txid, vout: FUNDING.vout },
      FEE_OUTPOINT,
    ]);
    expect(spendsOutpointOnce(TRANSACTION, FUNDING)).toBe(true);
    // The serialized hash is the reverse of the displayed txid.
    expect(TRANSACTION).toContain((FUNDING.txid.match(/../g) ?? []).reverse().join(""));
    expect(TRANSACTION).not.toContain(FUNDING.txid);
  });

  test("admits many outputs and a long output script", () => {
    const outputs = Array.from({ length: 300 }, () => ({
      script: `6a4c${"ff".repeat(80)}`,
      valueSat: 0,
    }));
    const wide = bindingTransaction([FUNDING], outputs);
    expect(qsbTransactionOutpoints(wide)).toHaveLength(1);
  });

  test("refuses the vault spent twice, or not at all", () => {
    const twice = bindingTransaction([FUNDING, FUNDING], [OUTPUT]);
    expect(qsbTransactionOutpoints(twice)).toHaveLength(2);
    expect(spendsOutpointOnce(twice, FUNDING)).toBe(false);
    const never = bindingTransaction([FEE_OUTPOINT], [OUTPUT]);
    expect(spendsOutpointOnce(never, FUNDING)).toBe(false);
    expect(spendsOutpointOnce(TRANSACTION, { ...FUNDING, vout: FUNDING.vout + 1 })).toBe(false);
  });

  const malformed: readonly (readonly [string, string])[] = [
    ["empty bytes", ""],
    ["uppercase hex", TRANSACTION.toUpperCase()],
    ["an odd digit count", `${TRANSACTION}0`],
    ["a trailing byte", `${TRANSACTION}00`],
    ["a missing locktime", TRANSACTION.slice(0, -8)],
    ["no inputs", bindingTransaction([], [OUTPUT])],
    ["no outputs", bindingTransaction([FUNDING], [])],
    // A non-empty scriptSig: the input's script length byte set to 1, one byte.
    [
      "a non-empty scriptSig",
      TRANSACTION.replace(
        `${(FUNDING.txid.match(/../g) ?? []).reverse().join("")}0100000000`,
        `${(FUNDING.txid.match(/../g) ?? []).reverse().join("")}010000000151`,
      ),
    ],
    // The segregated-witness marker and flag after the version.
    ["witness serialization", `${TRANSACTION.slice(0, 8)}0001${TRANSACTION.slice(8)}`],
    // 0xfd prefix encoding a count that fits in one byte.
    ["a non-canonical compact size", `${TRANSACTION.slice(0, 8)}fd0200${TRANSACTION.slice(10)}`],
    ["an input count past the bytes", `${TRANSACTION.slice(0, 8)}ff${TRANSACTION.slice(10)}`],
  ];
  for (const [name, transaction] of malformed) {
    test(`refuses ${name}`, () => {
      expect(qsbTransactionOutpoints(transaction)).toBeNull();
      expect(spendsOutpointOnce(transaction, FUNDING)).toBe(false);
    });
  }
});
