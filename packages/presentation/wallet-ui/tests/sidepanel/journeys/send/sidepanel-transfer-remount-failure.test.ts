/**
 * A review that fails after the Send screen re-rendered.
 *
 * Preparing a private send can take about a minute, and the panel re-renders
 * underneath it (a status refresh repaints the whole flow and binds a fresh
 * form). The failure must land on the form on screen then. It once repainted
 * the form that started the review, already detached, so the live screen
 * stayed on "reviewing" with its button locked and no reason shown.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { account } from "@bramble/testkit/sidepanel";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import { sendFlow } from "../../../../src/sidepanel/app/screens/flows";
import type { PrivacyDisclosureState } from "../../../../src/sidepanel/journeys/privacy/privacy-model";
import type { PrivacyPreparation } from "../../../../src/sidepanel/journeys/privacy/privacy-runtime";
import type { SendIntent } from "../../../../src/sidepanel/journeys/send/send-model";
import {
  bindTransfer,
  type TransferUiDeps,
} from "../../../../src/sidepanel/journeys/send/transfer-ui";
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

const text = (app: HTMLElement, selector: string): string =>
  app.querySelector(selector)?.textContent?.trim() ?? "";

const stage = (app: HTMLElement): string | undefined =>
  app.querySelector<HTMLFormElement>("#transfer-form")?.dataset["stage"];

const reviewLocked = (app: HTMLElement): boolean =>
  app.querySelector("#send-review-button")?.hasAttribute("data-busy") ?? false;

/** Repaints the same app with a fresh Send form and binds it, as a refresh does. */
const rerender = (app: HTMLElement, deps: TransferUiDeps, intent?: SendIntent): void => {
  paint(app, sendFlow(status, account, preferences, [publicBalance], {}, {}, "usd", [], intent));
  bindTransfer(deps);
};

describe("a review that fails after a re-render", () => {
  test("returns the live form to the amount step with the reason", async () => {
    const pending = deferred<unknown>();
    const { app, deps } = mount({ reviewTransfer: () => pending.promise });
    bindTransfer(deps);
    setField(app, "recipient", RECIPIENT);
    setField(app, "amount", "1");
    submit(app);
    expect(stage(app)).toBe("reviewing");

    rerender(app, deps);
    expect(stage(app)).toBe("reviewing");

    pending.reject(new Error("boom"));
    await flush();
    expect(stage(app)).toBe("details");
    expect(text(app, "#transfer-result")).toContain("Couldn't prepare this transfer. Try again.");
    expect(reviewLocked(app)).toBe(false);
  });

  test("returns the live form when a private preparation fails", async () => {
    const pending = deferred<PrivacyPreparation>();
    const mounted = mount({
      async loadPrivacyRecipientStatus() {
        return "registered";
      },
      preparePrivacyDeposit: () => pending.promise,
    });
    const deps: TransferUiDeps = {
      ...mounted.deps,
      privacy: () => registered,
      publicBalances: () => [publicBalance, strkBalance],
      senderAddress: () => account.address,
    };
    rerender(mounted.app, deps, shieldIntent);
    const input = mounted.app.querySelector<HTMLInputElement>("#send-amount-input");
    if (!input) throw new Error("amount input missing");
    input.value = "1";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    submit(mounted.app);
    await flush();
    expect(stage(mounted.app)).toBe("reviewing");

    rerender(mounted.app, deps, shieldIntent);
    expect(stage(mounted.app)).toBe("reviewing");

    pending.reject(new Error("Activate private balances before shielding an asset"));
    await flush();
    expect(stage(mounted.app)).toBe("details");
    expect(text(mounted.app, "#transfer-result")).toBe(
      "Activate private balances before shielding an asset",
    );
    expect(reviewLocked(mounted.app)).toBe(false);
  });
});
