/**
 * Shared harness for the NFT send screen tests: one wallet double, one mounted
 * screen, the same fixtures. Shared so the send-review and send-outcome suites
 * test the same screen rather than two drifting copies of it.
 */

import type { DiscoveredNft } from "@bramble/portfolio/nft-metadata";
import { account, preferences } from "@bramble/testkit/sidepanel";
import type { ActivityEntry } from "@bramble/transactions/activity";
import type { WalletStatus } from "../../src/popup/responses/responses";
import { nftSendFlow } from "../../src/sidepanel/journeys/collectibles/nft-send-view";
import { bindNfts, type NftUiDeps } from "../../src/sidepanel/journeys/collectibles/nft-ui";

export const RECIPIENT = "0x02a3f4b1c5d6e7089a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6071";
export const POISONED = "0x02a3f4b1c5d6e7999999999999999999999999999999999991b2c3d4e5f6071";
export const OTHER_RECIPIENT = "0x07c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2";
const TRANSFER_HASH = "0x05b1c2d3e4f5061728394a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f9";

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

export const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

type Calls = {
  readonly review: unknown[][];
  readonly transfer: unknown[][];
};

export const mount = (
  review: Awaited<ReturnType<NftUiDeps["wallet"]["reviewNftTransfer"]>> = {
    fee: { overallFee: "1000", unit: "FRI" },
    feeAffordability: "unknown",
    feeEstimateFailed: false,
    flags: [],
    requiresDeployment: false,
    summaries: ["Send NFT #5 to 0x02a3…6071"],
  },
  failures: {
    readonly review?: Error;
    readonly transfer?: Error;
  } = {},
  // The status the activity log reports for the submitted hash. Omitted, the
  // chain never answers and the receipt stays on the submitted wording.
  chainStatus?: ActivityEntry["status"],
  // Holds the chain's answer until it resolves, for what happens meanwhile.
  chainGate?: Promise<void>,
) => {
  const app = document.createElement("div");
  app.replaceChildren(
    document
      .createRange()
      .createContextualFragment(nftSendFlow(status, account, preferences, nft.id, [nft])),
  );
  document.body.append(app);
  const calls: Calls = { review: [], transfer: [] };
  const navigations: string[] = [];
  const wallet = {
    async loadActivity() {
      if (!chainStatus) throw new Error("activity unavailable");
      await chainGate;
      return {
        entries: [
          {
            accountId: account.id,
            hash: TRANSFER_HASH,
            kind: "invoke" as const,
            networkId: "SN_MAIN" as const,
            status: chainStatus,
            submittedAt: 1,
            summary: "Send NFT #5",
          },
        ],
        historyUnavailable: false,
      };
    },
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
      return TRANSFER_HASH;
    },
  };
  bindNfts({
    app,
    ...(chainStatus ? { confirmationDelaysMs: [0] } : {}),
    navigate: (view) => {
      navigations.push(view);
    },
    openDetail: () => undefined,
    render: async () => undefined,
    wallet: wallet as unknown as NftUiDeps["wallet"],
  });
  return { app, calls, navigations };
};

export const recipientInput = (app: Element): HTMLInputElement => {
  const input = app.querySelector<HTMLInputElement>('input[name="recipient"]');
  if (!input) {
    throw new Error("recipient input missing");
  }
  return input;
};

export const submitButtonOf = (app: Element): HTMLButtonElement => {
  const button = app.querySelector<HTMLButtonElement>('#nft-send-form button[type="submit"]');
  if (!button) {
    throw new Error("NFT send button missing");
  }
  return button;
};

export const submit = (app: Element): void => {
  const form = app.querySelector<HTMLFormElement>("#nft-send-form");
  if (!form) {
    throw new Error("NFT send form missing");
  }
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
};
