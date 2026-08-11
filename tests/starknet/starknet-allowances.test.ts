/**
 * Allowance-call decoding checks: uint256 amounts, which selectors change an
 * allowance and how (set vs increase vs decrease), non-allowance calls, and the
 * mapping from submitted calls to allowance-log inputs.
 */
import { describe, expect, test } from "bun:test";
import { allowanceChangesFromCalls, decodeAllowanceCall } from "../../src/starknet/allowances";
import type { AllowanceOwner } from "../../src/storage/allowance-store";

const owner: AllowanceOwner = {
  accountId: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
};
const TOKEN = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

describe("allowance call decoding", () => {
  test("decodes an approve into spender, uint256 amount, and an absolute kind", () => {
    expect(
      decodeAllowanceCall({
        calldata: ["0x5", "1000", "0"],
        contractAddress: TOKEN,
        entrypoint: "approve",
      }),
    ).toEqual({ amount: 1000n, kind: "set", spender: "0x5" });
  });

  test("combines uint256 high and low limbs", () => {
    const decoded = decodeAllowanceCall({
      calldata: ["0x5", "0", "1"],
      contractAddress: TOKEN,
      entrypoint: "approve",
    });
    expect(decoded?.amount).toBe(1n << 128n);
  });

  // The shared decoder — not just the allowance bookkeeping that used to
  // relabel these calls onto the `approve` selector before decoding them — has
  // to read both spellings of each dual, or a caller that decodes a call
  // directly sees an increase as "not an allowance call at all".
  test("decodes both spellings of increase and decrease with their own kind", () => {
    for (const entrypoint of ["increase_allowance", "increaseAllowance"]) {
      expect(
        decodeAllowanceCall({ calldata: ["0x5", "7", "0"], contractAddress: TOKEN, entrypoint }),
      ).toEqual({ amount: 7n, kind: "increase", spender: "0x5" });
    }
    for (const entrypoint of ["decrease_allowance", "decreaseAllowance"]) {
      expect(
        decodeAllowanceCall({ calldata: ["0x5", "7", "0"], contractAddress: TOKEN, entrypoint }),
      ).toEqual({ amount: 7n, kind: "decrease", spender: "0x5" });
    }
  });

  test("ignores non-allowance, case-variant, and malformed calls", () => {
    for (const entrypoint of ["transfer", "Approve", "INCREASE_ALLOWANCE", "increase_Allowance"]) {
      expect(
        decodeAllowanceCall({ calldata: ["0x5", "1", "0"], contractAddress: TOKEN, entrypoint }),
      ).toBeNull();
    }
    expect(
      decodeAllowanceCall({ calldata: ["0x5"], contractAddress: TOKEN, entrypoint: "approve" }),
    ).toBeNull();
  });

  test("maps allowance calls to inputs scoped to the granting owner", () => {
    expect(
      allowanceChangesFromCalls(
        [
          { calldata: ["0x5", "1000", "0"], contractAddress: TOKEN, entrypoint: "approve" },
          { calldata: ["0x9", "1", "0"], contractAddress: TOKEN, entrypoint: "transfer" },
          { calldata: ["0x9", "4", "0"], contractAddress: TOKEN, entrypoint: "increase_allowance" },
        ],
        owner,
      ),
    ).toEqual([
      {
        input: {
          accountId: owner.accountId,
          amount: "1000",
          networkId: "SN_MAIN",
          spender: "0x5",
          token: TOKEN,
        },
        kind: "set",
      },
      {
        input: {
          accountId: owner.accountId,
          amount: "4",
          networkId: "SN_MAIN",
          spender: "0x9",
          token: TOKEN,
        },
        kind: "increase",
      },
    ]);
  });

  test("drops a zero delta but keeps a zero approve, which clears the entry", () => {
    const zeroDeltas = allowanceChangesFromCalls(
      [
        { calldata: ["0x5", "0", "0"], contractAddress: TOKEN, entrypoint: "increase_allowance" },
        { calldata: ["0x5", "0", "0"], contractAddress: TOKEN, entrypoint: "decrease_allowance" },
      ],
      owner,
    );
    expect(zeroDeltas).toEqual([]);
    expect(
      allowanceChangesFromCalls(
        [{ calldata: ["0x5", "0", "0"], contractAddress: TOKEN, entrypoint: "approve" }],
        owner,
      ).map((change) => change.kind),
    ).toEqual(["set"]);
  });
});
