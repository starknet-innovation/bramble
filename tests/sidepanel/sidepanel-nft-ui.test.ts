/**
 * NFT detail send coverage through the real DOM binding: the first submit is a
 * read-only review, the second matching submit broadcasts, editing invalidates
 * the review, and a poisoning flag never unlocks confirmation.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { WalletStatus } from "../../src/popup/responses";
import { bindNfts, type NftUiDeps } from "../../src/sidepanel/nft-ui";
import { nftDetailFlow } from "../../src/sidepanel/nft-views";
import type { DiscoveredNft } from "../../src/starknet/nft-metadata";
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
) => {
  const app = document.createElement("div");
  app.replaceChildren(
    document
      .createRange()
      .createContextualFragment(nftDetailFlow(status, account, preferences, nft.id, [nft])),
  );
  document.body.append(app);
  const calls: Calls = { review: [], transfer: [] };
  const wallet = {
    async loadStatus() {
      return status;
    },
    async reviewNftTransfer(...args: unknown[]) {
      calls.review.push(args);
      return review;
    },
    async transferNft(...args: unknown[]) {
      calls.transfer.push(args);
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
    expect(app.querySelector("#nft-send-result")?.textContent).toBe("Submitted 0xdeadbeef");
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
});
