/**
 * Send opened from a Shield or Unshield shortcut keeps that operation's name.
 *
 * The machinery is Send's — a source bucket, a destination bucket, a
 * recipient — but a self-transfer between the account's two balances is not a
 * payment, and a screen that led with "Send" for it read as the wrong flow.
 * These drive the real bindings under happy-dom from a shortcut intent and pin
 * the header, the actions, the receipt, and the asset picker's behaviour inside
 * that mode.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { account } from "@bramble/testkit/sidepanel";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import { sendFlow } from "../../../../src/sidepanel/app/screens/flows";
import type { PrivacyDisclosureState } from "../../../../src/sidepanel/journeys/privacy/privacy-model";
import type { SendIntent } from "../../../../src/sidepanel/journeys/send/send-model";
import { bindTransfer } from "../../../../src/sidepanel/journeys/send/transfer-ui";
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

const unshieldIntent: SendIntent = { ...shieldIntent, destination: "public", source: "private" };

const click = (root: ParentNode, selector: string): void => {
  root.querySelector<HTMLElement>(selector)?.dispatchEvent(new Event("click", { bubbles: true }));
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

describe("the first paint", () => {
  test("already speaks in the shortcut's words before any binding runs", () => {
    // The template and the binding derive the mode the same way, so there is
    // no frame in which a shield is titled "Send".
    const shield = sendFlow(status, account, preferences, [], {}, {}, "usd", [], shieldIntent);
    expect(shield).toContain('<h1 id="send-header-title">Shield</h1>');
    expect(shield).toContain("Review shield");
    expect(shield).toContain("Confirm and shield");
    expect(shield).toContain("Shield complete");
    expect(shield).not.toContain('<h1 id="send-header-title">Send to</h1>');

    const plain = sendFlow(status, account, preferences);
    expect(plain).toContain('<h1 id="send-header-title">Send to</h1>');
    expect(plain).toContain("Review send");
    expect(plain).toContain("Confirm and send");
  });

  test("a shortcut for a different account paints as a plain send", () => {
    const foreign = sendFlow(status, account, preferences, [], {}, {}, "usd", [], {
      ...shieldIntent,
      accountId: "SN_MAIN:0xother",
    });
    expect(foreign).toContain('<h1 id="send-header-title">Send to</h1>');
  });
});

describe("a shield shortcut", () => {
  test("opens on the amount step under its own name, not Send's", () => {
    const { app } = open(shieldIntent);

    expect(app.querySelector("#transfer-form")?.getAttribute("data-stage")).toBe("details");
    expect(text(app, "#send-header-title")).toBe("Shield");
    expect(text(app, "#send-review-button")).toBe("Review shield");
    expect(app.querySelector("#send-close")?.getAttribute("aria-label")).toBe("Close Shield");
    expect(app.querySelector("#send-amount-input")?.getAttribute("aria-label")).toBe(
      "Amount to shield",
    );
  });

  test("reviews, confirms, and receipts as a shield", async () => {
    const { app, calls } = open(shieldIntent);
    typeAmount(app, "1");

    submit(app);
    await flush();
    expect(app.querySelector("#transfer-form")?.getAttribute("data-stage")).toBe("review");
    expect(text(app, "#send-header-title")).toBe("Review shield");
    expect(text(app, "#send-review-heading")).toBe("Review shield");
    expect(text(app, "#send-confirm-label")).toBe("Confirm and shield");
    // The account on both ends is the user's own, so the summary names the
    // movement rather than a "recipient".
    const summary = text(app, "#send-review-summary");
    expect(summary).toContain("Account");
    expect(summary).toContain("Public balance → Private balance");
    expect(summary).not.toContain("Recipient");
    // The deposit is prepared with the composed recipient, never substituted;
    // the fourth argument is the progress sink the working screen listens on.
    expect(calls.preparePrivacyDeposit).toEqual([
      [publicBalance.id, "1", account.address, expect.any(Function)],
    ]);

    submit(app);
    await flush();
    await flush();
    expect(text(app, "#send-success-title")).toBe("Shield complete");
    expect(text(app, "#send-success-summary")).toBe("1 ETH shielded into your private balance");
  });

  test("the asset dropdown still works inside the shortcut", () => {
    // Reported as "clicking an asset does nothing": the dropdown opens in place,
    // an option applies that asset, and the shortcut's mode is kept throughout.
    const { app } = open(shieldIntent);

    click(app, "#send-token-trigger");
    // The pick happens on the amount step now: no stage change, no new screen.
    expect(app.querySelector("#transfer-form")?.getAttribute("data-stage")).toBe("details");
    expect(app.querySelector("#send-token-options")?.hasAttribute("hidden")).toBe(false);
    expect(text(app, "#send-header-title")).toBe("Shield");

    click(app, "[data-token-option]");
    expect(app.querySelector("#transfer-form")?.getAttribute("data-stage")).toBe("details");
    expect(text(app, "#send-selected-token-symbol")).toBe("ETH");
    expect(text(app, "#send-header-title")).toBe("Shield");
    expect(app.querySelector<HTMLInputElement>('[name="destination"]')?.value).toBe("private");
  });

  test("reads as a plain send once the destination is flipped back to public", () => {
    const { app } = open(shieldIntent);

    click(app, '[data-send-bucket="destination"]');

    // Same account, same bucket on both ends: nothing is being shielded.
    expect(text(app, "#send-header-title")).toBe("Send");
    expect(text(app, "#send-review-button")).toBe("Review send");
  });

  test("fails a shield closed when its fee could not be estimated", async () => {
    let executions = 0;
    const deposits: unknown[][] = [];
    const { app } = open(shieldIntent, {
      async executePrivacyPreparation() {
        executions += 1;
        return "0xfeed";
      },
      async preparePrivacyDeposit(...args: unknown[]) {
        deposits.push(args);
        return {
          id: `sha256:${"c".repeat(64)}`,
          kind: "deposit",
          payloadDigest: `sha256:${"c".repeat(64)}`,
          poolAddress: "0xabc",
          route: "public-account",
          summaries: ["Shield 1 ETH"],
          symbol: "ETH",
          tokenId: publicBalance.id,
        };
      },
    });
    typeAmount(app, "1");
    submit(app);
    await flush();
    expect(app.querySelector<HTMLButtonElement>("#send-confirm-button")?.disabled).toBe(true);

    // The fee retry re-prepares; it never executes a preparation whose cost
    // the user has not been able to read.
    app.querySelector<HTMLButtonElement>("#review-retry-fee")?.click();
    await flush();
    expect(executions).toBe(0);
    expect(deposits).toHaveLength(2);
  });
});

describe("an unshield shortcut", () => {
  test("opens under its own name with the private balance measured", () => {
    const { app } = open(unshieldIntent);

    expect(text(app, "#send-header-title")).toBe("Unshield");
    expect(text(app, "#send-review-button")).toBe("Review unshield");
    expect(text(app, "#send-balance-label")).toBe("Private balance 20 ETH");
  });

  test("keeps measuring against the private balance after an asset pick", () => {
    // The picker row only knows the public figure. Before this, choosing an
    // asset wrote that figure into the card as the "private balance".
    const { app } = open(unshieldIntent);

    click(app, "#send-token-trigger");
    click(app, "[data-send-asset]");

    expect(text(app, "#send-balance-label")).toBe("Private balance 20 ETH");
    expect(app.querySelector<HTMLInputElement>('[name="tokenBalance"]')?.value).toBe(
      "20000000000000000000",
    );
    click(app, "#send-max");
    expect(app.querySelector<HTMLInputElement>("#send-amount-input")?.value).toBe("20");
  });

  test("receipts as an unshield", async () => {
    const { app, calls } = open(unshieldIntent);
    typeAmount(app, "1");

    submit(app);
    await flush();
    expect(text(app, "#send-confirm-label")).toBe("Confirm and unshield");
    expect(calls.preparePrivacyWithdraw).toEqual([[publicBalance.id, account.address, "1"]]);

    submit(app);
    await flush();
    await flush();
    expect(text(app, "#send-success-title")).toBe("Unshield complete");
    expect(text(app, "#send-success-summary")).toBe("1 ETH unshielded into your public balance");
  });
});
