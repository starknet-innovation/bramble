/** Status reads cannot disclose accounts or mutate a replacement unlock after an await. */
import { describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { statusResponse } from "../../../apps/extension/src/background/runtime/runtime-state";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { account, createWallet, vaultPassphrase } from "../../support/background-wallet-stub";
import { fixedInvokePreferences } from "../../support/invoke-approval-harness";

const preferences = fixedInvokePreferences({
  ...defaultWalletPreferences(),
  activeNetworkId: "SN_SEPOLIA",
});

describe("status session authorization", () => {
  for (const transition of ["lock", "expiry", "reunlock", "unchanged"] as const) {
    test(`discards a delayed vault read after ${transition}`, async () => {
      let now = 0;
      const session = createUnlockSession({ now: () => now, ttlMs: 100 });
      session.unlock(vaultPassphrase);
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const wallet = createWallet();
      const pending = statusResponse(
        {
          ...wallet,
          async readVault(passphrase) {
            entered.resolve();
            await release.promise;
            return wallet.readVault(passphrase);
          },
        },
        session,
        preferences,
      );
      await entered.promise;
      if (transition === "expiry") {
        now = 101;
      } else if (transition !== "unchanged") {
        session.lock();
        if (transition === "reunlock") session.unlock(vaultPassphrase);
      }
      release.resolve();
      const status = await pending;
      expect(status.networkId).toBe("SN_SEPOLIA");
      expect(status.locked).toBe(transition !== "unchanged");
      expect(status.accounts).toEqual(transition === "unchanged" ? [account] : []);
      expect(status.accountCount).toBe(transition === "unchanged" ? 1 : 0);
      expect(status.activeAccountId).toBe(transition === "unchanged" ? account.id : null);
      expect(session.isUnlocked()).toBe(transition === "unchanged" || transition === "reunlock");
    });
  }

  for (const replacement of [false, true]) {
    test(`a failed read locks only its original session (replacement: ${replacement})`, async () => {
      const session = createUnlockSession();
      session.unlock(vaultPassphrase);
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const pending = statusResponse(
        {
          ...createWallet(),
          async readVault() {
            entered.resolve();
            await release.promise;
            throw new Error("vault unavailable");
          },
        },
        session,
        preferences,
      );
      await entered.promise;
      if (replacement) {
        session.lock();
        session.unlock(vaultPassphrase);
      }
      release.resolve();
      expect(await pending).toMatchObject({
        accountCount: 0,
        activeAccountId: null,
        accounts: [],
        locked: true,
        networkId: "SN_SEPOLIA",
      });
      expect(session.isUnlocked()).toBe(replacement);
    });
  }

  test("polling does not renew the inactivity deadline", async () => {
    let now = 0;
    const session = createUnlockSession({ now: () => now, ttlMs: 100 });
    session.unlock(vaultPassphrase);
    now = 90;
    expect((await statusResponse(createWallet(), session, preferences)).locked).toBe(false);
    now = 101;
    expect((await statusResponse(createWallet(), session, preferences)).locked).toBe(true);
  });

  test("an absent vault remains ready for onboarding", async () => {
    const wallet = {
      ...createWallet(),
      async status() {
        return {
          accountCount: 0,
          activeAccountId: null,
          hasVault: false,
          locked: false,
          ready: true,
        };
      },
    };
    expect((await statusResponse(wallet, createUnlockSession(), preferences)).locked).toBe(false);
  });
});
