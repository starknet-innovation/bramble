/**
 * NFT auto-discovery message checks: the gallery is populated from the indexer
 * but every candidate is re-proven against the on-chain owner_of, so tokens the
 * account no longer owns (or that fail to read) never surface, and an
 * unconfigured indexer yields an empty gallery.
 */
import { describe, expect, test } from "bun:test";
import { createMessageHandler } from "../src/background/messages";
import type { RuntimeSender } from "../src/background/senders";
import { createUnlockSession } from "../src/background/session";
import type { DiscoveredNft } from "../src/starknet/nft-metadata";
import { createMemoryStore } from "../src/storage/kv";
import { createPreferencesStore } from "../src/storage/preferences-store";
import type { AccountRef, Vault } from "../src/storage/vault-schema";
import { makeRuntimeRpc } from "./support/runtime-rpc-stub";

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

const candidate = (tokenId: string, contract: string): DiscoveredNft => ({
  collection: "Punks",
  contract,
  id: `SN_MAIN:${contract}:${tokenId}`,
  image: "https://cdn.example/a.png",
  name: `Punk #${tokenId}`,
  networkId: "SN_MAIN",
  tokenId,
});

const makeHandler = (options: {
  readonly candidates: readonly DiscoveredNft[];
  readonly owners: Readonly<Record<string, string>>;
}) => {
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  return createMessageHandler(walletStub, "extension-id", {
    preferencesStore: createPreferencesStore({ store: createMemoryStore() }),
    runtimeRpc: makeRuntimeRpc({
      async getNftOwner({ contractAddress }) {
        const owner = options.owners[contractAddress];
        if (!owner) {
          throw new Error("owner_of reverted");
        }
        return owner;
      },
      nftIndexer: {
        async listOwnedNfts() {
          return options.candidates;
        },
      },
    }),
    session,
  });
};

describe("NFT auto-discovery messages", () => {
  test("returns only candidates the account still owns on-chain", async () => {
    const owned = candidate("5", "0x511a2b3");
    const stale = candidate("9", "0x6220000");
    const unreadable = candidate("7", "0x7330000");
    const handler = makeHandler({
      candidates: [owned, stale, unreadable],
      owners: {
        "0x511a2b3": account.address,
        "0x6220000": "0x999",
        // 0x7330000 intentionally absent -> owner_of throws -> dropped
      },
    });
    const response = await handler({ type: "wallet.discoverNfts" }, sender);
    expect(response).toEqual({ nfts: [owned], ok: true });
  });

  test("an unconfigured indexer yields an empty gallery", async () => {
    const handler = makeHandler({ candidates: [], owners: {} });
    await expect(handler({ type: "wallet.discoverNfts" }, sender)).resolves.toEqual({
      nfts: [],
      ok: true,
    });
  });

  test("rejects a malformed discover request", async () => {
    const handler = makeHandler({ candidates: [], owners: {} });
    await expect(handler({ extra: true, type: "wallet.discoverNfts" }, sender)).resolves.toEqual({
      error: "invalid discover nfts request",
    });
  });
});
