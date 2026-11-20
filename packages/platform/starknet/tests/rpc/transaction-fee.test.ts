/**
 * Receipt fee reads for the activity log (GitHub 463): only a well-formed
 * `{ amount, unit }` fee is trusted, a hash with no usable fee is left out,
 * and a transport failure fails over like every other read.
 */
import { describe, expect, test } from "bun:test";
import { createRpcProvider } from "@bramble/starknet/provider";
import { getTransactionFees, isTransactionFee, readReceiptFee } from "@bramble/starknet/rpc";
import {
  createTransactionReceipt,
  logger,
  ReceiptTx,
  type RpcProvider,
  type RpcProviderOptions,
} from "starknet";

logger.setLogLevel("FATAL");

const nodeError = (code: number): Error =>
  Object.assign(new Error("rpc error"), { baseError: { code, message: "rpc error" } });

// The object `getTransactionReceipt` actually returns: a ReceiptTx, not the JSON body.
const libraryReceipt = (fields: Record<string, unknown>) =>
  createTransactionReceipt({
    execution_status: "SUCCEEDED",
    finality_status: "ACCEPTED_ON_L2",
    transaction_hash: "0x1",
    type: "INVOKE",
    ...fields,
  } as Parameters<typeof createTransactionReceipt>[0]);

const rpcReply = (result: unknown): Response =>
  new Response(JSON.stringify({ id: 1, jsonrpc: "2.0", result }), {
    headers: { "content-type": "application/json" },
  });

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

  test("reads the fee starknet.js stores on ReceiptTx", () => {
    const succeeded = libraryReceipt({ actual_fee: { amount: "0x00ABC", unit: "FRI" } });
    const reverted = libraryReceipt({
      actual_fee: { amount: "0x10", unit: "WEI" },
      execution_status: "REVERTED",
      revert_reason: "out of gas",
    });
    const constructed = new ReceiptTx({
      actual_fee: { amount: "0x64", unit: "FRI" },
      execution_status: "SUCCEEDED",
      finality_status: "ACCEPTED_ON_L2",
      transaction_hash: "0x1",
      type: "INVOKE",
    } as Parameters<typeof createTransactionReceipt>[0]);
    expect(Object.getPrototypeOf(succeeded)).toBe(ReceiptTx.prototype);
    expect(Object.getOwnPropertyDescriptor(constructed, "value")?.enumerable).toBe(false);
    expect(readReceiptFee(succeeded)).toEqual({ amount: "0xabc", unit: "FRI" });
    expect(readReceiptFee(reverted)).toEqual({ amount: "0x10", unit: "WEI" });
    expect(readReceiptFee(constructed)).toEqual({ amount: "0x64", unit: "FRI" });
  });

  test("reads a ReceiptTx with an unknown status, and drops one whose body is gone", () => {
    const body = {
      actual_fee: { amount: "0x9", unit: "FRI" },
      execution_status: "SOMETHING_NEW",
      finality_status: "ACCEPTED_ON_L2",
      transaction_hash: "0x1",
      type: "INVOKE",
    } as unknown as Parameters<typeof createTransactionReceipt>[0];
    const constructed = new ReceiptTx(body);
    const provided = createTransactionReceipt(body);
    expect(constructed.isError()).toBe(true);
    expect(readReceiptFee(constructed)).toEqual({ amount: "0x9", unit: "FRI" });
    // starknet.js keeps none of the body on this branch, so there is nothing to read.
    expect(provided.isError()).toBe(true);
    expect(readReceiptFee(provided)).toBeUndefined();
  });

  test("runs no getter anywhere in the fee path", () => {
    let ran = 0;
    const getter = (value: unknown) => ({
      enumerable: true,
      get() {
        ran += 1;
        return value;
      },
    });
    const onFee = Object.defineProperty({}, "actual_fee", getter({ amount: "0x1", unit: "FRI" }));
    const amount = Object.defineProperty({ unit: "FRI" }, "amount", getter("0x1"));
    const unit = Object.defineProperty({ amount: "0x1" }, "unit", getter("FRI"));
    expect(readReceiptFee(onFee)).toBeUndefined();
    expect(readReceiptFee({ actual_fee: amount })).toBeUndefined();
    expect(readReceiptFee({ actual_fee: unit })).toBeUndefined();
    expect(ran).toBe(0);
  });

  test("does not run a getter to recover a wrapped receipt", () => {
    let ran = false;
    const hostile: object = Object.create({ wrapped: true });
    Object.defineProperty(hostile, "value", {
      enumerable: true,
      get() {
        ran = true;
        return { actual_fee: { amount: "0x1", unit: "FRI" } };
      },
    });
    const boxed: object = Object.create({ wrapped: true });
    Object.defineProperty(boxed, "value", { enumerable: false, value: 1 });
    expect(readReceiptFee(hostile)).toBeUndefined();
    expect(ran).toBe(false);
    expect(readReceiptFee(boxed)).toBeUndefined();
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
            return hash === "0x1"
              ? libraryReceipt({ actual_fee: { amount: "0x5", unit: "FRI" } })
              : libraryReceipt({});
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
            return libraryReceipt({ actual_fee: { amount: "0x7", unit: "WEI" } });
          },
        }) as unknown as RpcProvider,
    );
    expect(asked).toEqual(["https://down.example", "https://up.example"]);
    expect(fees).toEqual({ "0x1": { amount: "0x7", unit: "WEI" } });
  });

  test("reads succeeded and reverted FRI and WEI fees through RpcProvider", async () => {
    const receipts: Readonly<Record<string, unknown>> = {
      "0x1": {
        actual_fee: { amount: "0x00ABC", unit: "FRI" },
        execution_status: "SUCCEEDED",
        finality_status: "ACCEPTED_ON_L2",
        transaction_hash: "0x1",
        type: "INVOKE",
      },
      "0x2": {
        actual_fee: { amount: "0x010", unit: "WEI" },
        execution_status: "SUCCEEDED",
        finality_status: "ACCEPTED_ON_L2",
        transaction_hash: "0x2",
        type: "INVOKE",
      },
      "0x3": {
        actual_fee: { amount: "0x064", unit: "FRI" },
        execution_status: "REVERTED",
        finality_status: "ACCEPTED_ON_L2",
        revert_reason: "out of gas",
        transaction_hash: "0x3",
        type: "INVOKE",
      },
      "0x4": {
        actual_fee: "0x1",
        execution_status: "SUCCEEDED",
        finality_status: "ACCEPTED_ON_L2",
        transaction_hash: "0x4",
        type: "INVOKE",
      },
    };
    const baseFetch: NonNullable<RpcProviderOptions["baseFetch"]> = async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as {
        readonly method: string;
        readonly params?: { readonly transaction_hash?: string };
      };
      if (request.method !== "starknet_getTransactionReceipt") {
        throw new Error(`unexpected ${request.method}`);
      }
      return rpcReply(receipts[request.params?.transaction_hash ?? ""]);
    };
    const fees = await getTransactionFees(
      { hashes: ["0x1", "0x2", "0x3", "0x4", "0x1"], rpcUrls: ["https://rpc.example"] },
      (nodeUrl) => createRpcProvider(nodeUrl, { baseFetch }),
    );
    expect(fees).toEqual({
      "0x1": { amount: "0xabc", unit: "FRI" },
      "0x2": { amount: "0x10", unit: "WEI" },
      "0x3": { amount: "0x64", unit: "FRI" },
    });
  });
});
