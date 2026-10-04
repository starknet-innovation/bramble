/**
 * Account-visibility message checks: `wallet.setAccountHidden` round-trips
 * through the background dispatcher, refuses to hide the last account a network
 * still shows, and moves the active account off the one being hidden before the
 * preference is written. Each case unlocks first, because hiding reads the vault
 * to decide.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import {
  account,
  contentSender,
  createWallet,
  extensionSender,
  secondAccount,
  testExtension,
  vaultPassphrase,
  type WalletStubOptions,
} from "../../support/background-wallet-stub";

const unlockedHandler = (options: WalletStubOptions = {}) => {
  const handler = createMessageHandler(createWallet(options), testExtension, {
    preferencesStore: createPreferencesStore({ store: createMemoryStore() }),
  });
  return async (message: unknown) => {
    await handler({ type: "wallet.unlock", vaultPassphrase }, extensionSender);
    return handler(message, extensionSender);
  };
};

const hide = (accountId: string, hidden: boolean) => ({
  accountId,
  hidden,
  type: "wallet.setAccountHidden",
});

describe("account visibility messages", () => {
  test("hides an account and shows it again", async () => {
    const send = unlockedHandler({ accounts: [account, secondAccount] });

    const hidden = await send(hide(secondAccount.id, true));
    expect(hidden).toMatchObject({
      ok: true,
      preferences: { hiddenAccountIds: [secondAccount.id] },
    });

    const shown = await send(hide(secondAccount.id, false));
    expect(shown).toMatchObject({ ok: true, preferences: { hiddenAccountIds: [] } });
  });

  test("refuses to hide the last account a network still shows", async () => {
    const send = unlockedHandler();

    await expect(send(hide(account.id, true))).resolves.toMatchObject({
      error: "Can't hide the last account on this network",
    });
  });

  test("moves the active account before hiding it", async () => {
    let active = account.id;
    const send = unlockedHandler({
      accounts: [account, secondAccount],
      activeAccountId: () => active,
      captureSetActiveAccount: (input) => {
        active = input.accountId;
      },
    });

    const hidden = await send(hide(account.id, true));
    expect(hidden).toMatchObject({ ok: true, preferences: { hiddenAccountIds: [account.id] } });

    // The wallet must not stay on an account it no longer lists.
    const status = await send({ type: "wallet.status" });
    expect(status).toMatchObject({ activeAccountId: secondAccount.id });
  });

  test("a content script cannot hide an account", async () => {
    const handler = createMessageHandler(createWallet(), testExtension, {
      preferencesStore: createPreferencesStore({ store: createMemoryStore() }),
    });

    await expect(handler(hide(account.id, true), contentSender)).resolves.toEqual({
      error: "privileged sender required",
    });
  });

  test("rejects a malformed toggle", async () => {
    const send = unlockedHandler();

    await expect(
      send({ accountId: account.id, hidden: "yes", type: "wallet.setAccountHidden" }),
    ).resolves.toEqual({
      error: "invalid account visibility request",
    });
  });
});
