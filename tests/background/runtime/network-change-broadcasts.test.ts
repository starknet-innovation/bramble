/**
 * Network-moving mutations announce the new chain (Sherlock 188, 215).
 *
 * A page's provider holds the chain id it was last told and changes it only on
 * `networkChanged`; a later `accountsChanged` cannot repair it. Selecting an
 * account on another network, and restoring a preferences backup with its own
 * active network, both move the wallet's active network, so each is driven
 * through the real handler and its response fed to the broadcast decision.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import { walletEventBroadcasts } from "../../../apps/extension/src/background/runtime/events";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import {
  account,
  createWallet,
  extensionSender as sender,
  testExtension,
  vaultPassphrase,
} from "../../support/background-wallet-stub";

const accountsChanged = { event: "accountsChanged", type: "wallet.event" } as const;
const networkChanged = (networkId: keyof typeof STARKNET_NETWORKS) =>
  ({
    chainId: STARKNET_NETWORKS[networkId].chainId,
    event: "networkChanged",
    type: "wallet.event",
  }) as const;

const mainnetAccount = {
  ...account,
  address: "0xabc111111",
  id: "SN_MAIN:0xabc111111",
  networkId: "SN_MAIN" as const,
};

const setup = async () => {
  let activeAccountId = account.id;
  const baseWallet = createWallet({
    accounts: [account, mainnetAccount],
    activeAccountId: () => activeAccountId,
  });
  const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
  await preferencesStore.setActiveNetwork("SN_SEPOLIA");
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const handler = createMessageHandler(
    {
      ...baseWallet,
      async setActiveAccount(input: { readonly accountId: string }) {
        activeAccountId = input.accountId;
        return input.accountId === mainnetAccount.id ? mainnetAccount : account;
      },
    },
    testExtension,
    { preferencesStore, session },
  );
  const send = async (message: Record<string, unknown>) =>
    walletEventBroadcasts(message, await handler(message, sender));
  return { preferencesStore, send };
};

describe("network-moving mutations", () => {
  test("selecting an account on another network announces that network", async () => {
    const { preferencesStore, send } = await setup();

    await expect(
      send({ accountId: mainnetAccount.id, type: "wallet.setActiveAccount" }),
    ).resolves.toEqual([accountsChanged, networkChanged("SN_MAIN")]);
    expect((await preferencesStore.read()).activeNetworkId).toBe("SN_MAIN");
  });

  test("restoring a backup with another active network announces it", async () => {
    const { preferencesStore, send } = await setup();
    const backup = { ...(await preferencesStore.read()), activeNetworkId: "SN_MAIN" as const };

    await expect(send({ preferences: backup, type: "wallet.importPreferences" })).resolves.toEqual([
      accountsChanged,
      networkChanged("SN_MAIN"),
    ]);
    expect((await preferencesStore.read()).activeNetworkId).toBe("SN_MAIN");
  });

  test("a refused restore announces nothing", async () => {
    const { send } = await setup();
    await expect(
      send({ preferences: { corrupted: true }, type: "wallet.importPreferences" }),
    ).resolves.toEqual([]);
  });
});
