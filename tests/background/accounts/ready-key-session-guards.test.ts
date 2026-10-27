/**
 * The session and vault guards around a Ready-key import (issue 776). Both
 * messages read the chain before they answer, so the unlock, and the vault,
 * that started a request must still be the ones in place when it finishes: a
 * lock, a re-unlock or a replaced vault during the reads writes nothing and
 * leaves the network preference alone, and a first-run discovery that ends
 * after a vault appeared returns nothing. A pick list must name a release
 * before any chain read, and a balance the wallet cannot parse fails closed.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import type { ImportRawKeyAccountInput } from "@bramble/vault/service";
import { readAccountActivity } from "../../../apps/extension/src/background/accounts/account-activity";
import {
  discoverReadyKeyAccounts,
  NO_READY_ACCOUNT_FOR_KEY,
  READY_KEY_CHECK_UNAVAILABLE,
  verifyReadyKeyClasses,
} from "../../../apps/extension/src/background/accounts/ready-key-accounts";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import {
  createUnlockSession,
  type UnlockSession,
} from "../../../apps/extension/src/background/runtime/session";
import {
  account,
  extensionSender as sender,
  testExtension,
  vaultPassphrase,
} from "../../support/background-wallet-stub";
import {
  ARGENT_031,
  capturingWallet,
  deps,
  discoverMessage,
  importMessage,
  input,
  rpcWith,
  unlocked,
} from "./ready-key-fixtures";

const once = (run: () => void): (() => void) => {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    run();
  };
};

// A preference the import would move: the message names SN_MAIN.
const sepoliaPreferences = async () => {
  const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
  await preferencesStore.setActiveNetwork("SN_SEPOLIA");
  return preferencesStore;
};

const importDuring = async (session: UnlockSession, during: () => void) => {
  const captured: ImportRawKeyAccountInput[] = [];
  const preferencesStore = await sepoliaPreferences();
  const handler = createMessageHandler(capturingWallet(captured), testExtension, {
    preferencesStore,
    runtimeRpc: rpcWith({ deployed: [ARGENT_031] }, once(during)),
    session,
  });
  const response = await handler(importMessage([ARGENT_031]), sender);
  return {
    captured,
    network: (await preferencesStore.read()).activeNetworkId,
    response,
    unlocked: session.getPassphrase() !== null,
  };
};

describe("wallet.importAccount across the verification reads", () => {
  test("an undisturbed import writes and moves the preference", async () => {
    const outcome = await importDuring(unlocked(), () => undefined);
    expect(outcome.response).toEqual({ account, ok: true });
    expect(outcome.captured).toHaveLength(1);
    expect(outcome.network).toBe("SN_MAIN");
  });

  test("a lock during the reads writes nothing and leaves the preference", async () => {
    const session = unlocked();
    const outcome = await importDuring(session, () => session.lock());
    expect(outcome.response).toEqual({ error: "wallet locked" });
    expect(outcome.captured).toEqual([]);
    expect(outcome.network).toBe("SN_SEPOLIA");
  });

  test("a lock and re-unlock during the reads refuses without locking", async () => {
    const session = unlocked();
    const outcome = await importDuring(session, () => {
      session.lock();
      session.unlock(vaultPassphrase);
    });
    expect(outcome.response).toEqual({ error: "wallet locked" });
    expect(outcome.captured).toEqual([]);
    expect(outcome.network).toBe("SN_SEPOLIA");
    expect(outcome.unlocked).toBe(true);
  });

  test("a vault replaced during the reads refuses without locking", async () => {
    const session = unlocked();
    const outcome = await importDuring(session, () => {
      session.lock();
      session.unlock("a different vault passphrase");
    });
    expect(outcome.response).toEqual({ error: "wallet locked" });
    expect(outcome.captured).toEqual([]);
    expect(outcome.network).toBe("SN_SEPOLIA");
    expect(outcome.unlocked).toBe(true);
  });

  test("a locked wallet refuses before any chain read", async () => {
    let reads = 0;
    const captured: ImportRawKeyAccountInput[] = [];
    const handler = createMessageHandler(capturingWallet(captured), testExtension, {
      runtimeRpc: rpcWith({ deployed: [ARGENT_031] }, () => {
        reads += 1;
      }),
      session: createUnlockSession(),
    });
    await expect(handler(importMessage([ARGENT_031]), sender)).resolves.toEqual({
      error: "wallet locked",
    });
    expect(reads).toBe(0);
    expect(captured).toEqual([]);
  });
});

describe("first-run wallet.discoverReadyKeyAccounts across the reads", () => {
  test("a vault created during the reads returns nothing", async () => {
    let hasVault = false;
    const handler = createMessageHandler(
      capturingWallet([], () => hasVault),
      testExtension,
      {
        runtimeRpc: rpcWith(
          { deployed: [ARGENT_031] },
          once(() => {
            hasVault = true;
          }),
        ),
      },
    );
    await expect(handler(discoverMessage, sender)).resolves.toEqual({
      error: "Wallet already exists",
    });
  });

  test("a vault created, unlocked and locked during the reads returns nothing", async () => {
    let hasVault = false;
    const session = createUnlockSession();
    const handler = createMessageHandler(
      capturingWallet([], () => hasVault),
      testExtension,
      {
        runtimeRpc: rpcWith(
          { deployed: [ARGENT_031] },
          once(() => {
            hasVault = true;
            session.unlock(vaultPassphrase);
            session.lock();
          }),
        ),
        session,
      },
    );
    await expect(handler(discoverMessage, sender)).resolves.toEqual({
      error: "Wallet already exists",
    });
  });
});

describe("Ready-key pick list", () => {
  test("an empty pick list refuses before any chain read", async () => {
    let reads = 0;
    const counting = {
      ...deps({ deployed: [ARGENT_031] }),
      runtimeRpc: rpcWith({ deployed: [ARGENT_031] }, () => {
        reads += 1;
      }),
    };
    await expect(verifyReadyKeyClasses(counting, input, [])).rejects.toThrow(
      NO_READY_ACCOUNT_FOR_KEY,
    );
    expect(reads).toBe(0);
  });
});

describe("unreadable balances", () => {
  const withBalance = (balance: string) => ({
    ...rpcWith({}),
    async getTokenBalances({
      tokens,
    }: Parameters<ReturnType<typeof rpcWith>["getTokenBalances"]>[0]) {
      return tokens.map((token, index) => ({
        ...token,
        balance: index === 0 ? balance : "0",
        formatted: "0",
      }));
    },
  });

  for (const balance of ["-1", "1.5", "1e18", "0x10", "", " 1", "abc"]) {
    test(`"${balance}" fails closed instead of reading as empty or throwing raw`, async () => {
      await expect(
        readAccountActivity(withBalance(balance), {
          accountAddress: "0xa1",
          rpcUrls: [],
          tokens: [
            {
              address: "0x1",
              decimals: 18,
              id: "eth",
              name: "Ether",
              networkId: "SN_MAIN",
              symbol: "ETH",
            },
          ],
        }),
      ).rejects.toThrow("Account discovery is unavailable");
      await expect(
        discoverReadyKeyAccounts({ ...deps({}), runtimeRpc: withBalance(balance) }, input),
      ).rejects.toThrow(READY_KEY_CHECK_UNAVAILABLE);
    });
  }

  test("a canonical balance still reads", async () => {
    const found = await discoverReadyKeyAccounts(
      { ...deps({}), runtimeRpc: withBalance("1000") },
      input,
    );
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((candidate) => !candidate.deployed)).toBe(true);
  });
});
