/**
 * Issue #439: a reviewed preparation is held only in the background service
 * worker's memory, so a worker that has stopped and restarted cannot answer a
 * confirmation for it.
 *
 * The store now holds the worker open while a review is pending (see
 * strk20-wallet-preparations.test.ts), which removes the idle stop behind the
 * report. This pins the residual case that no hold can remove: a worker that
 * went away for another reason (extension reload, crash) still knows neither
 * the job nor its preparation, and the confirmation is refused with the
 * existing message the panel reads as an expired review.
 */
import { describe, expect, test } from "bun:test";
import { defaultWalletPreferences, type WalletPreferences } from "@bramble/settings/preferences";
import {
  buildStrk20Handler,
  prepareStrk20Registration,
  STRK20_EXTENSION_SENDER,
} from "../../support/strk20-background";

const preferences = (): WalletPreferences => ({
  ...defaultWalletPreferences(),
  activeNetworkId: "SN_SEPOLIA",
  strk20Networks: {
    SN_SEPOLIA: {
      discoveryUrl: "https://discovery.example/strk20",
      poolAddress: "0x123",
      proverUrl: "https://prover.example/strk20",
    },
  },
});

describe("issue #439: a preparation does not survive a restarted worker", () => {
  test("refuses a confirmation for a preparation this worker never held", async () => {
    const handler = buildStrk20Handler({ preferences: preferences(), registered: false });
    const prepared = (await prepareStrk20Registration(handler)) as {
      readonly strk20Preparation?: { readonly id: string };
    };
    const preparationId = prepared.strk20Preparation?.id;
    expect(preparationId).toMatch(/^sha256:[0-9a-f]{64}$/);

    // A second handler is the same process a restarted worker produces: a fresh
    // router context, and therefore a fresh, empty preparation store.
    const restarted = buildStrk20Handler({ preferences: preferences(), registered: false });
    await expect(
      restarted({ preparationId, type: "wallet.strk20Execute" }, STRK20_EXTENSION_SENDER),
    ).resolves.toEqual({ error: "Privacy preparation not found" });
  });
});
