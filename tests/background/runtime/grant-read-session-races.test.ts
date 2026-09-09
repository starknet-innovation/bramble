/** Grant metadata belongs only to the session that authorized its read. */
import { expect, test } from "bun:test";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { resolveOriginAccount } from "../../../apps/extension/src/background/provider/provider-grant";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { handleOriginOps } from "../../../apps/extension/src/background/settings/origins-ops";
import { account, createWallet, vaultPassphrase } from "../../support/background-wallet-stub";
import { fixedInvokePreferences } from "../../support/invoke-approval-harness";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";

for (const boundary of ["preferences", "grant", "sites"] as const) {
  for (const replacement of [false, true]) {
    test(`${boundary} read cannot disclose a revoked session (replacement: ${replacement})`, async () => {
      const session = createUnlockSession();
      session.unlock(vaultPassphrase);
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const pause = async (): Promise<void> => {
        entered.resolve();
        await release.promise;
      };
      const original = createWallet();
      const wallet = {
        ...original,
        async getGrantedAccounts() {
          if (boundary === "grant") await pause();
          return [account];
        },
        async readVault(passphrase: string) {
          if (boundary === "sites") await pause();
          return original.readVault(passphrase);
        },
      };
      const preferences = defaultWalletPreferences();
      const pending =
        boundary === "sites"
          ? handleOriginOps({ session, wallet }, "wallet.connectedSites", {
              type: "wallet.connectedSites",
            })
          : resolveOriginAccount(
              {
                session,
                wallet,
                preferencesStore: {
                  ...fixedInvokePreferences(preferences),
                  async read() {
                    if (boundary === "preferences") await pause();
                    return preferences;
                  },
                },
              },
              "https://example.com",
            );
      await entered.promise;
      session.lock();
      if (replacement) session.unlock(vaultPassphrase);
      release.resolve();
      await expect(pending).resolves.toEqual({ error: "wallet locked" });
      expect(session.isUnlocked()).toBe(replacement);
    });
  }
}

for (const type of [
  "wallet.getGrantedAccounts",
  "wallet.requestAccounts",
  "wallet.getPermissions",
]) {
  test(`${type} does not return stale grants after lock`, async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const handler = createMessageHandler(
      {
        ...createWallet(),
        async getGrantedAccounts() {
          entered.resolve();
          await release.promise;
          return [account];
        },
      },
      "extension-id",
      { session },
    );
    const pending = handler(
      { type, origin: "https://example.com" },
      {
        id: "extension-id",
        url: "https://example.com/",
      },
    );
    await entered.promise;
    session.lock();
    release.resolve();
    await expect(pending).resolves.toEqual({ error: "wallet locked" });
  });
}

for (const replacement of [false, true]) {
  test(`deployment data cannot disclose after RPC crosses revocation (replacement: ${replacement})`, async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const handler = createMessageHandler(
      {
        ...createWallet(),
        async getGrantedAccounts() {
          return [account];
        },
      },
      "extension-id",
      {
        session,
        preferencesStore: fixedInvokePreferences({
          ...defaultWalletPreferences(),
          activeNetworkId: account.networkId,
        }),
        runtimeRpc: makeRuntimeRpc({
          async getDeploymentStatus() {
            entered.resolve();
            await release.promise;
            return true;
          },
        }),
      },
    );
    const pending = handler(
      { type: "wallet.deploymentData", origin: "https://example.com" },
      {
        id: "extension-id",
        url: "https://example.com/",
      },
    );
    await entered.promise;
    session.lock();
    if (replacement) session.unlock(vaultPassphrase);
    release.resolve();
    await expect(pending).resolves.toEqual({ error: "wallet locked" });
  });
}
