/**
 * A private-route execute whose outcome is unknown must never read as "not
 * sent" (audit #173, reviewer correction 3, and the job-channel sibling).
 *
 * The shield runs through the pool route, whose execute rejection is settled
 * by the same submitRejection as a public send. A lost relay reply, or a worker
 * lost after the job may have broadcast, reaches the journey as a
 * SubmissionUnknownError: the receipt says the status is unknown, hides Try
 * again, and nothing is executed twice. A STRK20 stage error lands on the same
 * receipt, and its copy control keeps the stage and category the sentence
 * drops, so the failure can be sent to support.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { account } from "@bramble/testkit/sidepanel";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import { SubmissionUnknownError } from "@bramble/wallet-protocol/submission-unknown";
import { sendFlow } from "../../../../src/sidepanel/app/screens/flows";
import type { PrivacyDisclosureState } from "../../../../src/sidepanel/journeys/privacy/privacy-model";
import { PRIVATE_EXECUTION_UNKNOWN } from "../../../../src/sidepanel/journeys/privacy/privacy-preparation-job";
import type { SendIntent } from "../../../../src/sidepanel/journeys/send/send-model";
import { bindTransfer } from "../../../../src/sidepanel/journeys/send/transfer-ui";
import {
  captureClipboard,
  panelStageError,
  SUBMISSION_STAGE_DETAILS,
} from "../../../support/failure-copy-fixtures";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import {
  flush,
  mountTransferUi as mount,
  paint,
  transferPreferences as preferences,
  transferPublicBalance as publicBalance,
  walletStatus as status,
  submitTransferForm as submit,
} from "../../../support/transfer-ui-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const originalSetTimeout = globalThis.setTimeout;

beforeEach(() => {
  document.body.replaceChildren();
  // Run timers synchronously so the recipient check and confirmation polls
  // settle within the test.
  (globalThis as { setTimeout: unknown }).setTimeout = ((fn: () => void) => {
    fn();
    return 0;
  }) as unknown as typeof setTimeout;
});

afterEach(() => {
  (globalThis as { setTimeout: unknown }).setTimeout = originalSetTimeout;
});

// Discovery reports one entry per tracked token, zeros included, so the
// private STRK the pool fee is charged against is a known figure.
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

// The pool fee is charged in STRK, so the route needs a STRK reading to clear.
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

const typeAmount = (app: HTMLElement, value: string): void => {
  const input = app.querySelector<HTMLInputElement>("#send-amount-input");
  if (!input) throw new Error("amount input missing");
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

const text = (app: HTMLElement, selector: string): string =>
  app.querySelector(selector)?.textContent?.trim() ?? "";

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

const RELAY_UNKNOWN =
  "Transaction submission status is unknown. Check activity and on-chain state before retrying.";

describe("private route outcome unknown", () => {
  for (const [name, message] of [
    ["a lost relay reply", RELAY_UNKNOWN],
    ["a worker lost after the job may have broadcast", PRIVATE_EXECUTION_UNKNOWN],
  ] as const) {
    test(`${name} is status unknown, not "not sent"`, async () => {
      let executions = 0;
      const { app } = open(shieldIntent, {
        async executePrivacyPreparation() {
          executions += 1;
          throw new SubmissionUnknownError(message, null);
        },
      });
      typeAmount(app, "1");
      submit(app);
      await flush();
      submit(app);
      await flush();
      await flush();
      const title = text(app, "#send-failure-title");
      const copy = text(app, "#send-failure-copy");
      expect(`${title} ${copy}`).not.toContain("not sent");
      expect(title).toBe("Status unknown");
      expect(copy).toContain(message);
      expect(app.querySelector("#send-retry")?.hasAttribute("hidden")).toBe(true);
      expect(executions).toBe(1);
    });
  }
});

describe("private route failure copy", () => {
  test("the receipt copies the stage error's (stage/category): detail", async () => {
    const copied = captureClipboard();
    const { app } = open(shieldIntent, {
      async executePrivacyPreparation() {
        throw panelStageError("submission");
      },
    });
    typeAmount(app, "1");
    submit(app);
    await flush();
    submit(app);
    await flush();
    await flush();
    // Not a known pre-submit refusal, so it may be on chain: status unknown,
    // in a sentence without the pipeline's label.
    expect(text(app, "#send-failure-title")).toBe("Status unknown");
    expect(text(app, "#send-failure-copy")).not.toContain("(submission/execution-reverted)");
    app
      .querySelector<HTMLButtonElement>('#send-failure [aria-label="Copy error details"]')
      ?.click();
    await flush();
    expect(copied).toEqual([SUBMISSION_STAGE_DETAILS]);
  });
});
