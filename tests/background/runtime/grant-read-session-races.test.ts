/** Grant metadata belongs only to the session that authorized its read. */
import { expect, test } from "bun:test";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { resolveAccount } from "../../../apps/extension/src/background/privacy/strk20-approval-execution";
import { resolveOriginAccount } from "../../../apps/extension/src/background/provider/provider-grant";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { handleOriginOps } from "../../../apps/extension/src/background/settings/origins-ops";
import {
  account,
  createWallet,
  testExtension,
  vaultPassphrase,
} from "../../support/background-wallet-stub";
import { fixedInvokePreferences } from "../../support/invoke-approval-harness";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";

for (const boundary of [
  "preferences",
  "grant",
  "private-preferences",
  "private-grant",
  "sites",
] as const) {
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
          if (boundary.endsWith("grant")) await pause();
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
          : (boundary.startsWith("private-") ? resolveAccount : resolveOriginAccount)(
              {
                activity: { list: async () => [] },
                session,
                wallet,
                preferencesStore: {
                  ...fixedInvokePreferences(preferences),
                  async read() {
                    if (boundary.endsWith("preferences")) await pause();
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

const LOCKED_ANSWERS = {
  "wallet.getGrantedAccounts": { accounts: [], ok: true },
  "wallet.getPermissions": { ok: true, permissions: [] },
  // Sent silent: a locked wallet answers a silent request with no accounts.
  "wallet.requestAccounts": { accounts: [], ok: true },
} as const;

for (const type of [
  "wallet.getGrantedAccounts",
  "wallet.requestAccounts",
  "wallet.getPermissions",
] as const) {
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
      testExtension,
      { session },
    );
    const pending = handler(
      {
        type,
        origin: "https://example.com",
        ...(type === "wallet.requestAccounts" ? { silent: true } : {}),
      },
      {
        id: "extension-id",
        url: "https://example.com/",
      },
    );
    await entered.promise;
    session.lock();
    release.resolve();
    // Each answers exactly what it answers while locked, so the race is not a
    // lock-state signal of its own (Sherlock 148).
    await expect(pending).resolves.toEqual(LOCKED_ANSWERS[type]);
  });
}

for (const type of ["wallet.requestAccounts", "wallet.getPermissions"] as const) {
  test(`${type} answers an unconnected site the same whether a lock lands mid-read or not`, async () => {
    const answer = async (lockMidRead: boolean): Promise<unknown> => {
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
            return [];
          },
        },
        testExtension,
        { session },
      );
      const pending = handler(
        {
          type,
          origin: "https://example.com",
          ...(type === "wallet.requestAccounts" ? { silent: true } : {}),
        },
        { id: "extension-id", url: "https://example.com/" },
      );
      await entered.promise;
      if (lockMidRead) session.lock();
      release.resolve();
      return pending;
    };
    expect(await answer(true)).toEqual(await answer(false));
  });
}

test("wallet.requestAccounts queues a connection approval when a lock lands mid-read, as it does while locked", async () => {
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const queued: string[] = [];
  const handler = createMessageHandler(
    {
      ...createWallet(),
      async getGrantedAccounts() {
        entered.resolve();
        await release.promise;
        return [account];
      },
    },
    testExtension,
    { session },
  );
  void handler(
    { type: "wallet.requestAccounts", origin: "https://example.com" },
    { id: "extension-id", url: "https://example.com/" },
  );
  await entered.promise;
  session.lock();
  release.resolve();
  await Bun.sleep(0);
  const pending = await handler(
    { type: "wallet.pendingApprovals" },
    {
      id: "extension-id",
      url: "chrome-extension://extension-id/sidepanel.html",
    },
  );
  for (const approval of (pending as unknown as { pending: { origin: string }[] }).pending) {
    queued.push(approval.origin);
  }
  expect(queued).toEqual(["https://example.com"]);
});

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
      testExtension,
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
