/**
 * A pool-fee balance refusal raised while an approved private action executes
 * is a pre-signature check, so its reply keeps its blocker kind and the panel
 * reads it as not sent rather than as an unknown outcome (#679).
 */

import { describe, expect, test } from "bun:test";
import { defaultWalletPreferences, type WalletPreferences } from "@bramble/settings/preferences";
import { PrivacyBlockerError } from "@bramble/wallet-protocol/privacy-blocker";
import { responseError } from "../../../packages/presentation/wallet-ui/src/sidepanel/runtime/runtime-errors";
import { knownNotSent } from "../../../packages/presentation/wallet-ui/src/sidepanel/shared/submit-outcome";
import {
  buildStrk20Handler,
  executeStrk20Preparation,
  prepareStrk20Registration,
} from "../../support/strk20-background";
import { makeStrk20WalletService } from "../../support/strk20-wallet-service";

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

describe("a pool-fee refusal at execution", () => {
  test("keeps its blocker kind, sends nothing, and reads as not sent", async () => {
    const capture = { registered: { value: false }, registrations: { value: 0 }, submissions: [] };
    // Read on every balance query, so the account can be emptied between the
    // reviewed preparation and its execution.
    const options: { publicBalance: string } & Parameters<typeof buildStrk20Handler>[0] = {
      preferences: preferences(),
      publicBalance: "100000000000000000000",
      strk20: makeStrk20WalletService(capture),
    };
    const handler = buildStrk20Handler(options);
    const prepared = (await prepareStrk20Registration(handler)) as {
      readonly strk20Preparation: { readonly id: string };
    };
    options.publicBalance = "0";

    const reply = await executeStrk20Preparation(handler, prepared.strk20Preparation.id);

    expect(reply).toEqual({ error: "Not enough STRK for the pool fee", privacyBlocker: "fund" });
    expect(capture.registrations.value).toBe(0);
    const error = responseError(reply, "Private transaction failed");
    expect(error).toBeInstanceOf(PrivacyBlockerError);
    expect(knownNotSent(error)).toBe(true);
  });
});
