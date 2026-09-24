/**
 * Behavioural coverage for the send review/confirm flow (`bindTransfer`),
 * driven through the real bindings under happy-dom. The send form is rendered
 * from the real `sendFlow` template; events are dispatched and the injected
 * wallet dependencies (reviewTransfer / submitTransfer / loadStatus /
 * loadActivity) are stubbed via the shared harness to steer each branch. The
 * activity refresh/export suites live in `sidepanel-activity-ui.test.ts`.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { account } from "@bramble/testkit/sidepanel";
import { LEDGER_EIP2645_APPLICATION, ledgerAccountPath } from "@bramble/wallet-model/ledger-path";
import type { TokenBalance } from "../../../../src/popup/responses/responses";
import { sendFlow } from "../../../../src/sidepanel/app/screens/flows";
import {
  bindTransfer,
  friendlyReviewError,
  markTransferLedgerAuthorized,
  recipientFieldError,
} from "../../../../src/sidepanel/journeys/send/transfer-ui";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import {
  flush,
  mountTransferUi as mount,
  paint,
  transferPreferences as preferences,
  transferPublicBalance as publicBalance,
  TRANSFER_RECIPIENT as RECIPIENT,
  setTransferField as setField,
  walletStatus as status,
  submitTransferForm as submit,
} from "../../../support/transfer-ui-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const originalSetTimeout = globalThis.setTimeout;

const resultText = (app: HTMLElement): string =>
  app.querySelector("#transfer-result")?.textContent ?? "";

const reviewText = (app: HTMLElement): string =>
  app.querySelector("#send-review-risks")?.textContent ?? "";

const feeText = (app: HTMLElement): string =>
  app.querySelector("#send-review-fee")?.textContent ?? "";

beforeEach(() => {
  document.body.replaceChildren();
  // Run timers synchronously so the deployment watch resolves observably
  // within the test.
  (globalThis as { setTimeout: unknown }).setTimeout = ((fn: () => void) => {
    fn();
    return 0;
  }) as unknown as typeof setTimeout;
});

afterEach(() => {
  (globalThis as { setTimeout: unknown }).setTimeout = originalSetTimeout;
});

describe("recipientFieldError / friendlyReviewError helpers", () => {
  test("flags a non-address recipient and accepts a valid felt", () => {
    expect(recipientFieldError("hello")).toBe("Enter a valid Starknet address.");
    expect(recipientFieldError(RECIPIENT)).toBeNull();
  });

  test("maps the background developer error onto the friendly inline message", () => {
    expect(friendlyReviewError(new Error("invalid transfer review request"))).toBe(
      "Enter a valid Starknet address.",
    );
    expect(friendlyReviewError(new Error("boom"))).toBe("boom");
  });
});

describe("bindTransfer", () => {
  test("is a no-op when the app has no transfer form", () => {
    const app = document.createElement("div");
    document.body.append(app);
    expect(() => bindTransfer({ app, render: async () => {}, wallet: {} as never })).not.toThrow();
  });

  test("blocks submit on an invalid recipient without reviewing", async () => {
    const { app, calls, deps } = mount();
    bindTransfer(deps);
    setField(app, "recipient", "not-an-address");
    setField(app, "amount", "1");
    submit(app);
    await flush();
    expect(calls.reviewTransfer).toHaveLength(0);
    expect(resultText(app)).toBe("Enter a valid Starknet address.");
  });

  test("reviews first, then confirms and submits on the second submit", async () => {
    const { app, calls, deps } = mount();
    bindTransfer(deps);
    setField(app, "recipient", RECIPIENT);
    setField(app, "amount", "1");

    submit(app);
    await flush();
    expect(calls.reviewTransfer).toHaveLength(1);
    expect(app.querySelector("#send-details")?.hasAttribute("hidden")).toBe(true);
    expect(app.querySelector("#send-review-stage")?.hasAttribute("hidden")).toBe(false);
    const button = app.querySelector("#send-confirm-button");
    expect(button?.textContent).toContain("Confirm and send");
    // The fee sits on the always-visible confirm face, outside the collapsed
    // "Transaction details" disclosure, and renders exactly once (#190).
    expect(feeText(app)).toContain("Estimated fee");
    expect(app.querySelector(".send-review-disclosure #send-review-fee")).toBeNull();
    expect(reviewText(app)).not.toContain("Estimated fee");
    const feeLines = [
      ...app.querySelectorAll("#send-review-stage .review-fee, #send-review-stage .review-flag"),
    ].map((node) => node.textContent ?? "");
    expect(feeLines.filter((line) => line.includes("Estimated fee"))).toHaveLength(1);
    // Beside it, in the same style, what this configuration exposes on chain.
    expect(feeLines).toContainEqual(
      "You are sending from a public balance to a public balance. Sender address, amount and recipient address are public.",
    );

    submit(app);
    await flush();
    expect(calls.submitTransfer).toHaveLength(1);
    expect(app.querySelector("#send-success")?.hasAttribute("hidden")).toBe(false);
    expect(app.querySelector("#send-success-hash")?.textContent).toBe("0xdeadbeef");
    expect(app.querySelector("#send-home")?.textContent).toBe("Back");
    expect(app.querySelector("#send-another")).toBeNull();
    // Three steps: review, authorizing, broadcasting and confirmation all rest
    // on Confirm rather than each taking a step of its own.
    expect(app.querySelector('[data-send-step="sent"]')).toBeNull();
    expect(app.querySelector('[data-send-step="sign"]')).toBeNull();
    expect(app.querySelector('[data-send-step="review"]')?.getAttribute("data-state")).toBe(
      "active",
    );
  });

  test("keeps the amount screen visible while its review is prepared", async () => {
    let resolveReview = (_review: unknown): void => undefined;
    const review = new Promise((resolve) => {
      resolveReview = resolve;
    });
    const { app, deps } = mount({ reviewTransfer: () => review });
    bindTransfer(deps);
    setField(app, "recipient", RECIPIENT);
    setField(app, "amount", "1");

    submit(app);
    await flush();
    expect(app.querySelector("#transfer-form")?.getAttribute("data-stage")).toBe("reviewing");
    expect(app.querySelector("#send-details")?.hasAttribute("hidden")).toBe(false);
    expect(app.querySelector("#send-review-button")?.hasAttribute("data-busy")).toBe(true);

    resolveReview({
      fee: { overallFee: "1000", unit: "FRI" },
      feeEstimateFailed: false,
      flags: [],
      requiresDeployment: false,
      summaries: ["Transfer"],
    });
    await flush();
    expect(app.querySelector("#send-review-stage")?.hasAttribute("hidden")).toBe(false);
  });

  test("continues a shortcut-owned funding send into deployment", async () => {
    const { app, deps } = mount();
    paint(
      app,
      sendFlow(status, account, preferences, [publicBalance], {}, {}, "usd", [], {
        accountId: account.id,
        completeTo: "multisig-deploy",
        destination: "public",
        networkId: status.networkId,
        recipient: RECIPIENT,
        recipientLabel: "New treasury",
        source: "public",
        tokenId: publicBalance.id,
      }),
    );
    const views: string[] = [];
    const returned: string[] = [];
    bindTransfer({
      ...deps,
      back: () => returned.push("multisig-deploy"),
      navigate: (view) => views.push(view),
    });
    setField(app, "amount", "1");
    submit(app);
    await flush();
    submit(app);
    await flush();
    await flush();

    expect(app.querySelector("#send-home")?.textContent).toBe("Deploy Multisignature Account");
    app.querySelector<HTMLButtonElement>("#send-home")?.click();
    app.querySelector<HTMLButtonElement>("#send-close")?.click();
    expect(returned).toEqual(["multisig-deploy", "multisig-deploy"]);
    expect(views).toEqual([]);
  });

  // Back out of the review and the next Review send must show the review again,
  // not submit. The reviewed marker is what separates the two, so a return to
  // the amount step that kept it turned one click into a send.
  test("re-reviews rather than submitting after backing out of the review", async () => {
    const { app, calls, deps } = mount();
    bindTransfer(deps);
    setField(app, "recipient", RECIPIENT);
    setField(app, "amount", "1");

    submit(app);
    await flush();
    expect(app.querySelector("#send-review-stage")?.hasAttribute("hidden")).toBe(false);

    app.ownerDocument.querySelector("#send-header-back")?.dispatchEvent(new Event("click"));
    expect(app.querySelector("#send-details")?.hasAttribute("hidden")).toBe(false);

    submit(app);
    await flush();
    expect(calls.submitTransfer).toHaveLength(0);
    expect(calls.reviewTransfer).toHaveLength(2);
    expect(app.querySelector("#send-review-stage")?.hasAttribute("hidden")).toBe(false);

    // Only the confirm from the re-shown review sends.
    submit(app);
    await flush();
    expect(calls.submitTransfer).toHaveLength(1);
  });

  test("invalidates a review when the final route gate fails", async () => {
    const token = preferences.tokens[0];
    if (!token) throw new Error("transfer token fixture missing");
    const balance = (raw: string): readonly TokenBalance[] => [
      {
        ...token,
        balance: raw,
        formatted: raw === "0" ? "0" : "2",
      },
    ];
    let balances = balance("2000000000000000000");
    const { app, calls, deps } = mount();
    bindTransfer({ ...deps, publicBalances: () => balances });
    setField(app, "recipient", RECIPIENT);
    setField(app, "amount", "1");

    submit(app);
    await flush();
    expect(calls.reviewTransfer).toHaveLength(1);

    // The reviewed amount is no longer affordable at final confirmation.
    balances = balance("0");
    submit(app);
    await flush();
    expect(calls.submitTransfer).toHaveLength(0);
    expect(resultText(app)).toBe("Not enough ETH");

    // Even if a refresh clears the gate, the stale review cannot submit. The
    // next click must produce a new review and only its confirm may send.
    balances = balance("2000000000000000000");
    submit(app);
    await flush();
    expect(calls.reviewTransfer).toHaveLength(2);
    expect(calls.submitTransfer).toHaveLength(0);
  });

  test("watches for deployment after confirming a first send", async () => {
    const { app, calls, deps } = mount({
      async reviewTransfer() {
        return {
          deploymentFee: { overallFee: "2000", unit: "FRI" },
          deploymentFeeEstimateFailed: false,
          fee: { overallFee: "1000", unit: "FRI" },
          feeEstimateFailed: false,
          flags: [],
          requiresDeployment: true,
          summaries: ["Deploy + transfer"],
        };
      },
    });
    bindTransfer(deps);
    setField(app, "recipient", RECIPIENT);
    setField(app, "amount", "1");

    submit(app);
    await flush();
    expect(reviewText(app)).toContain("not deployed yet");
    // One action, one figure: the total leads and the deployment share is named
    // under it, rather than two amounts the user has to add up.
    expect(feeText(app)).toContain("Estimated fee");
    expect(feeText(app)).toContain("Creating this account on Starknet is");
    expect(feeText(app)).not.toContain("Estimated transaction fee");

    submit(app);
    await flush();
    await flush();
    expect(calls.submitTransfer).toHaveLength(1);
    // The first send also triggers the deployment watch.
    expect(calls.loadDeploymentStatus).toBeGreaterThan(0);
  });

  test("refuses confirmation when either undeployed-account fee is unavailable", async () => {
    const { app, calls, deps } = mount({
      async reviewTransfer() {
        return {
          deploymentFee: null,
          deploymentFeeEstimateFailed: true,
          fee: null,
          feeEstimateFailed: true,
          flags: [],
          requiresDeployment: true,
          summaries: ["Deploy + transfer"],
        };
      },
    });
    bindTransfer(deps);
    setField(app, "recipient", RECIPIENT);
    setField(app, "amount", "1");

    submit(app);
    await flush();
    expect(feeText(app)).toContain("Couldn't estimate both");
    submit(app);
    await flush();
    expect(calls.submitTransfer).toHaveLength(0);
  });

  test("re-estimates instead of sending when the two fees cannot be added", async () => {
    let reviewCount = 0;
    const { app, calls, deps } = mount({
      async reviewTransfer() {
        reviewCount += 1;
        return {
          deploymentFee: { overallFee: "1500", unit: "WEI" },
          deploymentFeeEstimateFailed: false,
          fee: { overallFee: "2000", unit: "FRI" },
          feeEstimateFailed: false,
          flags: [],
          requiresDeployment: true,
          summaries: ["Deploy + transfer"],
        };
      },
    });
    bindTransfer(deps);
    setField(app, "recipient", RECIPIENT);
    setField(app, "amount", "1");

    submit(app);
    await flush();
    expect(reviewCount).toBe(1);
    expect(feeText(app)).toContain("Couldn't estimate both");
    expect(app.querySelector<HTMLButtonElement>("#send-confirm-button")?.disabled).toBe(true);
    expect(calls.submitTransfer).toHaveLength(0);

    app.querySelector<HTMLButtonElement>("#send-review-fee #review-retry-fee")?.click();
    await flush();
    expect(reviewCount).toBe(2);
    expect(calls.submitTransfer).toHaveLength(0);
  });

  test("keeps the review pending and offers a retry when the fee estimate fails", async () => {
    let reviewCount = 0;
    const { app, calls, deps } = mount({
      async reviewTransfer() {
        reviewCount += 1;
        return {
          fee: null,
          feeEstimateFailed: true,
          flags: [],
          requiresDeployment: false,
          summaries: ["Transfer"],
        };
      },
    });
    bindTransfer(deps);
    setField(app, "recipient", RECIPIENT);
    setField(app, "amount", "1");

    submit(app);
    await flush();
    expect(reviewCount).toBe(1);
    expect(resultText(app)).toContain("Fee estimate unavailable");
    const button = app.querySelector<HTMLButtonElement>("#send-confirm-button");
    expect(button?.disabled).toBe(true);
    // The failure explaining the disabled Confirm — and its retry affordance —
    // sit on the visible confirm face, not inside the disclosure (#190).
    expect(feeText(app)).toContain("Couldn't estimate the network fee");
    const retry = app.querySelector<HTMLButtonElement>("#send-review-fee #review-retry-fee");
    expect(retry).not.toBeNull();
    expect(calls.submitTransfer).toHaveLength(0);

    // Clicking retry re-runs the review rather than submitting.
    retry?.click();
    await flush();
    expect(reviewCount).toBe(2);
    expect(calls.submitTransfer).toHaveLength(0);
  });

  test("surfaces the friendly recipient message when the review rejects", async () => {
    const { app, deps } = mount({
      async reviewTransfer() {
        throw new Error("invalid transfer review request");
      },
    });
    bindTransfer(deps);
    setField(app, "recipient", RECIPIENT);
    setField(app, "amount", "1");
    submit(app);
    await flush();
    expect(resultText(app)).toBe("Enter a valid Starknet address.");
  });

  test("reports a submit failure after a successful review", async () => {
    let submitCount = 0;
    const { app, deps } = mount({
      async submitTransfer() {
        submitCount += 1;
        throw new Error("network exploded");
      },
    });
    bindTransfer(deps);
    setField(app, "recipient", RECIPIENT);
    setField(app, "amount", "1");

    submit(app);
    await flush();
    submit(app);
    await flush();
    expect(submitCount).toBe(1);
    expect(app.querySelector("#transfer-form")?.getAttribute("data-stage")).toBe("failed");
    expect(app.querySelector("#send-failure-copy")?.textContent).toContain("network exploded");
    expect(app.querySelector("#send-failure")?.hasAttribute("hidden")).toBe(false);
  });

  test("keeps Ledger progress alive across a shell repaint and advances after device signing", async () => {
    let resolveSubmit = (_hash: string): void => {
      throw new Error("submit promise was not initialized");
    };
    const pendingSubmit = new Promise<string>((resolve) => {
      resolveSubmit = resolve;
    });
    const ledgerAccount = {
      ...account,
      derivation: {
        accountIndex: 0,
        eip2645application: LEDGER_EIP2645_APPLICATION,
        kind: "ledger" as const,
        path: ledgerAccountPath(0),
      },
      publicKeyY: undefined,
    };
    const ledgerStatus = {
      ...status,
      accounts: [ledgerAccount],
      activeAccountId: ledgerAccount.id,
    };
    const { app, deps } = mount({
      submitTransfer: () => pendingSubmit,
    });
    paint(app, sendFlow(ledgerStatus, ledgerAccount, preferences));
    bindTransfer(deps);
    setField(app, "recipient", RECIPIENT);
    setField(app, "amount", "1");

    submit(app);
    await flush();
    submit(app);
    await flush();
    expect(app.querySelector("#send-working-title")?.textContent).toBe("Waiting for your Ledger");

    paint(app, sendFlow(ledgerStatus, ledgerAccount, preferences));
    bindTransfer(deps);
    expect(app.querySelector("#send-working")?.hasAttribute("hidden")).toBe(false);
    expect(app.querySelector("#send-working-title")?.textContent).toBe("Waiting for your Ledger");

    markTransferLedgerAuthorized();
    // The device has answered, so the screen stops pointing at it.
    expect(app.querySelector("#send-working-title")?.textContent).toBe("Sending your transaction…");

    resolveSubmit("0xdeadbeef");
    await flush();
    await flush();
    expect(app.querySelector("#transfer-form")?.getAttribute("data-stage")).toBe("submitted");
    expect(app.querySelector("#send-success-hash")?.textContent).toBe("0xdeadbeef");
  });
});
