/**
 * NFT gallery bindings through the real DOM: add a watched collectible, open
 * one, hide a discovered one as spam, toggle spam, remove, swap a broken image
 * for the placeholder, and recover every control after a wallet failure. The
 * detail send journey lives in sidepanel-nft-ui.test.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { DiscoveredNft } from "@bramble/portfolio/nft-metadata";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { account, preferences } from "@bramble/testkit/sidepanel";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { bindNfts, type NftUiDeps } from "../../../../src/sidepanel/journeys/collectibles/nft-ui";
import {
  nftGalleryFlow,
  nftWatchFlow,
} from "../../../../src/sidepanel/journeys/collectibles/nft-views";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

const status: WalletStatus = {
  accountCount: 1,
  accounts: [account],
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

const nft: DiscoveredNft = {
  collection: "Everai",
  contract: "0x511a2b3",
  id: "SN_MAIN:0x511a2b3:5",
  image: "https://cdn.example/everai/5.png",
  name: "Everai #5",
  networkId: "SN_MAIN",
  tokenId: "5",
};

const airdrop: DiscoveredNft = {
  ...nft,
  contract: "0x7330000",
  id: "SN_MAIN:0x7330000:11",
  name: "Airdrop #11",
  tokenId: "11",
};

beforeAll(registerDom);
afterAll(unregisterDom);

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  document.body.replaceChildren();
});

describe("NFT gallery bindings", () => {
  test("binds add, open, hide, spam, remove, and broken-image behavior", async () => {
    const watchedPreferences: WalletPreferences = {
      ...preferences,
      nfts: [
        {
          contract: nft.contract,
          id: nft.id,
          label: nft.name,
          networkId: nft.networkId,
          tokenId: nft.tokenId,
        },
        {
          contract: "0x6220000",
          id: "SN_MAIN:0x6220000:9",
          networkId: "SN_MAIN",
          spam: true,
          tokenId: "9",
        },
      ],
    };
    const app = document.createElement("div");
    app.replaceChildren(
      document
        .createRange()
        .createContextualFragment(
          nftGalleryFlow(status, account, watchedPreferences, [nft, airdrop]) +
            nftWatchFlow(status, account),
        ),
    );
    document.body.append(app);

    const added: unknown[][] = [];
    const spammed: unknown[][] = [];
    const removed: string[] = [];
    const opened: string[] = [];
    let renders = 0;
    bindNfts({
      app,
      openDetail: (id) => {
        opened.push(id);
      },
      render: async () => {
        renders += 1;
      },
      wallet: {
        async addNft(...args: unknown[]) {
          added.push(args);
        },
        async loadStatus() {
          return status;
        },
        async removeNft(id: string) {
          removed.push(id);
        },
        async setNftSpam(...args: unknown[]) {
          spammed.push(args);
        },
      } as unknown as NftUiDeps["wallet"],
    });

    app.querySelector<HTMLButtonElement>(`[data-nft-open="${nft.id}"]`)?.click();
    expect(opened).toEqual([nft.id]);

    const image = app.querySelector<HTMLImageElement>("img.nft-image");
    image?.dispatchEvent(new Event("error"));
    expect(image?.classList.contains("nft-image--broken")).toBe(true);

    app.querySelector<HTMLButtonElement>(`[data-nft-hide="${airdrop.id}"]`)?.click();
    app.querySelector<HTMLButtonElement>(`[data-nft-spam="${nft.id}"]`)?.click();
    app.querySelector<HTMLButtonElement>(`[data-remove-nft="${nft.id}"]`)?.click();

    const form = app.querySelector<HTMLFormElement>("#nft-form");
    const contract = form?.querySelector<HTMLInputElement>('input[name="contract"]');
    const tokenId = form?.querySelector<HTMLInputElement>('input[name="tokenId"]');
    const label = form?.querySelector<HTMLInputElement>('input[name="label"]');
    if (!form || !contract || !tokenId || !label) {
      throw new Error("NFT add form missing");
    }
    contract.value = " 0x0444 ";
    tokenId.value = "12";
    label.value = "Manual #12";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    await flush();
    await flush();
    expect(added).toContainEqual([
      airdrop.contract,
      airdrop.tokenId,
      airdrop.networkId,
      airdrop.name,
    ]);
    expect(added).toContainEqual(["0x444", "12", "SN_MAIN", "Manual #12"]);
    expect(spammed).toContainEqual([airdrop.id, true]);
    expect(spammed).toContainEqual([nft.id, true]);
    expect(removed).toEqual([nft.id]);
    expect(renders).toBeGreaterThanOrEqual(4);
  });

  test("recovers each gallery control after a wallet failure", async () => {
    const watchedPreferences: WalletPreferences = {
      ...preferences,
      nfts: [
        {
          contract: nft.contract,
          id: nft.id,
          label: nft.name,
          networkId: nft.networkId,
          tokenId: nft.tokenId,
        },
      ],
    };
    const app = document.createElement("div");
    app.replaceChildren(
      document
        .createRange()
        .createContextualFragment(
          nftGalleryFlow(status, account, watchedPreferences, [nft, airdrop]) +
            nftWatchFlow(status, account),
        ),
    );
    document.body.append(app);
    bindNfts({
      app,
      openDetail: () => undefined,
      render: async () => undefined,
      wallet: {
        async addNft(...args: unknown[]) {
          throw new Error(args[0] === airdrop.contract ? "Hide failed" : "Ownership failed");
        },
        async loadStatus() {
          return status;
        },
        async removeNft() {
          throw new Error("Removal failed");
        },
        async setNftSpam() {
          throw new Error("Spam update failed");
        },
      } as unknown as NftUiDeps["wallet"],
    });

    const hide = app.querySelector<HTMLButtonElement>(`[data-nft-hide="${airdrop.id}"]`);
    const spam = app.querySelector<HTMLButtonElement>(`[data-nft-spam="${nft.id}"]`);
    const remove = app.querySelector<HTMLButtonElement>(`[data-remove-nft="${nft.id}"]`);
    hide?.click();
    spam?.click();
    remove?.click();

    const form = app.querySelector<HTMLFormElement>("#nft-form");
    const contract = form?.querySelector<HTMLInputElement>('input[name="contract"]');
    const tokenId = form?.querySelector<HTMLInputElement>('input[name="tokenId"]');
    if (!form || !contract || !tokenId) {
      throw new Error("NFT add form missing");
    }
    contract.value = "0x444";
    tokenId.value = "12";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    await flush();
    await flush();
    expect(hide?.disabled).toBe(false);
    expect(spam?.disabled).toBe(false);
    expect(remove?.disabled).toBe(false);
    expect(app.querySelector("#nft-result")?.textContent).toBe("Ownership failed");
  });
});
