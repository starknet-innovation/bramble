/**
 * `wallet.strk20ReleasePendingWrite` is the panel's "Unlock anyway" (#668): a
 * privileged, exact-shape message that releases only the active account's
 * paused private write, through the privacy service.
 */

import { describe, expect, test } from "bun:test";
import type { Strk20Service } from "@bramble/privacy/service";
import { defaultWalletPreferences, type WalletPreferences } from "@bramble/settings/preferences";
import { account } from "../../support/background-wallet-stub";
import {
  buildStrk20Handler,
  STRK20_CONTENT_SENDER,
  STRK20_EXTENSION_SENDER,
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

const service = (release?: Strk20Service["releasePendingWrite"]): Strk20Service => {
  const base = makeStrk20WalletService({
    registered: { value: true },
    registrations: { value: 0 },
    submissions: [],
  });
  const { releasePendingWrite: _unused, ...rest } = base;
  return release ? { ...rest, releasePendingWrite: release } : rest;
};

describe("unlock anyway", () => {
  test("releases the active account's paused write for the panel only", async () => {
    const calls: { readonly accountId: string; readonly networkId: string }[] = [];
    const handler = buildStrk20Handler({
      preferences: preferences(),
      strk20: service(async (input) => {
        calls.push({ accountId: input.account.id, networkId: input.account.networkId });
        return true;
      }),
    });

    await expect(
      handler({ type: "wallet.strk20ReleasePendingWrite" }, STRK20_CONTENT_SENDER),
    ).resolves.toEqual({ error: "privileged sender required" });
    expect(calls).toEqual([]);

    await expect(
      handler({ type: "wallet.strk20ReleasePendingWrite" }, STRK20_EXTENSION_SENDER),
    ).resolves.toEqual({ ok: true, released: true });
    expect(calls).toEqual([{ accountId: account.id, networkId: "SN_SEPOLIA" }]);
  });

  test("refuses a message with any extra field", async () => {
    let calls = 0;
    const handler = buildStrk20Handler({
      preferences: preferences(),
      strk20: service(async () => {
        calls += 1;
        return true;
      }),
    });
    await expect(
      handler(
        { scope: "SN_MAIN:0x1", type: "wallet.strk20ReleasePendingWrite" },
        STRK20_EXTENSION_SENDER,
      ),
    ).resolves.toEqual({ error: "Invalid unlock request" });
    expect(calls).toBe(0);
  });

  test("answers unavailable when the privacy runtime cannot unlock", async () => {
    const handler = buildStrk20Handler({ preferences: preferences(), strk20: service() });
    const response = (await handler(
      { type: "wallet.strk20ReleasePendingWrite" },
      STRK20_EXTENSION_SENDER,
    )) as { readonly error?: string };
    expect(response.error).toContain("strk20 services unavailable");
  });
});
