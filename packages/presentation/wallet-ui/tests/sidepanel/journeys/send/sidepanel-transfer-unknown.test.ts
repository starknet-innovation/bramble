/**
 * Send outcomes that must never invite a blind re-send (audits #173, #247).
 *
 * A lost broadcast reply is not "not sent": the transfer may already be on
 * chain, so the receipt says the status is unknown and offers Activity, not
 * Try again. And every failure drops the review, so Try again always reviews
 * afresh before anything is signed a second time.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  STRK20_PRIOR_WRITE_STRANDED,
  STRK20_PRIOR_WRITE_UNRESOLVED,
} from "@bramble/privacy/maturity";
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
import { createSidepanelRuntime } from "../../../../src/sidepanel/runtime/runtime";
import { knownNotSent, priorWriteRefusal } from "../../../../src/sidepanel/shared/submit-outcome";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

const HASH = "0x5eed";
// A refusal the background makes before anything is signed.
const FEE_ROSE =
  "The network fee for this transaction rose above the amount you reviewed. Nothing was submitted — review it again.";
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
      throw new Error(FEE_ROSE);
    }, "pending");
    await reviewAndConfirm(form);

    expect(app.querySelector("#send-failure-title")?.textContent).toBe("Transaction not sent");
    expect(app.querySelector("#send-failure")?.hasAttribute("data-severity")).toBe(false);
    expect(visible(app, "#send-retry")).toBe(true);
    expect(visible(app, "#send-failure-activity")).toBe(false);
  });
});

describe("a refusal over an earlier private write that may still land (#661)", () => {
  const SHOWN =
    "An earlier private transaction from this account may still be in progress. Check Activity, then check again.";

  test("says this one was not sent, keeps the earlier one's fact, and offers Check again", async () => {
    const { app, calls, form, navigated } = mount(async (call) => {
      if (call === 1) throw new Error(STRK20_PRIOR_WRITE_UNRESOLVED);
      return HASH;
    }, "accepted");
    await reviewAndConfirm(form);

    const title = app.querySelector("#send-failure-title")?.textContent ?? "";
    const copy = app.querySelector("#send-failure-copy")?.textContent ?? "";
    expect(title).toBe("Transaction not sent");
    expect(copy).toBe(SHOWN);
    expect(app.querySelector("#send-failure")?.hasAttribute("data-severity")).toBe(false);
    expect(visible(app, "#send-retry")).toBe(true);
    expect(app.querySelector("#send-retry")?.textContent).toBe("Check again");
    expect(visible(app, "#send-failure-activity")).toBe(true);
    app.querySelector<HTMLButtonElement>("#send-failure-activity")?.click();
    expect(navigated).toEqual(["activity"]);

    app.querySelector<HTMLButtonElement>("#send-retry")?.click();
    await flush();
    expect(calls).toEqual(["review", "submit", "review"]);
    expect(form.dataset["stage"]).toBe("review");
  });

  test("a stranded earlier write names the browser restart and offers no retry", async () => {
    const { app, form } = mount(async () => {
      throw new Error(STRK20_PRIOR_WRITE_STRANDED);
    }, "pending");
    await reviewAndConfirm(form);

    expect(app.querySelector("#send-failure-title")?.textContent).toBe("Transaction not sent");
    expect(app.querySelector("#send-failure-copy")?.textContent).toBe(
      "An earlier private transaction from this account may still be in progress. Close every browser window and reopen the browser to recover.",
    );
    expect(visible(app, "#send-retry")).toBe(false);
    expect(visible(app, "#send-failure-activity")).toBe(true);
  });

  test("a later determinate failure goes back to Try again without Activity", async () => {
    const { app, form } = mount(async (call) => {
      if (call === 1) throw new Error(STRK20_PRIOR_WRITE_UNRESOLVED);
      throw new Error(FEE_ROSE);
    }, "pending");
    await reviewAndConfirm(form);
    app.querySelector<HTMLButtonElement>("#send-retry")?.click();
    await flush();
    form.requestSubmit();
    await flush();

    expect(app.querySelector("#send-retry")?.textContent).toBe("Try again");
    expect(visible(app, "#send-failure-activity")).toBe(false);
  });

  test("a later lost reply on the same screen hides Try again again", async () => {
    const { app, form } = mount(async (call) => {
      if (call === 1) throw new Error(STRK20_PRIOR_WRITE_UNRESOLVED);
      throw new SubmissionUnknownError("Transaction submission status is unknown.", null);
    }, "pending");
    await reviewAndConfirm(form);
    app.querySelector<HTMLButtonElement>("#send-retry")?.click();
    await flush();
    form.requestSubmit();
    await flush();

    expect(app.querySelector("#send-failure-copy")?.textContent).toBe(
      "Transaction submission status is unknown.",
    );
    expect(visible(app, "#send-retry")).toBe(false);
  });

  test("a typed unknown outcome carrying the same words is never treated as one", () => {
    expect(priorWriteRefusal(new Error(STRK20_PRIOR_WRITE_UNRESOLVED))).toBe("unresolved");
    expect(priorWriteRefusal(new Error(STRK20_PRIOR_WRITE_STRANDED))).toBe("stranded");
    expect(
      priorWriteRefusal(new SubmissionUnknownError(STRK20_PRIOR_WRITE_UNRESOLVED, null)),
    ).toBeNull();
    expect(priorWriteRefusal(new Error("strk20 services unavailable"))).toBeNull();
    // Other surfaces read it as not sent: it was refused before it was claimed.
    expect(knownNotSent(new Error(STRK20_PRIOR_WRITE_UNRESOLVED))).toBe(true);
    expect(knownNotSent(new Error(STRK20_PRIOR_WRITE_STRANDED))).toBe(true);
  });
});

describe("Try again after a failure", () => {
  test("re-reviews a determinate submit failure before signing again", async () => {
    const { app, calls, form } = mount(async (call) => {
      if (call === 1) throw new Error(FEE_ROSE);
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
    );
    expect(rejection.state.error).toBe("Transaction submission status is unknown.");
    expect(rejection.state.submissionUnknown).toBe(true);
    expect(rejection.toast).toBeNull();
    expect(rejection.state.reviewedKey).toBeNull();
    expect(rejection.state.review).toBeNull();
    expect(rejection.state.privatePreparation).toBeNull();
  });

  test("never carries an earlier prior-write refusal's Try again into a lost reply", () => {
    const rejection = submitRejection(
      { ...state, priorWrite: "unresolved" },
      new SubmissionUnknownError("Transaction submission status is unknown.", null),
    );
    expect(rejection.state.submissionUnknown).toBe(true);
    expect(rejection.state.priorWrite).toBeNull();
  });

  test("keeps 'not sent' for a pre-submit refusal, still dropping the review", () => {
    const rejection = submitRejection(state, new Error("Insufficient private balance"));
    expect(rejection.state.error).toBe(
      "The transaction was not sent. Insufficient private balance",
    );
    expect(rejection.toast).toBe("Transaction was not sent");
    expect(rejection.state.reviewedKey).toBeNull();
    expect(rejection.follow).toBe(false);
  });
});

// Errors audit F1: the whole rendered receipt for every way a confirm can be
// rejected. "Not sent" only for a pre-submit refusal; everything else may be on
// chain and says so, in one sentence that does not contradict itself.
describe("the rendered Send receipt for each rejection", () => {
  const UNKNOWN = "The transfer may not have gone through. Check Activity before trying again.";
  const NOT_SENT = /\b(?:not sent|nothing was (?:submitted|signed|sent))\b/i;
  const MAYBE = /\b(?:may not have gone through|status is unknown|could not be confirmed)\b/i;
  const cases: readonly (readonly [string, () => Error, string, string])[] = [
    ["an unrecognised reply", () => new Error("transfer failed"), "Status unknown", UNKNOWN],
    ["the router's catch-all", () => new Error("wallet request failed"), "Status unknown", UNKNOWN],
    [
      "a bookkeeping failure that surfaced as a plain error",
      () => new Error("vault storage limit reached"),
      "Status unknown",
      `This wallet is full, so this change wasn't saved. ${UNKNOWN}`,
    ],
    [
      "a raw RPC answer",
      () => new Error("RPC: starknet_addInvokeTransaction with params {}"),
      "Status unknown",
      `The RPC rejected this request. Copy the error details for the full response. ${UNKNOWN}`,
    ],
    [
      "the indeterminate-write sentence passed through as a plain error",
      () =>
        new Error(
          "Transaction submission status is unknown. Check activity and on-chain state before retrying.",
        ),
      "Status unknown",
      "Transaction submission status is unknown. Check activity and on-chain state before retrying.",
    ],
    [
      "a lost reply the background typed",
      () => new SubmissionUnknownError("Transaction submission status is unknown.", null),
      "Status unknown",
      "Transaction submission status is unknown.",
    ],
    [
      "a wallet failure after the Ledger signed",
      () => new Error("unexpected-device-error"),
      "Status unknown",
      `Something went wrong talking to your Ledger. Open the Starknet app, close other apps using it, then try again. ${UNKNOWN}`,
    ],
    [
      "a fee ceiling refusal",
      () => new Error(FEE_ROSE),
      "Transaction not sent",
      `The transaction was not sent. ${FEE_ROSE}`,
    ],
    [
      "a poisoned recipient",
      () =>
        new Error(
          "The recipient closely mimics an address you saved or paid but is a different account. Re-check every character before sending.",
        ),
      "Transaction not sent",
      "The transaction was not sent. The recipient closely mimics an address you saved or paid but is a different account. Re-check every character before sending.",
    ],
    [
      "a request declined on the Ledger",
      () => new Error("rejected-on-device"),
      "Transaction not sent",
      "The transaction was not sent. You rejected the request on your Ledger. Nothing was submitted.",
    ],
    [
      "a locked wallet",
      () => new Error("wallet locked"),
      "Transaction not sent",
      "The transaction was not sent. The wallet is locked or unavailable. Unlock it and try again.",
    ],
  ];

  for (const [name, error, title, copy] of cases) {
    test(name, async () => {
      const { app, form } = mount(async () => {
        throw error();
      }, "pending");
      await reviewAndConfirm(form);

      const shownTitle = app.querySelector("#send-failure-title")?.textContent ?? "";
      const shownCopy = app.querySelector("#send-failure-copy")?.textContent ?? "";
      expect(shownTitle).toBe(title);
      expect(shownCopy).toBe(copy);
      // One claim per receipt: never "not sent" beside "may not have gone through".
      const whole = `${shownTitle}. ${shownCopy}`;
      expect(NOT_SENT.test(whole) && MAYBE.test(whole), whole).toBe(false);
      expect(visible(app, "#send-retry")).toBe(title === "Transaction not sent");
      expect(visible(app, "#send-failure-activity")).toBe(title === "Status unknown");
    });
  }

  test("a reply the browser lost (worker stopped) through the real client", async () => {
    const runtime = createSidepanelRuntime({
      sendMessage: () =>
        Promise.reject(new Error("The message port closed before a response was received.")),
    });
    const { app, form } = mount(() => runtime.submitTransfer("a", "t", "0x1", "1"), "pending");
    await reviewAndConfirm(form);
    expect(app.querySelector("#send-failure-title")?.textContent).toBe("Status unknown");
    expect(app.querySelector("#send-failure-copy")?.textContent).toBe(UNKNOWN);
  });

  test("a pool route names the private transaction", () => {
    const rejection = submitRejection(
      {
        error: "",
        fields: { destination: "private", source: "private" } as never,
        privatePreparation: null,
        progress: null,
        requiresDeployment: false,
        review: null,
        reviewedKey: null,
        stage: "authorizing",
        submissionUnknown: false,
        transactionHash: null,
      },
      new Error("Private transaction failed"),
    );
    expect(rejection.state.error).toBe(
      "The private transaction may not have gone through. Check Activity before trying again.",
    );
    expect(rejection.state.submissionUnknown).toBe(true);
    expect(rejection.toast).toBeNull();
  });
});
