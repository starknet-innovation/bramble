/**
 * The STRK shortfall a gasless offer uses. A transfer of the whole balance
 * plus a fee is short, even though the fee alone would fit.
 */
import { describe, expect, test } from "bun:test";
import { gaslessStrkAffordability } from "@bramble/privacy/gasless-request";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import type { Call } from "starknet";

const fee = { overallFee: "1", unit: "FRI" } as const;

const transfer = (amount: string): Call => ({
  calldata: ["0x2", amount, "0x0"],
  contractAddress: STRK_TOKEN_ADDRESS,
  entrypoint: "transfer",
});

describe("gaslessStrkAffordability", () => {
  test("counts STRK the calls spend, not only the network fee", () => {
    expect(gaslessStrkAffordability([transfer("100")], "100", fee)).toBe("insufficient");
    expect(gaslessStrkAffordability([transfer("100")], "101", fee)).toBe("ok");
    expect(gaslessStrkAffordability([], "1", fee)).toBe("ok");
  });

  test("hides the offer when a STRK call's spend cannot be counted", () => {
    const unknown: Call = {
      calldata: ["0x1"],
      contractAddress: STRK_TOKEN_ADDRESS,
      entrypoint: "unknown_spend",
    };
    expect(gaslessStrkAffordability([unknown], "1000", fee)).toBe("unknown");
  });
});
