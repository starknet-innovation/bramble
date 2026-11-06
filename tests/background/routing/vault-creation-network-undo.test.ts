/**
 * Issue 822: a first-run Ledger vault or a recovery that fails without writing
 * must leave the active network where it was. A wrong passphrase over an
 * existing vault fails decryption rather than refusing, so both creators refuse
 * an existing vault before the network preference is written. Any other
 * failure restores the network only when it provably wrote nothing.
 */
import { describe, expect, test } from "bun:test";
import { RefusedBeforeWrite } from "@bramble/core/errors";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import type { LedgerAccountRef } from "@bramble/wallet-model/accounts";
import { ledgerAccountPath } from "@bramble/wallet-model/ledger-path";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import { runVaultCreationWithNetwork } from "../../../apps/extension/src/background/runtime/active-network-mutation";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import {
  account,
  createWallet,
  extensionSender as sender,
  testExtension,
  vaultPassphrase,
} from "../../support/background-wallet-stub";

const ledgerAccount: LedgerAccountRef = {
  accountContractType: "openzeppelin",
  address: "0xabc111111",
  classHash: "0x111111",
  derivation: {
    accountIndex: 0,
    eip2645application: "LedgerW",
    kind: "ledger",
    path: ledgerAccountPath(0),
  },
  id: "SN_MAIN:0xabc111111",
  networkId: "SN_MAIN",
  publicKeyX: account.publicKeyX,
};

const ledgerMessage = {
  accountContractType: "openzeppelin",
  accountIndex: 0,
  networkId: "SN_MAIN",
  publicKeyX: account.publicKeyX,
  type: "wallet.createLedgerVault",
  vaultPassphrase,
} as const;

const recoverMessage = {
  mnemonic: "habit hope tip crystal because grunt nation idea electric witness alert like",
  networkId: "SN_MAIN",
  selections: [{ accountContractType: "openzeppelin", accountIndex: 0 }],
  type: "wallet.recoverAccounts",
  vaultPassphrase,
} as const;

const creators = [
  { message: ledgerMessage, ok: { account: ledgerAccount, ok: true } },
  { message: recoverMessage, ok: { accounts: [account], ok: true } },
] as const;

const sepolia = async () => {
  const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
  await preferencesStore.setActiveNetwork("SN_SEPOLIA");
  return preferencesStore;
};

// A wallet whose two first-run creators run `create`: it may call `wrote` to
// mark the store as holding a vault (a write landed) before it answers or throws.
type Create = (wrote: () => void) => Promise<void>;

const walletWith = (hasVault: boolean, create: Create) => {
  const store = { hasVault };
  const wrote = (): void => {
    store.hasVault = true;
  };
  let calls = 0;
  const wallet = {
    ...createWallet({ hasVault: () => store.hasVault }),
    async createLedgerVault() {
      calls += 1;
      await create(wrote);
      return ledgerAccount;
    },
    async recoverAccounts() {
      calls += 1;
      await create(wrote);
      return [account];
    },
  };
  return { calls: () => calls, wallet };
};

const decryptionFails = async (): Promise<void> => {
  throw new Error("decryption failed");
};

const run = async (
  message: (typeof creators)[number]["message"],
  hasVault: boolean,
  create: Create,
  session = createUnlockSession(),
) => {
  const preferencesStore = await sepolia();
  const { calls, wallet } = walletWith(hasVault, create);
  const handler = createMessageHandler(wallet, testExtension, { preferencesStore, session });
  const response = await handler(message, sender);
  const network = (await preferencesStore.read()).activeNetworkId;
  return { calls: calls(), network, response, session };
};

for (const { message, ok } of creators)
  describe(`${message.type} and the active network`, () => {
    test("a locked vault and a wrong passphrase keep the network", async () => {
      const result = await run(message, true, decryptionFails);
      expect(result.response).toEqual({ error: "Wallet already exists" });
      expect(result.calls).toBe(0);
      expect(result.network).toBe("SN_SEPOLIA");
      expect(result.session.isUnlocked()).toBe(false);
    });

    test("an unlocked session and another passphrase keep the network and the session", async () => {
      const session = createUnlockSession();
      session.unlock("an-existing-vault-passphrase");
      const result = await run(message, true, decryptionFails, session);
      expect(result.response).toEqual({ error: "Wallet already exists" });
      expect(result.calls).toBe(0);
      expect(result.network).toBe("SN_SEPOLIA");
      expect(session.getPassphrase()).toBe("an-existing-vault-passphrase");
    });

    test("the session's own passphrase reaches the vault, whose refusal undoes the network", async () => {
      const session = createUnlockSession();
      session.unlock(vaultPassphrase);
      const result = await run(
        message,
        true,
        async () => {
          throw new RefusedBeforeWrite("Wallet already exists");
        },
        session,
      );
      expect(result.response).toEqual({ error: "Wallet already exists" });
      expect(result.calls).toBe(1);
      expect(result.network).toBe("SN_SEPOLIA");
      expect(session.getPassphrase()).toBe(vaultPassphrase);
    });

    test("a first-run create switches the network and unlocks", async () => {
      const result = await run(message, false, async (wrote) => {
        wrote();
      });
      expect(result.response).toEqual(ok);
      expect(result.network).toBe("SN_MAIN");
      expect(result.session.getPassphrase()).toBe(vaultPassphrase);
    });

    test("a first-run failure that stored no vault restores the network", async () => {
      const result = await run(message, false, decryptionFails);
      expect(result.response).toEqual({ error: "decryption failed" });
      expect(result.calls).toBe(1);
      expect(result.network).toBe("SN_SEPOLIA");
    });

    test("a failure after the vault write keeps the network the write was bound to", async () => {
      const result = await run(message, false, async (wrote) => {
        wrote();
        throw new Error("verify after write failed");
      });
      expect(result.response).toEqual({ error: "verify after write failed" });
      expect(result.network).toBe("SN_MAIN");
      expect(result.session.isUnlocked()).toBe(false);
    });
  });

describe("runVaultCreationWithNetwork with no session", () => {
  test("an unreadable vault status after a failure keeps the network", async () => {
    // Nothing proves the write did not land, so the network stays with it.
    const preferencesStore = await sepolia();
    const unreadable = {
      async status(): Promise<never> {
        throw new Error("storage unavailable");
      },
    };
    await expect(
      runVaultCreationWithNetwork(
        createUnlockSession(),
        preferencesStore,
        unreadable,
        "SN_MAIN",
        decryptionFails,
      ),
    ).rejects.toThrow("decryption failed");
    expect((await preferencesStore.read()).activeNetworkId).toBe("SN_MAIN");
  });

  test("a refusal before the write undoes the network without reading the status", async () => {
    const preferencesStore = await sepolia();
    let statusReads = 0;
    const counted = {
      async status() {
        statusReads += 1;
        return { hasVault: true };
      },
    };
    await expect(
      runVaultCreationWithNetwork(
        createUnlockSession(),
        preferencesStore,
        counted,
        "SN_MAIN",
        async () => {
          throw new RefusedBeforeWrite("Wallet already exists");
        },
      ),
    ).rejects.toThrow("Wallet already exists");
    expect((await preferencesStore.read()).activeNetworkId).toBe("SN_SEPOLIA");
    expect(statusReads).toBe(0);
  });
});
