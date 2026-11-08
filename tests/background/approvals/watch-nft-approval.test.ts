/**
 * A site's wallet_watchAsset for a collectible (ERC721/ERC1155, ahead of the
 * Starknet wallet API): a card is always queued without reading the chain, so
 * the site learns nothing before the user acts; approve is refused while the
 * user has turned NFTs off, and otherwise watches the NFT only after
 * ownership is re-proved on-chain.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import type { Vault } from "@bramble/vault/schema";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { createApprovalQueue } from "../../../apps/extension/src/background/approvals/approvals";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { testExtension } from "../../support/background-wallet-stub";
import { flushHeld, latestApprovalId } from "../../support/held";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";

const origin = "https://dapp.example";
const CONTRACT = "0x0511a2b3c4d5e6f";
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
const contentSender: RuntimeSender = { id: "extension-id", url: `${origin}/app` };
const extensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};

const walletStub = {
  addDerivedAccount: async () => account,
  createAccount: async () => account,
  ensureNetworkAccount: async () => account,
  generateMnemonic: async () => "unused",
  getGrantedAccounts: async () => [account],
  grantOrigin: async () => [account],
  readVault: async () => vault,
  setActiveAccount: async () => account,
  signHash: async () => ({ publicKey: account.publicKeyX, r: "0x1", s: "0x2" }),
  status: async () => ({
    accountCount: 1,
    activeAccountId: account.id,
    hasVault: true,
    locked: false,
    ready: true,
  }),
};

const makeHandler = async (options: { readonly preview: boolean; readonly owner: string }) => {
  const session = createUnlockSession();
  session.unlock("correct horse battery staple");
  const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
  // NFTs are on by default: only the user turning them off stores `false`.
  if (!options.preview) await preferencesStore.setDisplay({ collectiblesPreview: false });
  const ownerReads: string[] = [];
  const handler = createMessageHandler(walletStub, testExtension, {
    approvals: createApprovalQueue(),
    preferencesStore,
    runtimeRpc: makeRuntimeRpc({
      async getNftOwner({ tokenId }) {
        ownerReads.push(tokenId);
        return options.owner;
      },
    }),
    session,
  });
  return { handler, ownerReads, preferencesStore };
};

const watch = (tokenId = "7", type = "ERC721") => ({
  nft: { address: CONTRACT, standard: type, tokenId },
  origin,
  type: "wallet.watchAsset",
});

describe("watch-collectible approval lifecycle", () => {
  test("waits for the user even while NFTs are turned off, and approve is refused", async () => {
    const { handler, ownerReads, preferencesStore } = await makeHandler({
      owner: account.address,
      preview: false,
    });
    // An immediate answer would tell the site the preference (audit M1).
    const held = handler(watch(), contentSender);
    const early = await Promise.race([
      held.then(() => "answered"),
      new Promise((resolve) => setTimeout(() => resolve("waiting"), 100)),
    ]);
    expect(early).toBe("waiting");
    const id = await latestApprovalId(handler, extensionSender);
    await expect(handler({ id, type: "wallet.approveOrigin" }, extensionSender)).resolves.toEqual({
      error: "nfts are turned off",
    });
    await expect(held).resolves.toEqual({ error: "nfts are turned off" });
    expect(ownerReads).toEqual([]);
    expect((await preferencesStore.read()).nfts ?? []).toEqual([]);
  });

  test("queues one card per collectible without reading the chain", async () => {
    const { handler, ownerReads } = await makeHandler({ owner: account.address, preview: true });
    void handler(watch(), contentSender);
    void handler(watch(), contentSender);
    await flushHeld();
    const pending = (await handler({ type: "wallet.pendingApprovals" }, extensionSender)) as {
      readonly pending: readonly Record<string, unknown>[];
    };
    expect(pending.pending).toHaveLength(1);
    expect(pending.pending[0]?.["nft"]).toEqual({
      contract: "0x00000000000000000000000000000000000000000000000000511a2b3c4d5e6f",
      networkId: "SN_MAIN",
      standard: "ERC721",
      tokenId: "7",
    });
    expect(pending.pending[0]?.["token"]).toBeUndefined();
    expect(ownerReads).toEqual([]);
  });

  test("approving watches an NFT the account owns and answers watched", async () => {
    const { handler, ownerReads, preferencesStore } = await makeHandler({
      owner: account.address,
      preview: true,
    });
    const held = handler(watch(), contentSender);
    await flushHeld();
    const id = await latestApprovalId(handler, extensionSender);
    await handler({ id, type: "wallet.approveOrigin" }, extensionSender);
    await expect(held).resolves.toEqual({ ok: true, watched: true });
    expect(ownerReads).toEqual(["7"]);
    const nfts = (await preferencesStore.read()).nfts ?? [];
    expect(nfts.map((nft) => [nft.contract, nft.tokenId, nft.owner])).toEqual([
      [
        "0x511a2b3c4d5e6f",
        "7",
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
      ],
    ]);
  });

  test("approving refuses an NFT the account does not own and stores nothing", async () => {
    const { handler, preferencesStore } = await makeHandler({ owner: "0x999", preview: true });
    const held = handler(watch(), contentSender);
    await flushHeld();
    const id = await latestApprovalId(handler, extensionSender);
    await expect(handler({ id, type: "wallet.approveOrigin" }, extensionSender)).resolves.toEqual({
      error: "this account does not own that NFT",
    });
    await expect(held).resolves.toEqual({ error: "this account does not own that NFT" });
    expect((await preferencesStore.read()).nfts ?? []).toEqual([]);
  });

  test("a malformed collectible request is refused before anything is queued", async () => {
    const { handler } = await makeHandler({ owner: account.address, preview: true });
    for (const message of [
      watch("-1"),
      watch("7", "ERC20"),
      { ...watch(), asset: { address: CONTRACT } },
    ]) {
      await expect(handler(message, contentSender)).resolves.toEqual({
        error: "invalid watch asset request",
      });
    }
  });
});
