/**
 * NFT send safety checks in the background: ownership is re-proven for the
 * active account before signing (watched NFTs are not account-scoped), and a
 * recipient that mimics a saved address is blocked by pre-sign verification
 * instead of being silently signed.
 */
import { describe, expect, test } from "bun:test";
import { createMessageHandler } from "../../src/background/messages";
import type { RuntimeSender } from "../../src/background/senders";
import { createUnlockSession } from "../../src/background/session";
import { createMemoryStore } from "../../src/storage/kv";
import { createPreferencesStore } from "../../src/storage/preferences-store";
import type { AccountRef, Vault } from "../../src/storage/vault-schema";
import { makeRuntimeRpc } from "../support/runtime-rpc-stub";

const CONTRACT = "0x0511a2b3";
const account: AccountRef = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};
const vault = { accounts: [account], activeAccountId: account.id } as unknown as Vault;
const vaultPassphrase = "correct horse battery staple";
const sender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};

const SAVED = "0x777aa7890abcdef1234567890abcdef1234567890abcdef1234567890aabbcc";
const POISONED = "0x777aa7890abcdef9999999999999999999999999999999999999990aabbcc";

const walletStub = {
  async addDerivedAccount() {
    return account;
  },
  async createAccount() {
    return account;
  },
  async ensureNetworkAccount() {
    return account;
  },
  async getGrantedAccounts() {
    return [account];
  },
  async generateMnemonic() {
    return "unused";
  },
  async grantOrigin() {
    return [account];
  },
  async readVault() {
    return vault;
  },
  async setActiveAccount() {
    return account;
  },
  async signHash() {
    return { publicKey: account.publicKeyX, r: "0x1", s: "0x2" };
  },
  async status() {
    return {
      accountCount: 1,
      activeAccountId: account.id,
      hasVault: true,
      locked: false,
      ready: false,
    };
  },
};

const makeHarness = (options?: { readonly owner?: string }) => {
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const invokeCalls: (readonly unknown[])[] = [];
  const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
  const handler = createMessageHandler(walletStub, "extension-id", {
    preferencesStore,
    runtimeRpc: makeRuntimeRpc({
      async getNftOwner() {
        return options?.owner ?? account.address;
      },
      async submitInvokeTransaction(input) {
        invokeCalls.push(input.calls);
        return { calls: input.calls, transactionHash: "0x7cd" };
      },
    }),
    session,
  });
  return { handler, invokeCalls, preferencesStore };
};

const transferNft = (
  handler: ReturnType<typeof makeHarness>["handler"],
  recipient: string,
): Promise<unknown> =>
  handler(
    {
      contract: CONTRACT,
      networkId: "SN_MAIN",
      recipient,
      tokenId: "5",
      type: "wallet.transferNft",
    },
    sender,
  );

describe("NFT send verification", () => {
  test("rejects the send when the active account no longer owns the NFT", async () => {
    const { handler, invokeCalls } = makeHarness({ owner: "0x999" });
    await expect(transferNft(handler, SAVED)).resolves.toEqual({
      error: "this account does not own that NFT",
    });
    expect(invokeCalls).toHaveLength(0);
  });

  test("blocks a recipient that mimics a saved address without signing", async () => {
    const { handler, invokeCalls, preferencesStore } = makeHarness();
    await preferencesStore.saveAddress({ address: SAVED, label: "Ada", networkId: "SN_MAIN" });

    const response = (await transferNft(handler, POISONED)) as { error?: string };
    expect(response.error).toBeDefined();
    expect(response.error).toContain("mimics");
    expect(invokeCalls).toHaveLength(0);
  });

  test("submits a clean NFT send through the invoke path", async () => {
    const { handler, invokeCalls } = makeHarness();
    const response = await transferNft(handler, "0x321");
    expect(response).toEqual({ ok: true, transactionHash: "0x7cd" });
    expect(invokeCalls).toHaveLength(1);
  });
});
