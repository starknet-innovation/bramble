/**
 * NFT detail send coverage through the real DOM binding: the first submit is a
 * read-only review, the second matching submit broadcasts, editing invalidates
 * the review, and a poisoning flag never unlocks confirmation.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { WalletStatus } from "../../src/popup/responses";
import { nftSendFlow } from "../../src/sidepanel/nft-send-view";
import { bindNfts, type NftUiDeps } from "../../src/sidepanel/nft-ui";
import { nftGalleryFlow, nftWatchFlow } from "../../src/sidepanel/nft-views";
import type { DiscoveredNft } from "../../src/starknet/nft-metadata";
import type { WalletPreferences } from "../../src/storage/preferences-store";
import { registerDom, unregisterDom } from "../support/groups-harness";
import { account, preferences } from "../support/sidepanel-fixtures";

const RECIPIENT = "0x02a3f4b1c5d6e7089a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6071";
const POISONED = "0x02a3f4b1c5d6e7999999999999999999999999999999999991b2c3d4e5f6071";

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

type Calls = {
  readonly review: unknown[][];
  readonly transfer: unknown[][];
};

const mount = (
  review: Awaited<ReturnType<NftUiDeps["wallet"]["reviewNftTransfer"]>> = {
    fee: { overallFee: "1000", unit: "FRI" },
    feeEstimateFailed: false,
    flags: [],
    requiresDeployment: false,
    summaries: ["Send NFT #5 to 0x02a3…6071"],
  },
  failures: {
    readonly review?: Error;
    readonly transfer?: Error;
  } = {},
) => {
  const app = document.createElement("div");
  app.replaceChildren(
    document
      .createRange()
      .createContextualFragment(nftSendFlow(status, account, preferences, nft.id, [nft])),
  );
  document.body.append(app);
  const calls: Calls = { review: [], transfer: [] };
  const wallet = {
    async loadStatus() {
      return status;
    },
    async reviewNftTransfer(...args: unknown[]) {
      calls.review.push(args);
      if (failures.review) {
        throw failures.review;
      }
      return review;
    },
    async transferNft(...args: unknown[]) {
      calls.transfer.push(args);
      if (failures.transfer) {
        throw failures.transfer;
      }
      return "0xdeadbeef";
    },
  };
  bindNfts({
    app,
    openDetail: () => undefined,
    render: async () => undefined,
    wallet: wallet as unknown as NftUiDeps["wallet"],
  });
  return { app, calls };
};

const recipientInput = (app: Element): HTMLInputElement => {
  const input = app.querySelector<HTMLInputElement>('input[name="recipient"]');
  if (!input) {
    throw new Error("recipient input missing");
  }
  return input;
};

const submit = (app: Element): void => {
  const form = app.querySelector<HTMLFormElement>("#nft-send-form");
  if (!form) {
    throw new Error("NFT send form missing");
  }
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
};

beforeEach(() => {
  document.body.replaceChildren();
});

describe("NFT send review", () => {
  test("reviews first and only broadcasts after the second matching submit", async () => {
    const { app, calls } = mount();
    recipientInput(app).value = RECIPIENT;

    submit(app);
    await flush();
    expect(calls.review).toHaveLength(1);
    expect(calls.transfer).toHaveLength(0);
    expect(app.querySelector("#nft-review-panel")?.textContent).toContain("Send NFT #5");
    expect(app.querySelector<HTMLButtonElement>('button[type="submit"]')?.textContent).toContain(
      "Confirm transfer",
    );

    submit(app);
    await flush();
    expect(calls.transfer).toHaveLength(1);
    expect(app.querySelector("#nft-send-result")?.textContent).toContain(
      "Confirmation is tracked in Activity",
    );
    expect(app.querySelector("#nft-review-panel")?.textContent).toContain("Submitted to Starknet");
  });

  test("editing the recipient invalidates the completed review", async () => {
    const { app, calls } = mount();
    const input = recipientInput(app);
    input.value = RECIPIENT;
    submit(app);
    await flush();

    input.value = "0x123";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    submit(app);
    await flush();
    expect(calls.review).toHaveLength(2);
    expect(calls.transfer).toHaveLength(0);
  });

  test("shows a poisoning warning but never enables confirmation", async () => {
    const { app, calls } = mount({
      fee: { overallFee: "1000", unit: "FRI" },
      feeEstimateFailed: false,
      flags: [
        {
          code: "address-poisoning",
          message: "The recipient closely mimics one of your saved addresses.",
        },
      ],
      requiresDeployment: false,
      summaries: ["Send NFT #5"],
    });
    recipientInput(app).value = POISONED;

    submit(app);
    await flush();
    expect(app.querySelector("#nft-send-result")?.textContent).toContain("blocked");
    expect(app.querySelector<HTMLButtonElement>('button[type="submit"]')?.textContent).toContain(
      "Review transfer",
    );

    submit(app);
    await flush();
    expect(calls.review).toHaveLength(2);
    expect(calls.transfer).toHaveLength(0);
  });

  test("keeps malformed recipients and failed reviews away from signing", async () => {
    const invalid = mount();
    recipientInput(invalid.app).value = "not-an-address";
    submit(invalid.app);
    await flush();
    expect(invalid.calls.review).toHaveLength(0);
    expect(invalid.calls.transfer).toHaveLength(0);
    expect(invalid.app.querySelector("#nft-send-result")?.textContent).toBe(
      "Enter a valid Starknet address.",
    );

    document.body.replaceChildren();
    const failed = mount(undefined, {
      review: new Error("invalid nft transfer review request"),
    });
    recipientInput(failed.app).value = RECIPIENT;
    submit(failed.app);
    await flush();
    expect(failed.calls.review).toHaveLength(1);
    expect(failed.calls.transfer).toHaveLength(0);
    expect(failed.app.querySelector("#nft-send-result")?.textContent).toBe(
      "Enter a valid Starknet address.",
    );
  });

  test("requires a successful fee retry before confirmation", async () => {
    const review = {
      fee: null,
      feeEstimateFailed: true,
      flags: [],
      requiresDeployment: false,
      summaries: ["Send NFT #5"],
    } as const;
    const { app, calls } = mount(review);
    recipientInput(app).value = RECIPIENT;

    submit(app);
    await flush();
    expect(calls.review).toHaveLength(1);
    expect(calls.transfer).toHaveLength(0);
    expect(app.querySelector<HTMLButtonElement>("#review-retry-fee")).not.toBeNull();

    app.querySelector<HTMLButtonElement>("#review-retry-fee")?.click();
    await flush();
    expect(calls.review).toHaveLength(2);
    expect(calls.transfer).toHaveLength(0);
  });

  test("reports a failed confirmation and leaves the reviewed transfer retryable", async () => {
    const { app, calls } = mount(undefined, {
      transfer: new Error("Ledger disconnected"),
    });
    recipientInput(app).value = RECIPIENT;

    submit(app);
    await flush();
    submit(app);
    await flush();

    expect(calls.review).toHaveLength(1);
    expect(calls.transfer).toHaveLength(1);
    expect(app.querySelector("#nft-send-result")?.textContent).toContain("Ledger disconnected");
    expect(app.querySelector("#nft-send-result")?.textContent).toContain("Nothing was submitted");

    submit(app);
    await flush();
    expect(calls.transfer).toHaveLength(2);
  });
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
