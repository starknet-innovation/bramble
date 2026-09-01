/**
 * NFT handler invalid-input and guard branches: a malformed add-NFT request is
 * rejected before any RPC, watching or sending an NFT on a network other than
 * the active one is refused, and a send while the wallet is locked fails with
 * the locked error before ownership is even queried.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import type { Vault } from "@bramble/vault/schema";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";

const CONTRACT = "0x0511a2b3";
const account: AccountRef = {
  accountContractType: "openzeppelin",
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

const makeHandler = (unlocked: boolean) => {
  const session = createUnlockSession();
  if (unlocked) {
    session.unlock(vaultPassphrase);
  }
  return createMessageHandler(walletStub, "extension-id", {
    preferencesStore: createPreferencesStore({ store: createMemoryStore() }),
    runtimeRpc: makeRuntimeRpc({
      async getNftOwner() {
        return account.address;
      },
    }),
    session,
  });
};

describe("NFT handler input and guard branches", () => {
  test("rejects a malformed add-NFT request before any RPC", async () => {
    const handler = makeHandler(true);
    // Missing the contract field, so the target parser returns null.
    await expect(
      handler({ networkId: "SN_MAIN", tokenId: "5", type: "wallet.addNft" }, sender),
    ).resolves.toEqual({ error: "invalid add nft request" });
  });

  test("refuses to watch an NFT on a network other than the active one", async () => {
    const handler = makeHandler(true);
    await expect(
      handler(
        { contract: CONTRACT, networkId: "SN_SEPOLIA", tokenId: "5", type: "wallet.addNft" },
        sender,
      ),
    ).resolves.toEqual({ error: "switch to the NFT's network first" });
  });

  test("refuses to send an NFT on a network other than the active one", async () => {
    const handler = makeHandler(true);
    await expect(
      handler(
        {
          contract: CONTRACT,
          networkId: "SN_SEPOLIA",
          recipient: "0x321",
          tokenId: "5",
          type: "wallet.transferNft",
        },
        sender,
      ),
    ).resolves.toEqual({ error: "switch to the NFT's network first" });
  });

  test("fails an NFT send with the locked error when the wallet is locked", async () => {
    const handler = makeHandler(false);
    await expect(
      handler(
        {
          contract: CONTRACT,
          networkId: "SN_MAIN",
          recipient: "0x321",
          tokenId: "5",
          type: "wallet.transferNft",
        },
        sender,
      ),
    ).resolves.toEqual({ error: "wallet locked" });
  });
});
