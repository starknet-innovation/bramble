/**
 * Send outcomes that must never invite a blind re-send (audits #173, #247).
 *
 * A lost broadcast reply is not "not sent": the transfer may already be on
 * chain, so the receipt says the status is unknown and offers Activity, not
 * Try again. And every failure drops the review, so Try again always reviews
 * afresh before anything is signed a second time.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { account } from "@bramble/testkit/sidepanel";
import type { ActivityStatus } from "@bramble/transactions/activity";
import { SubmissionUnknownError } from "@bramble/wallet-protocol/submission-unknown";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { sendFlow } from "../../../../src/sidepanel/journeys/send/send-views";
import type { TransferExitView } from "../../../../src/sidepanel/journeys/send/transfer-model";
import { submitRejection } from "../../../../src/sidepanel/journeys/send/transfer-submit";
import {
  bindTransfer,
  type TransferUiDeps,
} from "../../../../src/sidepanel/journeys/send/transfer-ui";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

const HASH = "0x5eed";
const TOKEN_ADDRESS = "0x3456";
const TOKEN = {
  address: TOKEN_ADDRESS,
  decimals: 6,
  id: `SN_MAIN:TST:${TOKEN_ADDRESS}`,
  name: "Test token",
  networkId: "SN_MAIN" as const,
  symbol: "TST",
};
const BALANCE = { ...TOKEN, balance: "10000000", formatted: "10" };
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
const preferences: WalletPreferences = {
  activeNetworkId: "SN_MAIN",
  addressBook: [],
  schemaVersion: 1,
  tokens: [TOKEN],
};

beforeAll(registerDom);
afterAll(unregisterDom);

const flush = async (): Promise<void> => {
  for (let index = 0; index < 4; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const mount = (submit: (call: number) => Promise<string>, chainStatus: ActivityStatus) => {
  document.body.replaceChildren();
  const app = document.createElement("div");
  app.replaceChildren(
    document
      .createRange()
      .createContextualFragment(
        sendFlow(status, account, preferences, [BALANCE], { [TOKEN_ADDRESS]: 1 }),
      ),
  );
  document.body.append(app);
  const calls: string[] = [];
  const navigated: TransferExitView[] = [];
  const wallet = {
    async loadActivity() {
      return {
        entries: [
          {
            accountId: account.id,
            hash: HASH,
            kind: "transfer" as const,
            networkId: "SN_MAIN" as const,
            status: chainStatus,
            submittedAt: 1,
            summary: "Sent 1 TST",
          },
        ],
        historyUnavailable: false,
      };
    },
    async reviewTransfer() {
      calls.push("review");
      return {
        fee: { overallFee: "1000", unit: "FRI" as const },
        feeEstimateFailed: false,
        flags: [],
        requiresDeployment: false,
        summaries: ["Transfer 1 TST"],
      };
    },
    async submitTransfer() {
      calls.push("submit");
      return submit(calls.filter((call) => call === "submit").length);
    },
  };
  const deps: TransferUiDeps = {
    app,
    confirmationDelaysMs: [0],
    navigate: (view) => navigated.push(view),
    publicBalances: () => [BALANCE],
    render: async () => undefined,
    waitForConfirmation: async () => undefined,
    wallet: wallet as unknown as TransferUiDeps["wallet"],
  };
  bindTransfer(deps);
  const form = app.querySelector<HTMLFormElement>("#transfer-form");
  if (!form) throw new Error("Missing Send form");
  for (const [name, value] of [
    ["recipient", "0x2345"],
    ["recipientLabel", "Treasury"],
    ["amount", "1"],
  ] as const) {
    const input = form.querySelector<HTMLInputElement>(`input[name="${name}"]`);
    if (!input) throw new Error(`Missing ${name}`);
    input.value = value;
  }
  return { app, calls, form, navigated };
};

const reviewAndConfirm = async (form: HTMLFormElement): Promise<void> => {
  form.requestSubmit();
  await flush();
  form.requestSubmit();
  await flush();
};

const visible = (app: Element, selector: string): boolean =>
  app.querySelector(selector)?.hasAttribute("hidden") === false;

describe("a lost broadcast reply on Send", () => {
  test("says the status is unknown, hides Try again, and leads with Activity", async () => {
    const { app, calls, form, navigated } = mount(async () => {
      throw new SubmissionUnknownError("Transaction submission status is unknown.", null);
    }, "pending");
    await reviewAndConfirm(form);

    expect(form.dataset["stage"]).toBe("failed");
    const title = app.querySelector("#send-failure-title")?.textContent ?? "";
    const copy = app.querySelector("#send-failure-copy")?.textContent ?? "";
    expect(title).toBe("Status unknown");
    expect(`${title} ${copy}`).not.toContain("not sent");
    expect(copy).toBe("Transaction submission status is unknown.");
    expect(app.querySelector("#send-failure")?.getAttribute("data-severity")).toBe("warning");
    expect(document.querySelector("#send-header-title")?.textContent).not.toContain("failed");
    expect(visible(app, "#send-retry")).toBe(false);
    expect(visible(app, "#send-failure-activity")).toBe(true);
    app.querySelector<HTMLButtonElement>("#send-failure-activity")?.click();
    expect(navigated).toEqual(["activity"]);
    expect(calls).toEqual(["review", "submit"]);
  });

  test("follows a captured hash like any submitted transaction", async () => {
    const { app, calls, form } = mount(async () => {
      throw new SubmissionUnknownError("Transaction submission status is unknown.", HASH);
    }, "pending");
    await reviewAndConfirm(form);

    expect(form.dataset["stage"]).toBe("pending");
    expect(app.querySelector("#send-pending-hash")?.getAttribute("title")).toBe(HASH);
    expect(calls).toEqual(["review", "submit"]);
  });

  test("a determinate failure resets the severity and keeps Try again", async () => {
    const { app, form } = mount(async () => {
      throw new Error("The network fee could not be estimated");
    }, "pending");
    await reviewAndConfirm(form);

    expect(app.querySelector("#send-failure-title")?.textContent).toBe("Transaction not sent");
    expect(app.querySelector("#send-failure")?.hasAttribute("data-severity")).toBe(false);
    expect(visible(app, "#send-retry")).toBe(true);
    expect(visible(app, "#send-failure-activity")).toBe(false);
  });
});

describe("Try again after a failure", () => {
  test("re-reviews a determinate submit failure before signing again", async () => {
    const { app, calls, form } = mount(async (call) => {
      if (call === 1) throw new Error("The network fee could not be estimated");
      return HASH;
    }, "accepted");
    await reviewAndConfirm(form);
    app.querySelector<HTMLButtonElement>("#send-retry")?.click();
    await flush();

    expect(calls).toEqual(["review", "submit", "review"]);
    expect(form.dataset["stage"]).toBe("review");
  });

  test("re-reviews after Starknet rejects the submitted transfer", async () => {
    const { app, calls, form } = mount(async () => HASH, "rejected");
    await reviewAndConfirm(form);
    expect(form.dataset["stage"]).toBe("failed");
    app.querySelector<HTMLButtonElement>("#send-retry")?.click();
    await flush();

    expect(calls).toEqual(["review", "submit", "review"]);
    expect(form.dataset["stage"]).toBe("review");
  });
});

describe("submitRejection (shared by the public and pool routes)", () => {
  const state = {
    error: "",
    fields: null,
    privatePreparation: { id: "prep" } as never,
    progress: null,
    requiresDeployment: false,
    review: { fee: null } as never,
    reviewedKey: "key",
    stage: "authorizing" as const,
    submissionUnknown: false,
    transactionHash: null,
  };

  test("never prefixes an unknown outcome with 'not sent' and drops the review", () => {
    const rejection = submitRejection(
      state,
      new SubmissionUnknownError("Transaction submission status is unknown.", null),
      "Private send failed",
    );
    expect(rejection.state.error).toBe("Transaction submission status is unknown.");
    expect(rejection.state.submissionUnknown).toBe(true);
    expect(rejection.toast).toBeNull();
    expect(rejection.state.reviewedKey).toBeNull();
    expect(rejection.state.review).toBeNull();
    expect(rejection.state.privatePreparation).toBeNull();
  });

  test("keeps 'not sent' for a determinate failure, still dropping the review", () => {
    const rejection = submitRejection(state, new Error("Not enough private STRK"), "x");
    expect(rejection.state.error).toBe("The transaction was not sent. Not enough private STRK");
    expect(rejection.toast).toBe("Transaction was not sent");
    expect(rejection.state.reviewedKey).toBeNull();
    expect(rejection.follow).toBe(false);
  });
});
