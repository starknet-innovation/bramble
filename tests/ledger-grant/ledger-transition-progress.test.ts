/**
 * Ledger grant progress copy must expose the device-confirmation phase, and
 * only that one: every other phase is a wait the reader cannot act on, so its
 * title stands alone.
 */
import { describe, expect, test } from "bun:test";
import { ledgerTransitionProgress } from "../../apps/extension/src/ledger-grant/transition-progress";

describe("Ledger transition progress", () => {
  test("asks for device confirmation only while opening Starknet", () => {
    expect(ledgerTransitionProgress("opening-starknet")).toEqual({
      message: "Confirm the prompt on your Ledger.",
      title: "Approve opening Starknet",
    });
    expect(ledgerTransitionProgress("confirming-starknet").title).toBe("Confirming Starknet");
  });

  test("leaves every other phase without a message", () => {
    for (const phase of [
      "checking-device",
      "returning-to-dashboard",
      "reconnecting-dashboard",
      "checking-firmware",
      "reconnecting-starknet",
      "confirming-starknet",
    ] as const) {
      const progress = ledgerTransitionProgress(phase);
      expect(progress.message).toBe("");
      expect(progress.title.length).toBeGreaterThan(0);
    }
  });
});
