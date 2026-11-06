/**
 * Shared background harness for the NFT discovery message tests: one software
 * account on Mainnet, an unlocked session, an in-memory preferences store, and
 * a runtime RPC whose owner reads come from a fixed map. Split out so the
 * discovery suites stay within the repository size budget.
 */
import { memoryMultisigStore } from "@bramble/multisig/repository";
import type { NftCoverage, NftIndexerService } from "@bramble/portfolio/nft-indexer";
import type { DiscoveredNft } from "@bramble/portfolio/nft-metadata";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import type { Vault } from "@bramble/vault/schema";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import type { NftSnapshotStore } from "../../apps/extension/src/background/portfolio/nft-snapshots";
import { createMessageHandler } from "../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../apps/extension/src/background/routing/senders";
import type { RuntimeRpc } from "../../apps/extension/src/background/runtime/runtime-rpc";
import { createUnlockSession } from "../../apps/extension/src/background/runtime/session";
import { testExtension } from "./background-wallet-stub";
import { makeRuntimeRpc } from "./runtime-rpc-stub";

/** Shared NFT discovery fixture. */
export const account: AccountRef = {
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
/** Shared NFT discovery fixture. */
export const sender: RuntimeSender = {
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

/** Shared NFT discovery fixture. */
export const candidate = (tokenId: string, contract: string): DiscoveredNft => ({
  collection: "Punks",
  contract,
  id: `SN_MAIN:${contract}:${tokenId}`,
  image: "https://cdn.example/a.png",
  name: `Punk #${tokenId}`,
  networkId: "SN_MAIN",
  tokenId,
});

/** Shared NFT discovery fixture. */
export const makeHandler = (options: {
  readonly candidates: readonly DiscoveredNft[];
  readonly coverage?: NftCoverage;
  readonly nftIndexer?: NftIndexerService;
  readonly getNftMetadata?: NonNullable<RuntimeRpc["getNftMetadata"]>;
  readonly indexerFails?: boolean;
  readonly nftSnapshots?: NftSnapshotStore;
  readonly now?: () => number;
  readonly owners: Readonly<Record<string, string>>;
}) => {
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
  const multisigStore = memoryMultisigStore();
  let indexerCalls = 0;
  const indexedAddresses: string[] = [];
  const indexerUrls: Array<string | null> = [];
  const handler = createMessageHandler(walletStub, testExtension, {
    multisigStore,
    ...(options.nftSnapshots ? { nftSnapshots: options.nftSnapshots } : {}),
    ...(options.now ? { now: options.now } : {}),
    preferencesStore,
    runtimeRpc: makeRuntimeRpc({
      ...(options.getNftMetadata ? { getNftMetadata: options.getNftMetadata } : {}),
      async getNftOwner({ contractAddress }) {
        const owner = options.owners[contractAddress];
        if (!owner) {
          throw new Error("owner_of reverted");
        }
        return owner;
      },
      nftIndexer: options.nftIndexer ?? {
        async listOwnedNfts(input) {
          indexerCalls += 1;
          if (options.indexerFails) throw new Error("offline");
          indexedAddresses.push(input.address);
          indexerUrls.push(input.indexerUrl);
          // Mirrors the real indexer: no URL means no discovery ran.
          const coverage = input.indexerUrl === null ? "none" : (options.coverage ?? "complete");
          return { coverage, nfts: options.candidates };
        },
      },
    }),
    session,
  });
  return {
    handler,
    indexedAddresses,
    indexerCalls: () => indexerCalls,
    indexerUrls,
    multisigStore,
    preferencesStore,
  };
};
