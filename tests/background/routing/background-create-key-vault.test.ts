/**
 * `wallet.createKeyVault` routing checks: the first-run raw-key vault creation
 * is extension-page-only, parses through the shared raw-key grammar without
 * echoing the key, reaches the wallet service exactly once with the canonical
 * key, unlocks the session on success, and fails closed when the wallet
 * surface is unavailable. An existing vault is refused before the active
 * network changes.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import type { CreateKeyVaultInput } from "@bramble/vault/service";
import { ARGENT_ACCOUNT_CLASS_HASH } from "@bramble/wallet-model/account-families";
import { canonicalFelt } from "@bramble/wallet-model/networks";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import { defaultRuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import {
  account,
  contentSender,
  createWallet,
  extensionSender as sender,
  testExtension,
  vaultPassphrase,
} from "../../support/background-wallet-stub";

// Clearly-fake test vector; not a real key.
const privateKey = "0xfeedface";

const validMessage = {
  accountContractType: "openzeppelin",
  networkId: "SN_MAIN",
  privateKey,
  type: "wallet.createKeyVault",
  vaultPassphrase,
} as const;

const readyMessage = {
  ...validMessage,
  accountContractType: "argent" as const,
  classHashes: [ARGENT_ACCOUNT_CLASS_HASH],
  deploymentSalt: "0xabc",
};

const sepolia = async () => {
  const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
  await preferencesStore.setActiveNetwork("SN_SEPOLIA");
  return preferencesStore;
};

describe("wallet.createKeyVault routing", () => {
  test("creates the key vault through the wallet service and unlocks the session", async () => {
    const captured: CreateKeyVaultInput[] = [];
    const session = createUnlockSession();
    const handler = createMessageHandler(
      createWallet({
        captureCreateKeyVault: (input) => captured.push(input),
        hasVault: false,
      }),
      testExtension,
      { session },
    );

    await expect(handler(validMessage, sender)).resolves.toEqual({ account, ok: true });
    expect(captured).toEqual([
      {
        accountContractType: "openzeppelin",
        networkId: "SN_MAIN",
        privateKey,
        vaultPassphrase,
      },
    ]);
    expect(session.getPassphrase()).toBe(vaultPassphrase);
  });

  test("rejects malformed requests without echoing the key", async () => {
    const captured: CreateKeyVaultInput[] = [];
    const session = createUnlockSession();
    const handler = createMessageHandler(
      createWallet({ captureCreateKeyVault: (input) => captured.push(input) }),
      testExtension,
      { session },
    );
    const rejected = [
      // No vault passphrase: first-run creation has no session to take it from.
      { ...validMessage, vaultPassphrase: undefined },
      // Short passphrases never reach the vault.
      { ...validMessage, vaultPassphrase: "short" },
      // A deployment salt is Ready-only; the Bramble contract refuses it.
      { ...validMessage, deploymentSalt: "0x1" },
      // Unknown keys are rejected wholesale at the trust boundary.
      { ...validMessage, extra: true },
      // An out-of-range key never reaches Krusty.
      { ...validMessage, privateKey: "0x0" },
    ];
    for (const message of rejected) {
      const response = await handler(message, sender);
      expect(response).toEqual({ error: "invalid create key vault request" });
      expect(JSON.stringify(response)).not.toContain("feedface");
    }
    expect(captured).toEqual([]);
    expect(session.getPassphrase()).toBeNull();
  });

  test("accepts a Ready account with its exact deployment salt and picked release", async () => {
    const captured: CreateKeyVaultInput[] = [];
    // A Ready key is only imported at a release the user picked and the chain
    // still shows in use.
    const handler = createMessageHandler(
      createWallet({
        captureCreateKeyVault: (input) => captured.push(input),
        hasVault: false,
      }),
      testExtension,
      { runtimeRpc: { ...defaultRuntimeRpc, getDeploymentStatus: async () => true } },
    );
    await expect(
      handler(
        {
          ...validMessage,
          accountContractType: "argent",
          classHashes: [ARGENT_ACCOUNT_CLASS_HASH],
          deploymentSalt: "0xabc",
        },
        sender,
      ),
    ).resolves.toEqual({ account, ok: true });
    expect(captured[0]?.deploymentSalt).toBe("0xabc");
    expect(captured[0]?.classHashes).toEqual([canonicalFelt(ARGENT_ACCOUNT_CLASS_HASH) ?? ""]);
  });

  test("refuses a Ready key that names no picked release", async () => {
    const captured: CreateKeyVaultInput[] = [];
    const handler = createMessageHandler(
      createWallet({ captureCreateKeyVault: (input) => captured.push(input) }),
      testExtension,
      { runtimeRpc: { ...defaultRuntimeRpc, getDeploymentStatus: async () => true } },
    );
    await expect(
      handler({ ...validMessage, accountContractType: "argent" }, sender),
    ).resolves.toEqual({ error: "invalid create key vault request" });
    expect(captured).toEqual([]);
  });

  test("is privileged: content scripts cannot reach it", async () => {
    const handler = createMessageHandler(createWallet(), testExtension);
    await expect(handler(validMessage, contentSender)).resolves.toEqual({
      error: "privileged sender required",
    });
  });

  test("fails closed when the wallet surface lacks createKeyVault", async () => {
    const { createKeyVault: _omitted, ...withoutCreate } = createWallet();
    const handler = createMessageHandler(withoutCreate, testExtension);
    await expect(handler(validMessage, sender)).resolves.toEqual({ error: "wallet unavailable" });
  });

  test("a first run adopts the requested network", async () => {
    const preferencesStore = await sepolia();
    const session = createUnlockSession();
    const handler = createMessageHandler(createWallet({ hasVault: false }), testExtension, {
      preferencesStore,
      session,
    });
    await expect(handler(validMessage, sender)).resolves.toEqual({ account, ok: true });
    expect((await preferencesStore.read()).activeNetworkId).toBe("SN_MAIN");
    expect(session.getPassphrase()).toBe(vaultPassphrase);
  });

  test("an existing vault refuses a key import before the network changes", async () => {
    const preferencesStore = await sepolia();
    const captured: CreateKeyVaultInput[] = [];
    const session = createUnlockSession();
    const handler = createMessageHandler(
      createWallet({
        captureCreateKeyVault: (input) => captured.push(input),
        hasVault: true,
      }),
      testExtension,
      { preferencesStore, session },
    );
    await expect(handler(validMessage, sender)).resolves.toEqual({
      error: "Wallet already exists",
    });
    expect(captured).toEqual([]);
    expect((await preferencesStore.read()).activeNetworkId).toBe("SN_SEPOLIA");
    expect(session.getPassphrase()).toBeNull();
  });

  test("a locked vault is refused before a wrong passphrase can switch the network", async () => {
    // A wrong passphrase fails decryption rather than refusing, so nothing
    // after the network write would undo it.
    const preferencesStore = await sepolia();
    let writes = 0;
    const wallet = {
      ...createWallet({ hasVault: true }),
      async createKeyVault(): Promise<never> {
        writes += 1;
        throw new Error("decryption failed");
      },
    };
    const handler = createMessageHandler(wallet, testExtension, { preferencesStore });
    await expect(handler(validMessage, sender)).resolves.toEqual({
      error: "Wallet already exists",
    });
    expect(writes).toBe(0);
    expect((await preferencesStore.read()).activeNetworkId).toBe("SN_SEPOLIA");
  });

  test("an existing vault refuses a Ready release import before the network changes", async () => {
    const preferencesStore = await sepolia();
    const captured: CreateKeyVaultInput[] = [];
    const handler = createMessageHandler(
      createWallet({
        captureCreateKeyVault: (input) => captured.push(input),
        hasVault: true,
      }),
      testExtension,
      {
        preferencesStore,
        runtimeRpc: { ...defaultRuntimeRpc, getDeploymentStatus: async () => true },
      },
    );
    await expect(handler(readyMessage, sender)).resolves.toEqual({
      error: "Wallet already exists",
    });
    expect(captured).toEqual([]);
    expect((await preferencesStore.read()).activeNetworkId).toBe("SN_SEPOLIA");
  });

  test("a vault created during the Ready proof is refused before the network changes", async () => {
    let hasVault = false;
    const preferencesStore = await sepolia();
    const captured: CreateKeyVaultInput[] = [];
    const handler = createMessageHandler(
      createWallet({
        captureCreateKeyVault: (input) => captured.push(input),
        hasVault: () => hasVault,
      }),
      testExtension,
      {
        preferencesStore,
        runtimeRpc: {
          ...defaultRuntimeRpc,
          async getDeploymentStatus() {
            hasVault = true;
            return true;
          },
        },
      },
    );
    await expect(handler(readyMessage, sender)).resolves.toEqual({
      error: "Wallet already exists",
    });
    expect(captured).toEqual([]);
    expect((await preferencesStore.read()).activeNetworkId).toBe("SN_SEPOLIA");
  });

  test("an unlocked session does not let a wrong passphrase switch the network", async () => {
    // Unlocked under the existing vault's passphrase, the request carries
    // another one: decryption would fail, the network would switch and the
    // session would lock.
    const preferencesStore = await sepolia();
    const session = createUnlockSession();
    session.unlock("an-existing-vault-passphrase");
    let writes = 0;
    const wallet = {
      ...createWallet({ hasVault: true }),
      async createKeyVault(): Promise<never> {
        writes += 1;
        throw new Error("decryption failed");
      },
    };
    const handler = createMessageHandler(wallet, testExtension, { preferencesStore, session });
    await expect(handler(validMessage, sender)).resolves.toEqual({
      error: "Wallet already exists",
    });
    expect(writes).toBe(0);
    expect((await preferencesStore.read()).activeNetworkId).toBe("SN_SEPOLIA");
    expect(session.getPassphrase()).toBe("an-existing-vault-passphrase");
  });

  test("an existing vault refuses a Ready key before any chain read", async () => {
    // The pasted key's addresses are never sent to a node once the write is
    // bound to refuse.
    let reads = 0;
    const handler = createMessageHandler(createWallet({ hasVault: true }), testExtension, {
      runtimeRpc: {
        ...defaultRuntimeRpc,
        async getDeploymentStatus() {
          reads += 1;
          return true;
        },
      },
    });
    await expect(handler(readyMessage, sender)).resolves.toEqual({
      error: "Wallet already exists",
    });
    expect(reads).toBe(0);
  });
});
