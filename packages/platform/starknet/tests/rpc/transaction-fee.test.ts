/**
 * Receipt fee reads for the activity log (GitHub 463): only a well-formed
 * `{ amount, unit }` fee is trusted, a hash with no usable fee is left out,
 * and a transport failure fails over like every other read.
 */
import { describe, expect, test } from "bun:test";
import { getTransactionFees, isTransactionFee, readReceiptFee } from "@bramble/starknet/rpc";
import type { RpcProvider } from "starknet";

const nodeError = (code: number): Error =>
  Object.assign(new Error("rpc error"), { baseError: { code, message: "rpc error" } });

describe("readReceiptFee", () => {
  test("reads an RPC 0.7+ fee as a canonical felt with its unit", () => {
    expect(readReceiptFee({ actual_fee: { amount: "0x00ABC", unit: "FRI" } })).toEqual({
      amount: "0xabc",
      unit: "FRI",
    });
    expect(readReceiptFee({ actual_fee: { amount: "0x1", unit: "WEI" } })).toEqual({
      amount: "0x1",
      unit: "WEI",
    });
  });

  test("drops a fee it cannot trust rather than guessing", () => {
    for (const receipt of [
      undefined,
      null,
      "0x1",
      {},
      { actual_fee: "0x1" },
      { actual_fee: { amount: "0x1" } },
      { actual_fee: { amount: "0x1", unit: "STRK" } },
      { actual_fee: { amount: "-1", unit: "FRI" } },
      { actual_fee: { amount: "not a number", unit: "FRI" } },
      { actual_fee: { amount: 1, unit: "FRI" } },
      { actual_fee: { amount: `0x${"f".repeat(64)}`, unit: "FRI" } },
    ]) {
      expect(readReceiptFee(receipt)).toBeUndefined();
    }
  });
});

describe("isTransactionFee", () => {
  test("accepts only a canonical in-field amount, a known unit and no other keys", () => {
    expect(isTransactionFee({ amount: "0xabc", unit: "FRI" })).toBe(true);
    expect(isTransactionFee({ amount: "0xABC", unit: "FRI" })).toBe(false);
    expect(isTransactionFee({ amount: "0x0abc", unit: "FRI" })).toBe(false);
    expect(isTransactionFee({ amount: "0xabc", unit: "ETH" })).toBe(false);
    expect(isTransactionFee({ amount: "0xabc", extra: 1, unit: "FRI" })).toBe(false);
    expect(isTransactionFee({ amount: `0x${"f".repeat(64)}`, unit: "FRI" })).toBe(false);
  });
});

describe("getTransactionFees", () => {
  test("returns usable fees and leaves out hashes without one", async () => {
    const fees = await getTransactionFees(
      { hashes: ["0x1", "0x2", "0x3", "0x1"], rpcUrls: ["https://rpc.example"] },
      () =>
        ({
          async getTransactionReceipt(hash: string) {
            if (hash === "0x2") {
              throw nodeError(29);
            }
            return hash === "0x1" ? { actual_fee: { amount: "0x5", unit: "FRI" } } : {};
          },
        }) as unknown as RpcProvider,
    );
    expect(fees).toEqual({ "0x1": { amount: "0x5", unit: "FRI" } });
  });

  test("fails over to the next endpoint on a transport failure", async () => {
    const asked: string[] = [];
    const fees = await getTransactionFees(
      { hashes: ["0x1"], rpcUrls: ["https://down.example", "https://up.example"] },
      (url) =>
        ({
          async getTransactionReceipt() {
            asked.push(url);
            if (url === "https://down.example") {
              throw new TypeError("fetch failed");
            }
            return { actual_fee: { amount: "0x7", unit: "WEI" } };
          },
        }) as unknown as RpcProvider,
    );
    expect(asked).toEqual(["https://down.example", "https://up.example"]);
    expect(fees).toEqual({ "0x1": { amount: "0x7", unit: "WEI" } });
  });
});
