/**
 * NFT detail send coverage through the real DOM binding: the first submit is a
 * read-only review, the second matching submit broadcasts, editing invalidates
 * the review, a poisoning flag never unlocks confirmation, and the receipt
 * reports the chain's answer — complete, or the failure it was.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { DiscoveredNft } from "@bramble/portfolio/nft-metadata";
import { account, preferences } from "@bramble/testkit/sidepanel";
import type { ActivityEntry } from "@bramble/transactions/activity";
import { sameFelt } from "@bramble/wallet-model/networks";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { nftSendFlow } from "../../../../src/sidepanel/journeys/collectibles/nft-send-view";
import { bindNfts, type NftUiDeps } from "../../../../src/sidepanel/journeys/collectibles/nft-ui";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

const RECIPIENT = "0x02a3f4b1c5d6e7089a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6071";
const POISONED = "0x02a3f4b1c5d6e7999999999999999999999999999999999991b2c3d4e5f6071";
const OTHER_RECIPIENT = "0x07c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2";
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

const submitButtonOf = (app: Element): HTMLButtonElement => {
  const button = app.querySelector<HTMLButtonElement>('#nft-send-form button[type="submit"]');
  if (!button) {
    throw new Error("NFT send button missing");
  }
  return button;
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
    // Submitted is not delivered: the receipt opens on what the hash proves and
    // firms up only once the chain reports the transfer.
    expect(app.querySelector("#nft-success-title")?.textContent).toBe("Transfer submitted");
    expect(app.querySelector("#nft-success-description")?.textContent).toContain(
      "Not confirmed yet",
    );
    // Held while the chain has not answered: nothing to send again yet.
    expect(submitButtonOf(app).disabled).toBe(true);
  });

  test("echoes separate undeployed-account fee ceilings into NFT submission", async () => {
    const { app, calls } = mount({
      deploymentFee: { overallFee: "2000", unit: "FRI" },
      deploymentFeeEstimateFailed: false,
      fee: { overallFee: "1000", unit: "FRI" },
      feeAffordability: "ok",
      feeEstimateFailed: false,
      flags: [],
      requiresDeployment: true,
      summaries: ["Deploy + send NFT #5"],
    });
    recipientInput(app).value = RECIPIENT;

    submit(app);
    await flush();
    expect(app.querySelector("#nft-review-panel")?.textContent).toContain(
      "Creating this account on Starknet is",
    );
    submit(app);
    await flush();

    expect(calls.transfer[0]?.slice(-2)).toEqual([
      { overallFee: "1000", unit: "FRI" },
      { overallFee: "2000", unit: "FRI" },
    ]);
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
      feeAffordability: "unknown",
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
      feeAffordability: "unknown",
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

const toastTexts = (tone: "error" | "success"): string[] =>
  Array.from(document.querySelectorAll(`.toast.${tone} .toast-text`)).map(
    (node) => node.textContent ?? "",
  );

// Reviews, confirms, and lets the confirmation wait reach the chain's answer.
const transferTo = async (chainStatus: ActivityEntry["status"]) => {
  const mounted = mount(undefined, {}, chainStatus);
  recipientInput(mounted.app).value = RECIPIENT;
  submit(mounted.app);
  await flush();
  submit(mounted.app);
  await flush();
  await flush();
  await flush();
  expect(mounted.calls.transfer).toHaveLength(1);
  return mounted;
};

describe("NFT transfer receipt", () => {
  test("a pre-confirmed transfer reads as complete", async () => {
    const { app } = await transferTo("preconfirmed");
    const receipt = app.querySelector("#nft-success");

    expect(app.querySelector("#nft-success-title")?.textContent).toBe("Transfer complete");
    expect(app.querySelector("#nft-success-description")?.textContent).toBe(
      "The collectible is now held by the recipient.",
    );
    expect(receipt?.classList.contains("send-success")).toBe(true);
    expect(receipt?.querySelector('[data-outcome-mark="succeeded"]')?.hasAttribute("hidden")).toBe(
      false,
    );
    // The toast is the chain's answer; the handoff is the receipt heading's job.
    expect(toastTexts("success")).toEqual(["Transaction pre-confirmed on Starknet"]);
    // The collectible has moved, so there is nothing here to send again.
    expect(submitButtonOf(app).disabled).toBe(true);
  });

  // The chain's two refusals. Each turns the receipt into a failure in place —
  // heading, the chain's reason, mark, tone and toast — and never leaves
  // "Transfer complete" over a collectible that did not move.
  for (const [chainStatus, reason] of [
    ["rejected", "Starknet rejected this transaction. Nothing changed."],
    [
      "reverted",
      "Starknet reverted this transaction. Review its activity details before retrying.",
    ],
  ] as const) {
    test(`a ${chainStatus} transfer reads as failed, not complete`, async () => {
      const { app } = await transferTo(chainStatus);
      const receipt = app.querySelector("#nft-success");

      expect(app.querySelector("#nft-success-title")?.textContent).toBe("Transfer failed");
      expect(app.querySelector("#nft-success-description")?.textContent).toBe(reason);
      // The hash stays: it is how the reader finds out why.
      expect(app.querySelector("#nft-success-hash")?.textContent).not.toBe("");
      expect(receipt?.classList.contains("send-failure")).toBe(true);
      expect(receipt?.classList.contains("send-success")).toBe(false);
      expect(receipt?.querySelector('[data-outcome-mark="failed"]')?.hasAttribute("hidden")).toBe(
        false,
      );
      expect(
        receipt?.querySelector('[data-outcome-mark="succeeded"]')?.hasAttribute("hidden"),
      ).toBe(true);
      expect(toastTexts("error")).toEqual(["Transaction was not confirmed"]);
      expect(toastTexts("success")).toEqual([]);
    });

    test(`a ${chainStatus} transfer can be reviewed and sent again`, async () => {
      const { app, calls } = await transferTo(chainStatus);
      const button = submitButtonOf(app);

      // Not a dead "Confirm transfer": the collectible never moved, so the
      // control comes back as a fresh review under the receipt.
      expect(button.disabled).toBe(false);
      expect(button.hasAttribute("data-busy")).toBe(false);
      expect(button.textContent).toContain("Review transfer");
      expect(app.querySelector("#nft-send-form")?.getAttribute("data-stage")).toBe("failed");

      // The refused fee is not reused: the press reviews again first.
      submit(app);
      await flush();
      expect(calls.review).toHaveLength(2);
      expect(calls.transfer).toHaveLength(1);
      expect(app.querySelector("#nft-success")).toBeNull();
      expect(button.textContent).toContain("Confirm transfer");

      submit(app);
      await flush();
      expect(calls.transfer).toHaveLength(2);
    });
  }

  test("a refusal that lands after the reader moved on leaves the new review alone", async () => {
    let answer = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const { app, calls } = mount(undefined, {}, "reverted", gate);
    const input = recipientInput(app);
    input.value = RECIPIENT;
    submit(app);
    await flush();
    submit(app);
    await flush();
    await flush();

    // While the chain is still answering, the reader edits the recipient — which
    // clears the receipt — and reviews a new transfer.
    input.value = OTHER_RECIPIENT;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    submit(app);
    await flush();
    expect(submitButtonOf(app).textContent).toContain("Confirm transfer");

    answer();
    await flush();
    await flush();

    // The first transfer's refusal answers for a receipt no longer on screen.
    expect(submitButtonOf(app).textContent).toContain("Confirm transfer");
    expect(app.querySelector("#nft-send-form")?.getAttribute("data-stage")).toBe("review");
    expect(toastTexts("error")).toEqual([]);
    submit(app);
    await flush();
    expect(calls.transfer).toHaveLength(2);
    expect(sameFelt(calls.transfer[1]?.[3], OTHER_RECIPIENT)).toBe(true);
  });
});
