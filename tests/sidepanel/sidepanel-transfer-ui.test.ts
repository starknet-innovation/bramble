/**
 * Behavioural coverage for the send review/confirm flow (`bindTransfer`) and
 * the activity refresh + CSV export controls (`bindActivity`), driven through
 * the real bindings under happy-dom. The send form is rendered from the real
 * `sendFlow` template; events are dispatched and the injected wallet
 * dependencies (reviewTransfer / submitTransfer / loadStatus / loadActivity)
 * are stubbed to steer each branch. CSV export's URL + setTimeout globals are
 * stubbed so the download path runs synchronously and observably.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { WalletStatus } from "../../src/popup/responses";
import { sendFlow } from "../../src/sidepanel/flows";
import {
  activityExportToast,
  bindActivity,
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

const RECIPIENT = "0x02a3f4b1c5d6e7089a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6071";

beforeAll(registerDom);
afterAll(unregisterDom);

const originalSetTimeout = globalThis.setTimeout;
// Flush queued promise jobs on a real macrotask, independent of the immediate
// setTimeout stub installed for the code under test.
const flush = (): Promise<void> =>
  new Promise((resolve) => originalSetTimeout(resolve as () => void, 0));

// Replaces a container's children from markup without assigning markup as a
// property, matching the shared harness's fragment-based paint.
const paint = (host: HTMLElement, markup: string): void => {
  host.replaceChildren(document.createRange().createContextualFragment(markup));
};

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

type ReviewShape = Awaited<ReturnType<TransferUiDeps["wallet"]["reviewTransfer"]>>;

const feeReview: ReviewShape = {
  fee: { overallFee: "1000", unit: "FRI" },
  feeEstimateFailed: false,
  flags: [],
  requiresDeployment: false,
  summaries: ["Transfer 1 ETH"],
};

type Calls = {
  reviewTransfer: unknown[][];
  submitTransfer: unknown[][];
  loadStatus: number;
  loadActivity: number;
  loadDeploymentStatus: number;
};

const makeWallet = (overrides: Record<string, unknown> = {}) => {
  const calls: Calls = {
    loadActivity: 0,
    loadDeploymentStatus: 0,
    loadStatus: 0,
    reviewTransfer: [],
    submitTransfer: [],
  };
  const wallet = {
    async loadActivity() {
      calls.loadActivity += 1;
      return {
        entries: [
          {
            accountId: account.id,
            hash: "0xdeadbeef",
            kind: "transfer",
            networkId: "SN_MAIN",
            status: "accepted",
            submittedAt: 1,
            summary: "Sent 1 ETH",
          },
        ],
        historyUnavailable: false,
      };
    },
    async loadDeploymentStatus() {
      calls.loadDeploymentStatus += 1;
      return { deployed: true };
    },
    async loadStatus() {
      calls.loadStatus += 1;
      return status;
    },
    async reviewTransfer(...args: unknown[]) {
      calls.reviewTransfer.push(args);
      return feeReview;
    },
    async submitTransfer(...args: unknown[]) {
      calls.submitTransfer.push(args);
      return "0xdeadbeef";
    },
    ...overrides,
  };
  return { calls, wallet };
};

const mount = (
  walletOverrides: Record<string, unknown> = {},
): { app: HTMLElement; calls: Calls; renderCalls: WalletStatus[]; deps: TransferUiDeps } => {
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

beforeEach(() => {
  document.body.replaceChildren();
  // Run timers synchronously so the CSV revoke and the deployment watch resolve
  // observably within the test.
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
    expect(reviewText(app)).toContain("Estimated fee");

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

    submit(app);
    await flush();
    await flush();
    expect(calls.submitTransfer).toHaveLength(1);
    // The first send also triggers the deployment watch.
    expect(calls.loadDeploymentStatus).toBeGreaterThan(0);
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
    const retry = app.querySelector<HTMLButtonElement>("#review-retry-fee");
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

describe("activityExportToast", () => {
  test("chooses tone by history availability", () => {
    expect(activityExportToast(false)).toEqual({ message: "Activity exported", tone: "success" });
    expect(activityExportToast(true).tone).toBe("error");
  });
});

describe("bindActivity", () => {
  let createdUrls: string[];
  let revokedUrls: string[];

  beforeEach(() => {
    createdUrls = [];
    revokedUrls = [];
    (globalThis as { URL: typeof URL }).URL = Object.assign(URL, {
      createObjectURL: (() => {
        const url = `blob:mock-${createdUrls.length}`;
        createdUrls.push(url);
        return url;
      }) as unknown as typeof URL.createObjectURL,
      revokeObjectURL: ((url: string) => {
        revokedUrls.push(url);
      }) as unknown as typeof URL.revokeObjectURL,
    });
  });

  const mountActivity = (walletOverrides: Record<string, unknown> = {}) => {
    document.body.replaceChildren();
    const app = document.createElement("div");
    app.id = "app";
    paint(
      app,
      '<button id="activity-refresh" type="button"></button>' +
        '<button id="activity-export" type="button"></button>',
    );
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
    bindActivity(deps);
    return { app, calls, renderCalls };
  };

  test("refresh reloads status and renders it", async () => {
    const { app, calls, renderCalls } = mountActivity();
    app.querySelector<HTMLButtonElement>("#activity-refresh")?.click();
    await flush();
    expect(calls.loadStatus).toBe(1);
    expect(renderCalls).toHaveLength(1);
  });

  test("refresh failure clears the busy state without rendering", async () => {
    const { app, renderCalls } = mountActivity({
      async loadStatus() {
        throw new Error("offline");
      },
    });
    const button = app.querySelector<HTMLButtonElement>("#activity-refresh");
    button?.click();
    await flush();
    expect(renderCalls).toHaveLength(0);
    expect(button?.hasAttribute("data-busy")).toBe(false);
  });

  test("export downloads a CSV and schedules the object-URL revoke", async () => {
    const { app } = mountActivity();
    app.querySelector<HTMLButtonElement>("#activity-export")?.click();
    await flush();
    expect(createdUrls).toHaveLength(1);
    // setTimeout runs synchronously in the test, so revoke fires immediately.
    expect(revokedUrls).toEqual(createdUrls);
  });

  test("export failure clears the busy state", async () => {
    const { app } = mountActivity({
      async loadActivity() {
        throw new Error("export blew up");
      },
    });
    const button = app.querySelector<HTMLButtonElement>("#activity-export");
    button?.click();
    await flush();
    expect(button?.hasAttribute("data-busy")).toBe(false);
    expect(createdUrls).toHaveLength(0);
  });
});
