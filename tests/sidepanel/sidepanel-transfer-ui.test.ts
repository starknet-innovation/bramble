/**
 * Behavioural coverage for the send review/confirm flow (`bindTransfer`),
 * driven through the real bindings under happy-dom. The send form is rendered
 * from the real `sendFlow` template; events are dispatched and the injected
 * wallet dependencies (reviewTransfer / submitTransfer / loadStatus /
 * loadActivity) are stubbed via the shared harness to steer each branch. The
 * activity refresh/export suites live in `sidepanel-activity-ui.test.ts`.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { WalletStatus } from "../../src/popup/responses";
import { sendFlow } from "../../src/sidepanel/flows";
import {
  bindTransfer,
  friendlyReviewError,
  markTransferLedgerAuthorized,
  recipientFieldError,
  type TransferUiDeps,
} from "../../src/sidepanel/transfer-ui";
import { LEDGER_EIP2645_APPLICATION, ledgerAccountPath } from "../../src/starknet/ledger-path";
import type { WalletPreferences } from "../../src/storage/preferences-store";
import { registerDom, unregisterDom } from "../support/groups-harness";
import { account } from "../support/sidepanel-fixtures";
import {
  flush,
  makeWallet,
  paint,
  walletStatus as status,
  type WalletCalls,
} from "../support/transfer-ui-harness";

const RECIPIENT = "0x02a3f4b1c5d6e7089a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6071";

beforeAll(registerDom);
afterAll(unregisterDom);

const originalSetTimeout = globalThis.setTimeout;

const TOKEN_ADDRESS = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

const preferences: WalletPreferences = {
  activeNetworkId: "SN_MAIN",
  addressBook: [],
  schemaVersion: 1,
  tokens: [
    {
      address: TOKEN_ADDRESS,
      decimals: 18,
      id: `SN_MAIN:ETH:${TOKEN_ADDRESS}`,
      name: "Ether",
      networkId: "SN_MAIN",
      symbol: "ETH",
    },
  ],
};

const mount = (
  walletOverrides: Record<string, unknown> = {},
): { app: HTMLElement; calls: WalletCalls; renderCalls: WalletStatus[]; deps: TransferUiDeps } => {
  document.body.replaceChildren();
  const app = document.createElement("div");
  app.id = "app";
  paint(app, sendFlow(status, account, preferences));
  document.body.append(app);
  const { calls, wallet } = makeWallet(walletOverrides);
  const renderCalls: WalletStatus[] = [];
  const deps: TransferUiDeps = {
    app,
    render: async (next: WalletStatus) => {
      renderCalls.push(next);
    },
    wallet: wallet as unknown as TransferUiDeps["wallet"],
  };
  return { app, calls, deps, renderCalls };
};

const submit = (app: HTMLElement): void => {
  const form = app.querySelector<HTMLFormElement>("#transfer-form");
  if (!form) {
    throw new Error("transfer form missing");
  }
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
};

const setField = (app: HTMLElement, name: string, value: string): void => {
  const input = app.querySelector<HTMLInputElement>(`[name="${name}"]`);
  if (!input) {
    throw new Error(`field ${name} missing`);
  }
  input.value = value;
};

const resultText = (app: HTMLElement): string =>
  app.querySelector("#transfer-result")?.textContent ?? "";

const reviewText = (app: HTMLElement): string =>
  app.querySelector("#review-panel")?.textContent ?? "";

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
    expect(
      app.querySelectorAll("#send-review-stage .review-fee, #send-review-stage .review-flag"),
    ).toHaveLength(1);

    submit(app);
    await flush();
    expect(calls.submitTransfer).toHaveLength(1);
    expect(app.querySelector("#send-success")?.hasAttribute("hidden")).toBe(false);
    expect(app.querySelector("#send-success-hash")?.textContent).toBe("0xdeadbeef");
    expect(app.querySelector('[data-send-step="sent"]')?.getAttribute("data-state")).toBe("active");
  });

  test("watches for deployment after confirming a first send", async () => {
    const { app, calls, deps } = mount({
      async reviewTransfer() {
        return {
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
    expect(feeText(app)).toContain("Estimated fee");

    submit(app);
    await flush();
    await flush();
    expect(calls.submitTransfer).toHaveLength(1);
    // The first send also triggers the deployment watch.
    expect(calls.loadDeploymentStatus).toBeGreaterThan(0);
  });

  test("shows the pending-deployment fee wording on the confirm face when no estimate exists", async () => {
    const { app, deps } = mount({
      async reviewTransfer() {
        return {
          fee: null,
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
    // The not-yet-deployed fee wording is visible without opening the
    // disclosure (#190).
    expect(feeText(app)).toContain("estimated once this account is deployed");
    expect(reviewText(app)).not.toContain("estimated once this account is deployed");
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
    expect(app.querySelector("#send-working-title")?.textContent).toBe("Sending to Starknet");
    expect(app.querySelector('[data-send-task="broadcast"]')?.getAttribute("data-state")).toBe(
      "active",
    );

    resolveSubmit("0xdeadbeef");
    await flush();
    await flush();
    expect(app.querySelector("#transfer-form")?.getAttribute("data-stage")).toBe("submitted");
    expect(app.querySelector("#send-success-hash")?.textContent).toBe("0xdeadbeef");
  });
});
