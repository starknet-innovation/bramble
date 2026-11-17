/** A private route must enforce the terms displayed before proof authorization. */
import { avnuRouteCalldata, type AvnuRouteFixture } from "@bramble/testkit/avnu-route";
import { transaction } from "starknet";
import { describe, expect, it } from "vitest";
import { checkPrivateSwapCalldata } from "../src/protocols/avnu/private-swap-intent";
import { AVNU_ADDRESSES } from "../src/protocols/constants";

const input = { sellToken: "0x1", sellAmount: "1000", buyToken: "0x2" };
const calldataFor = (overrides: Partial<AvnuRouteFixture> = {}) => [
  input.buyToken,
  ...transaction
    .fromCallsToExecuteCalldata_cairo1([
      {
        contractAddress: input.sellToken,
        entrypoint: "approve",
        calldata: [AVNU_ADDRESSES.exchange, "1000", "0"],
      },
      {
        contractAddress: AVNU_ADDRESSES.exchange,
        entrypoint: "multi_route_swap",
        calldata: avnuRouteCalldata({
          ...input,
          sellAmount: 1000n,
          buyAmount: 1000n,
          minBuyAmount: 995n,
          beneficiary: "0x3",
          ...overrides,
        }),
      },
    ])
    .map((felt) => `0x${BigInt(felt).toString(16)}`),
  "${openNoteIds[0]}",
];

describe("private swap intent", () => {
  it("returns the enforced minimum from exactly two reviewed calls", () => {
    expect(checkPrivateSwapCalldata(calldataFor(), input, "1000", "0x3")).toBe("995");
  });
  it.each([
    { minBuyAmount: 0n },
    { minBuyAmount: 994n },
    { sellAmount: 1001n },
    { sellToken: "0x9" },
    { buyToken: "0x9" },
    { beneficiary: "0xdead" },
    { buyAmount: 2000n },
    { integratorFeeBps: 1n },
  ])("refuses substituted route fields %#", (overrides) => {
    expect(() => checkPrivateSwapCalldata(calldataFor(overrides), input, "1000", "0x3")).toThrow();
  });
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])("refuses a substituted call header at %i", (index) => {
    const calldata = calldataFor();
    calldata[index] = "0xdead";
    expect(() => checkPrivateSwapCalldata(calldata, input, "1000", "0x3")).toThrow();
  });
  it("refuses hidden trailing calls and placeholders inside calldata", () => {
    const calldata = calldataFor();
    calldata.splice(-1, 0, "0x1");
    expect(() => checkPrivateSwapCalldata(calldata, input, "1000", "0x3")).toThrow();
    calldata[12] = "${openNoteIds[0]}";
    expect(() => checkPrivateSwapCalldata(calldata, input, "1000", "0x3")).toThrow();
  });
});
