/**
 * SNIP-9 OutsideExecution reader (audit 144): the calls a signature authorizes
 * are recovered with entrypoint NAMES, so the shared call reviewer can decode
 * them and run its recipient rules; anything unreadable fails closed.
 */
import { describe, expect, test } from "bun:test";
import { outsideExecutionCalls } from "@bramble/transactions/outside-execution-calls";
import { constants, hash, outsideExecution } from "starknet";

const TOKEN = "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const OPTIONS = { caller: "ANY_CALLER", execute_after: 1, execute_before: 999_999_999_999 };
const calls = [
  { calldata: ["0xabc", "0x5", "0x0"], contractAddress: TOKEN, entrypoint: "transfer" },
  { calldata: ["0xdef", "0x7", "0x0"], contractAddress: TOKEN, entrypoint: "approve" },
];

const envelope = (version: "1" | "2", input = calls): unknown =>
  JSON.parse(
    JSON.stringify(
      outsideExecution.getTypedData(constants.StarknetChainId.SN_MAIN, OPTIONS, 1, input, version),
    ),
  );

describe("outsideExecutionCalls", () => {
  for (const version of ["1", "2"] as const) {
    test(`recovers named entrypoints from a v${version} envelope`, () => {
      expect(outsideExecutionCalls(envelope(version))).toEqual(calls);
    });
  }

  test("keys the layout on the message shape, not the domain version string", () => {
    const typed = envelope("2") as { domain: Record<string, unknown> };
    typed.domain["version"] = "0x32";
    expect(outsideExecutionCalls(typed)).toEqual(calls);
  });

  test("keeps an unknown selector as its hex spelling", () => {
    const selector = hash.getSelectorFromName("set_owner");
    expect(
      outsideExecutionCalls(
        envelope("2", [{ calldata: ["0x1"], contractAddress: TOKEN, entrypoint: "set_owner" }]),
      ),
    ).toEqual([{ calldata: ["0x1"], contractAddress: TOKEN, entrypoint: selector }]);
  });

  test("resolves felts the way the hasher does (decimal, number, v2 selector name)", () => {
    const typed = envelope("2") as { message: { Calls: Record<string, unknown>[] } };
    const first = typed.message.Calls[0];
    if (!first) throw new Error("fixture");
    first["Selector"] = "transfer";
    first["Calldata"] = ["2748", 5, "0"];
    expect(outsideExecutionCalls(typed)).toEqual(calls);
  });

  test("leaves a plain SNIP-12 message alone", () => {
    expect(outsideExecutionCalls({ message: {}, primaryType: "Mail" })).toBeNull();
    expect(outsideExecutionCalls("not typed data")).toBeNull();
  });

  test("reports a missing, ambiguous or mistyped call list as malformed", () => {
    const missing = envelope("1") as { message: Record<string, unknown> };
    delete missing.message["calls"];
    expect(outsideExecutionCalls(missing)).toBe("malformed");

    const both = envelope("1") as { message: Record<string, unknown> };
    both.message["Calls"] = [];
    expect(outsideExecutionCalls(both)).toBe("malformed");

    const mistyped = envelope("2") as { message: { Calls: Record<string, unknown>[] } };
    const first = mistyped.message.Calls[0];
    if (!first) throw new Error("fixture");
    first["Calldata"] = "0x1";
    expect(outsideExecutionCalls(mistyped)).toBe("malformed");

    const badFelt = envelope("2") as { message: { Calls: Record<string, unknown>[] } };
    const call = badFelt.message.Calls[0];
    if (!call) throw new Error("fixture");
    call["To"] = { nested: true };
    expect(outsideExecutionCalls(badFelt)).toBe("malformed");

    expect(outsideExecutionCalls({ primaryType: "OutsideExecution" })).toBe("malformed");
  });
});
