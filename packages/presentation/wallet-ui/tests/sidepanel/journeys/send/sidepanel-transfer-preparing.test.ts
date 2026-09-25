/**
 * What the Send screen shows between a Review click and the review itself.
 *
 * Reported from the shield shortcut: "Review shield" ran a proof in the
 * background for the better part of a minute and the screen did nothing — the
 * button dimmed, the amount step stayed editable, and nothing said work was
 * happening. These drive the real bindings under happy-dom with the wallet stub
 * held mid-flight and pin, at each moment of a shield, an unshield, and a
 * public send: the synchronous acknowledgement, the locked controls, the
 * working screen's step and guidance, the review once the preparation lands,
 * and the restored amount step when it fails or is backed out of.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { account } from "@bramble/testkit/sidepanel";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import { sendFlow } from "../../../../src/sidepanel/app/screens/flows";
import type { PrivacyDisclosureState } from "../../../../src/sidepanel/journeys/privacy/privacy-model";
import { PREPARATION_CHANNEL_LOST } from "../../../../src/sidepanel/journeys/privacy/privacy-preparation-job";
import type { PrivacyPreparation } from "../../../../src/sidepanel/journeys/privacy/privacy-runtime";
import type { SendIntent } from "../../../../src/sidepanel/journeys/send/send-model";
import { bindTransfer } from "../../../../src/sidepanel/journeys/send/transfer-ui";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import {
  deferred,
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

beforeEach(() => {
  document.body.replaceChildren();
  (globalThis as { setTimeout: unknown }).setTimeout = ((fn: () => void) => {
    fn();
    return 0;
  }) as unknown as typeof setTimeout;
});

afterEach(() => {
  (globalThis as { setTimeout: unknown }).setTimeout = originalSetTimeout;
});

const registered: PrivacyDisclosureState = {
  error: null,
  loading: false,
  value: {
    accountId: account.id,
    balances: [
      {
        balance: "20000000000000000000",
        formatted: "20",
        symbol: "ETH",
        token: publicBalance.address,
        tokenId: publicBalance.id,
      },
      {
        balance: "5000",
        formatted: "0.000000000000005",
        symbol: "STRK",
        token: STRK_TOKEN_ADDRESS,
        tokenId: `SN_MAIN:STRK:${STRK_TOKEN_ADDRESS}`,
      },
    ],
    networkId: "SN_MAIN",
    poolFeeFri: "1000",
    relayConfigured: true,
    registration: "registered",
  },
};

const strkBalance = {
  address: STRK_TOKEN_ADDRESS,
  balance: "50000000000000000000",
  decimals: 18,
  formatted: "50",
  id: `SN_MAIN:STRK:${STRK_TOKEN_ADDRESS}`,
  name: "Starknet Token",
  networkId: "SN_MAIN" as const,
  symbol: "STRK",
};

const shieldIntent: SendIntent = {
  accountId: account.id,
  destination: "private",
  networkId: status.networkId,
  recipient: account.address,
  recipientLabel: "Account 1",
  source: "public",
  tokenId: publicBalance.id,
};

const preparation: PrivacyPreparation = {
  amount: "1",
  id: `sha256:${"b".repeat(64)}`,
  kind: "deposit",
  networkFee: { overallFee: "2000", unit: "FRI" },
  payloadDigest: `sha256:${"b".repeat(64)}`,
  poolAddress: "0x0000000000000000000000000000000000000000000000000000000000000abc",
  poolFeeFri: "1000",
  recipient: account.address,
  route: "public-account",
  summaries: ["Shield 1 ETH"],
  symbol: "ETH",
  tokenId: publicBalance.id,
};

const text = (app: HTMLElement, selector: string): string =>
  app.querySelector(selector)?.textContent?.trim() ?? "";

const stage = (app: HTMLElement): string | undefined =>
  app.querySelector<HTMLFormElement>("#transfer-form")?.dataset["stage"];

const hidden = (app: HTMLElement, selector: string): boolean =>
  app.querySelector(selector)?.hasAttribute("hidden") ?? true;

const disabled = (app: HTMLElement, selector: string): boolean =>
  app.querySelector<HTMLButtonElement | HTMLInputElement>(selector)?.disabled ?? false;

const stepState = (app: HTMLElement, step: string): string | undefined =>
  app.querySelector<HTMLElement>(`[data-send-step="${step}"]`)?.dataset["state"];

// The amount step's controls, every one of which must be inert while a
// preparation the user started from them is running.
const COMPOSE_CONTROLS = [
  "#send-amount-input",
  '[data-send-bucket="source"]',
  '[data-send-bucket="destination"]',
  "#send-token-trigger",
  "#send-half",
  "#send-max",
  "#send-unit-toggle",
];

const typeAmount = (app: HTMLElement, value: string): void => {
  const input = app.querySelector<HTMLInputElement>("#send-amount-input");
  if (!input) throw new Error("amount input missing");
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

const open = (intent: SendIntent, walletOverrides: Record<string, unknown> = {}) => {
  const mounted = mount({
    async executePrivacyPreparation() {
      return "0xfeed";
    },
    async loadPrivacyRecipientStatus() {
      return "registered";
    },
    ...walletOverrides,
  });
  paint(
    mounted.app,
    sendFlow(status, account, preferences, [publicBalance], {}, {}, "usd", [], intent),
  );
  bindTransfer({
    ...mounted.deps,
    privacy: () => registered,
    publicBalances: () => [publicBalance, strkBalance],
    senderAddress: () => account.address,
  });
  return mounted;
};

describe("Review shield", () => {
  test("is acknowledged in the same tick, with the proof step and its guidance", () => {
    const pending = deferred<PrivacyPreparation>();
    const { app } = open(shieldIntent, { preparePrivacyDeposit: () => pending.promise });
    typeAmount(app, "1");

    // Before any promise settles: the click has already changed the screen.
    submit(app);
    expect(stage(app)).toBe("reviewing");
    expect(hidden(app, "#send-working")).toBe(false);
    expect(hidden(app, "#send-details")).toBe(true);
    expect(hidden(app, "#send-review-stage")).toBe(true);
    expect(app.querySelector("#transfer-form")?.hasAttribute("aria-busy")).toBe(true);
    expect(text(app, "#send-working-title")).toBe("Preparing private transfer…");
    // The preparing screen says only what is running.
    expect(text(app, "#send-working-copy")).toBe("");
    expect(hidden(app, "#send-working-copy")).toBe(true);
    // The step rail has moved off Amount: the review is what is in progress.
    expect(stepState(app, "details")).toBe("done");
    expect(stepState(app, "review")).toBe("active");
    // The button behind the hidden step is busy and says so, not just dimmed.
    const button = app.querySelector<HTMLButtonElement>("#send-review-button");
    expect(button?.hasAttribute("data-busy")).toBe(true);
    expect(button?.disabled).toBe(true);
    expect(text(app, "#send-review-label")).toBe("Preparing shield…");
    expect(button?.querySelector(".liquid-dots-compact")).not.toBeNull();
    for (const selector of COMPOSE_CONTROLS) {
      expect(disabled(app, selector)).toBe(true);
    }
  });

  test("paints the review and unlocks the amount step when the proof lands", async () => {
    const pending = deferred<PrivacyPreparation>();
    const { app } = open(shieldIntent, { preparePrivacyDeposit: () => pending.promise });
    typeAmount(app, "1");
    submit(app);
    await flush();
    expect(stage(app)).toBe("reviewing");

    pending.resolve(preparation);
    await flush();
    expect(stage(app)).toBe("review");
    expect(hidden(app, "#send-working")).toBe(true);
    expect(hidden(app, "#send-review-stage")).toBe(false);
    expect(app.querySelector("#transfer-form")?.hasAttribute("aria-busy")).toBe(false);
    expect(text(app, "#send-review-label")).toBe("Review shield");
    expect(app.querySelector("#send-review-button")?.hasAttribute("data-busy")).toBe(false);
    for (const selector of COMPOSE_CONTROLS) {
      expect(disabled(app, selector)).toBe(false);
    }
  });

  test("restores the amount step with the reason when the preparation fails", async () => {
    const pending = deferred<PrivacyPreparation>();
    const { app } = open(shieldIntent, { preparePrivacyDeposit: () => pending.promise });
    typeAmount(app, "1");
    submit(app);
    await flush();

    pending.reject(new Error("Activate private balances before shielding an asset"));
    await flush();
    expect(stage(app)).toBe("details");
    expect(hidden(app, "#send-working")).toBe(true);
    expect(hidden(app, "#send-details")).toBe(false);
    expect(text(app, "#transfer-result")).toBe(
      "Activate private balances before shielding an asset",
    );
    expect(text(app, "#send-review-label")).toBe("Review shield");
    expect(app.querySelector("#send-review-button")?.hasAttribute("data-busy")).toBe(false);
    expect(disabled(app, "#send-review-button")).toBe(false);
    for (const selector of COMPOSE_CONTROLS) {
      expect(disabled(app, selector)).toBe(false);
    }
    expect(stepState(app, "details")).toBe("active");
  });

  test("survives the screen's own churn while the proof is being built", async () => {
    // Everything the live screen does during the wait, fired on purpose: the
    // recipient registration check settling (a repaint), the bucket gate re-running
    // on input and click, and a status refresh through the render dependency.
    // None of it may discard the review when the proof lands.
    const pending = deferred<PrivacyPreparation>();
    const recipientCheck = deferred<"registered" | "unregistered">();
    const { app, deps } = open(shieldIntent, {
      loadPrivacyRecipientStatus: () => recipientCheck.promise,
      preparePrivacyDeposit: () => pending.promise,
    });
    typeAmount(app, "1");
    submit(app);
    await flush();
    expect(stage(app)).toBe("reviewing");

    recipientCheck.resolve("registered");
    await flush();
    app.querySelector("#transfer-form")?.dispatchEvent(new Event("input", { bubbles: true }));
    app.querySelector("#transfer-form")?.dispatchEvent(new Event("click", { bubbles: true }));
    await deps.render(status);
    await flush();
    expect(stage(app)).toBe("reviewing");
    expect(hidden(app, "#send-working")).toBe(false);

    pending.resolve(preparation);
    await flush();
    expect(stage(app)).toBe("review");
    expect(hidden(app, "#send-review-stage")).toBe(false);
    expect(hidden(app, "#send-working")).toBe(true);
  });

  test("shows the reason when the background worker stops mid-proof", async () => {
    // The failure behind the report: the runtime channel closed under the
    // proof. The client now names it; the screen must leave the working state
    // and say why, never sit on "Build private proof". Real timers here, so the
    // toast is still on screen when it is read.
    (globalThis as { setTimeout: unknown }).setTimeout = originalSetTimeout;
    const pending = deferred<PrivacyPreparation>();
    const { app } = open(shieldIntent, { preparePrivacyDeposit: () => pending.promise });
    typeAmount(app, "1");
    submit(app);
    await flush();
    expect(stage(app)).toBe("reviewing");

    pending.reject(new Error(PREPARATION_CHANNEL_LOST));
    await flush();
    expect(stage(app)).toBe("details");
    expect(hidden(app, "#send-working")).toBe(true);
    expect(hidden(app, "#send-details")).toBe(false);
    expect(text(app, "#transfer-result")).toBe(PREPARATION_CHANNEL_LOST);
    expect(app.ownerDocument.querySelector(".toast.error .toast-text")?.textContent ?? "").toBe(
      PREPARATION_CHANNEL_LOST,
    );
    expect(disabled(app, "#send-review-button")).toBe(false);
    for (const selector of COMPOSE_CONTROLS) {
      expect(disabled(app, selector)).toBe(false);
    }
  });

  test("keeps a control the template disabled for its own reason disabled", async () => {
    const pending = deferred<PrivacyPreparation>();
    const { app } = open(shieldIntent, { preparePrivacyDeposit: () => pending.promise });
    const trigger = app.querySelector<HTMLButtonElement>("#send-token-trigger");
    if (!trigger) throw new Error("token trigger missing");
    trigger.disabled = true;
    typeAmount(app, "1");
    submit(app);
    await flush();
    pending.resolve(preparation);
    await flush();
    expect(trigger.disabled).toBe(true);
  });

  test("can be backed out of, and the abandoned proof never becomes a review", async () => {
    const pending = deferred<PrivacyPreparation>();
    const { app } = open(shieldIntent, { preparePrivacyDeposit: () => pending.promise });
    typeAmount(app, "1");
    submit(app);
    await flush();
    expect(stage(app)).toBe("reviewing");

    app.ownerDocument.querySelector("#send-header-back")?.dispatchEvent(new Event("click"));
    expect(stage(app)).toBe("details");
    expect(hidden(app, "#send-working")).toBe(true);
    expect(hidden(app, "#send-details")).toBe(false);
    for (const selector of COMPOSE_CONTROLS) {
      expect(disabled(app, selector)).toBe(false);
    }

    // The background finishes what it started; the panel has moved on.
    pending.resolve(preparation);
    await flush();
    expect(stage(app)).toBe("details");
    expect(hidden(app, "#send-review-stage")).toBe(true);
    expect(text(app, "#send-review-label")).toBe("Review shield");
  });

  test("cannot be submitted twice while the first preparation runs", async () => {
    let prepared = 0;
    const pending = deferred<PrivacyPreparation>();
    const { app } = open(shieldIntent, {
      preparePrivacyDeposit: () => {
        prepared += 1;
        return pending.promise;
      },
    });
    typeAmount(app, "1");
    submit(app);
    await flush();
    // The button and the step are disabled, so a second submit can only arrive
    // programmatically; the handler itself must still not start a second proof.
    submit(app);
    await flush();
    expect(prepared).toBe(1);
    expect(stage(app)).toBe("reviewing");

    // The first result is still the one that lands.
    pending.resolve(preparation);
    await flush();
    expect(stage(app)).toBe("review");
  });
});

describe("Review send on the public route", () => {
  test("keeps the amount step in view but busy and locked until the estimate lands", async () => {
    const pending = deferred<unknown>();
    const { app, deps } = mount({ reviewTransfer: () => pending.promise });
    bindTransfer(deps);
    setField(app, "recipient", RECIPIENT);
    setField(app, "amount", "1");

    submit(app);
    // A fee estimate is short, so no working screen: the step stays, the
    // button says what it is doing, and nothing on the step can be edited.
    expect(stage(app)).toBe("reviewing");
    expect(hidden(app, "#send-details")).toBe(false);
    expect(hidden(app, "#send-working")).toBe(true);
    expect(text(app, "#send-review-label")).toBe("Preparing send…");
    expect(app.querySelector("#send-review-button")?.hasAttribute("data-busy")).toBe(true);
    expect(stepState(app, "review")).toBe("active");
    for (const selector of COMPOSE_CONTROLS) {
      expect(disabled(app, selector)).toBe(true);
    }

    pending.resolve({
      fee: { overallFee: "1000", unit: "FRI" },
      feeEstimateFailed: false,
      flags: [],
      requiresDeployment: false,
      summaries: ["Transfer"],
    });
    await flush();
    expect(stage(app)).toBe("review");
    expect(text(app, "#send-review-label")).toBe("Review send");
    for (const selector of COMPOSE_CONTROLS) {
      expect(disabled(app, selector)).toBe(false);
    }
  });
});
