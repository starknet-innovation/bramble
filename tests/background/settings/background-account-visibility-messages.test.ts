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

  // A: first on Sepolia (hidden), B: active on Sepolia, C: the only Mainnet account.
  const hiddenFirstFixture = () => {
    const mainnet = { ...account, address: "0x1234", id: "SN_MAIN:0x1234", networkId: "SN_MAIN" };
    const state = { active: secondAccount.id };
    const handler = createMessageHandler(
      createWallet({
        accounts: [account, secondAccount, mainnet as typeof account],
        activeAccountId: () => state.active,
        captureSetActiveAccount: (input) => {
          state.active = input.accountId;
        },
      }),
      testExtension,
      { preferencesStore: createPreferencesStore({ store: createMemoryStore() }) },
    );
    const send = (message: unknown) => handler(message, extensionSender);
    return { mainnet, send, state };
  };

  test("a network round-trip never lands on a hidden account", async () => {
    const { mainnet, send, state } = hiddenFirstFixture();
    await send({ type: "wallet.unlock", vaultPassphrase });
    await send({ networkId: "SN_SEPOLIA", type: "wallet.setActiveNetwork" });
    expect(await send(hide(account.id, true))).toMatchObject({ ok: true });

    await send({ networkId: "SN_MAIN", type: "wallet.setActiveNetwork" });
    expect(state.active).toBe(mainnet.id);
    const back = await send({ networkId: "SN_SEPOLIA", type: "wallet.setActiveNetwork" });

    expect(state.active).toBe(secondAccount.id);
    expect(back).toMatchObject({ activeAccountId: secondAccount.id });
  });

  test("unlock reconciliation never lands on a hidden account", async () => {
    const { send, state } = hiddenFirstFixture();
    await send({ type: "wallet.unlock", vaultPassphrase });
    await send({ networkId: "SN_SEPOLIA", type: "wallet.setActiveNetwork" });
    expect(await send(hide(account.id, true))).toMatchObject({ ok: true });
    await send({ networkId: "SN_MAIN", type: "wallet.setActiveNetwork" });
    await send({ type: "wallet.lock" });
    // A locked switch records only the network preference; unlock repairs the account.
    await send({ networkId: "SN_SEPOLIA", type: "wallet.setActiveNetwork" });
    await send({ type: "wallet.unlock", vaultPassphrase });

    expect(state.active).toBe(secondAccount.id);
    await expect(send({ type: "wallet.status" })).resolves.toMatchObject({
      activeAccountId: secondAccount.id,
    });
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
