/** Ledger grant progress copy must expose the device-confirmation phase. */
import { describe, expect, test } from "bun:test";
import { ledgerTransitionProgress } from "../../src/ledger-grant/transition-progress";

describe("Ledger transition progress", () => {
  test("asks for device confirmation only while opening Starknet", () => {
    expect(ledgerTransitionProgress("opening-starknet")).toEqual({
      message: "Confirm the app-open prompt on your Ledger. No transaction is being signed.",
      title: "Approve opening Starknet",
    });
    expect(ledgerTransitionProgress("confirming-starknet").title).toBe("Confirming Starknet");
  });
});
