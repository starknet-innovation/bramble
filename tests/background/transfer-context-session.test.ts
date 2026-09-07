/** A transfer's context resolution cannot borrow authorization from a later unlock. */
import { expect, test } from "bun:test";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { createMessageHandler } from "../../apps/extension/src/background/routing/messages";
import { createUnlockSession } from "../../apps/extension/src/background/runtime/session";
import {
  fixedInvokePreferences,
  invokeAccount,
  invokeExtensionSender,
  invokeVaultPassphrase,
  invokeWalletStub,
} from "../support/invoke-approval-harness";
import { makeRuntimeRpc } from "../support/runtime-rpc-stub";

for (const boundary of ["preferences", "vault"] as const) {
  for (const transition of ["lock", "expiry", "reunlock", "unchanged"] as const) {
    test(`transfer ${transition} during ${boundary} resolution`, async () => {
      let now = 1_000;
      const session = createUnlockSession({ now: () => now, ttlMs: 100 });
      session.unlock(invokeVaultPassphrase);
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let paused = false;
      const pause = async (): Promise<void> => {
        if (paused) return;
        paused = true;
        started.resolve();
        await release.promise;
      };
      const preferences = defaultWalletPreferences();
      const token = preferences.tokens.find((entry) => entry.networkId === invokeAccount.networkId);
      if (!token) throw new Error("missing fixture token");
      const wallet = invokeWalletStub([invokeAccount]);
      let signatures = 0;
      let submissions = 0;
      const handler = createMessageHandler(
        {
          ...wallet,
          async readVault() {
            if (boundary === "vault") await pause();
            return wallet.readVault();
          },
          async signHash() {
            signatures += 1;
            return wallet.signHash();
          },
        },
        "extension-id",
        {
          session,
          preferencesStore: {
            ...fixedInvokePreferences(preferences),
            async read() {
              if (boundary === "preferences") await pause();
              return preferences;
            },
          },
          runtimeRpc: makeRuntimeRpc({
            async submitErc20Transfer(input) {
              if (!input.isAuthorized?.()) throw new Error("wallet locked");
              await input.signHash("0x123");
              submissions += 1;
              return {
                call: { calldata: [], contractAddress: token.address, entrypoint: "transfer" },
                transactionHash: "0x777",
              };
            },
          }),
        },
      );
      const pending = handler(
        {
          accountId: invokeAccount.id,
          amount: "1",
          recipient: "0x0511a2b3c4d5e6f7",
          reviewedFee: { overallFee: "1", unit: "FRI" },
          tokenId: token.id,
          type: "wallet.transfer",
        },
        invokeExtensionSender,
      );
      await started.promise;
      if (transition === "expiry") now += 101;
      if (transition === "lock" || transition === "reunlock") {
        await handler({ type: "wallet.lock" }, invokeExtensionSender);
      }
      if (transition === "reunlock") {
        await handler(
          { type: "wallet.unlock", vaultPassphrase: invokeVaultPassphrase },
          invokeExtensionSender,
        );
      }
      release.resolve();
      if (transition === "unchanged") {
        await expect(pending).resolves.toEqual({ ok: true, transactionHash: "0x777" });
        expect(signatures).toBe(1);
        expect(submissions).toBe(1);
      } else {
        await expect(pending).resolves.toEqual({ error: "wallet locked" });
        expect(signatures).toBe(0);
        expect(submissions).toBe(0);
        expect(session.isUnlocked()).toBe(transition === "reunlock");
      }
    });
  }
}
