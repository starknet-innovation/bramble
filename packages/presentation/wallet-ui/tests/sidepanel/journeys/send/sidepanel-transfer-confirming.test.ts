/**
 * The confirm leg of a pool route in the Send flow: a shield signs the proof
 * built at review and the working screen ticks its steps as the execute job
 * hands the transaction on; an unshield quotes at review and proves at confirm.
 * Shares its harness with sidepanel-transfer-preparing.test.ts.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { account } from "@bramble/testkit/sidepanel";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import { sendFlow } from "../../../../src/sidepanel/app/screens/flows";
import type { PrivacyDisclosureState } from "../../../../src/sidepanel/journeys/privacy/privacy-model";
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

const unshieldIntent: SendIntent = { ...shieldIntent, destination: "public", source: "private" };

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

// The amount step's controls, every one of which must be inert while a
// preparation the user started from them is running.

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

describe("Confirm and shield", () => {
  test("says the proof is already built and only signing remains", async () => {
    const pending = deferred<string>();
    const { app } = open(shieldIntent, { executePrivacyPreparation: () => pending.promise });
    typeAmount(app, "1");
    submit(app);
    await flush();
    expect(stage(app)).toBe("review");

    submit(app);
    expect(stage(app)).toBe("authorizing");
    expect(hidden(app, "#send-working")).toBe(false);
    expect(text(app, "#send-working-title")).toBe("Shielding your transaction…");

    pending.resolve("0xfeed");
    await flush();
    await flush();
    expect(text(app, "#send-success-title")).toBe("Shield complete");
  });

  test("ticks the signing step off and lights broadcast as the job hands the transaction on", async () => {
    const pending = deferred<string>();
    let report: ((progress: { elapsedMs: number; phase?: string }) => void) | undefined;
    const { app } = open(shieldIntent, {
      executePrivacyPreparation: (_id: string, onProgress?: typeof report) => {
        report = onProgress;
        return pending.promise;
      },
    });
    typeAmount(app, "1");
    submit(app);
    await flush();
    submit(app);

    // Signing still in progress: the list holds.
    report?.({ elapsedMs: 800, phase: "signing" });
    expect(text(app, "#send-working-title")).toBe("Shielding your transaction…");

    // The job hands the signed transaction on: signing is done, broadcast lights.
    report?.({ elapsedMs: 2_400, phase: "broadcasting" });
    expect(text(app, "#send-working-title")).toBe("Shielding your transaction…");

    pending.resolve("0xfeed");
    await flush();
    await flush();
    expect(text(app, "#send-success-title")).toBe("Shield complete");
  });
});

describe("Review unshield", () => {
  test("shows the relay quote step, then names proving on confirm", async () => {
    const prepare = deferred<PrivacyPreparation>();
    const execute = deferred<string>();
    const { app } = open(unshieldIntent, {
      executePrivacyPreparation: () => execute.promise,
      preparePrivacyWithdraw: () => prepare.promise,
    });
    typeAmount(app, "1");

    submit(app);
    expect(stage(app)).toBe("reviewing");
    expect(hidden(app, "#send-working")).toBe(false);
    expect(text(app, "#send-working-title")).toBe("Preparing private transfer…");
    expect(text(app, "#send-working-copy")).toBe("");
    expect(text(app, "#send-review-label")).toBe("Preparing unshield…");

    prepare.resolve({
      amount: "1",
      id: preparation.id,
      kind: "withdraw",
      payloadDigest: preparation.payloadDigest,
      poolAddress: preparation.poolAddress,
      recipient: account.address,
      relayFee: { amount: "0x10", recipient: "0x2", token: STRK_TOKEN_ADDRESS },
      route: "private-relay",
      summaries: ["Unshield 1 ETH"],
      symbol: "ETH",
      tokenId: publicBalance.id,
    });
    await flush();
    expect(stage(app)).toBe("review");

    // The relay route proves at confirm: that wait is the long one, and it says so.
    submit(app);
    expect(stage(app)).toBe("authorizing");
    expect(text(app, "#send-working-title")).toBe("Proving privately");
    // Proving is the one software wait long enough to look stuck, so it says so.
    expect(text(app, "#send-working-copy")).toContain("Proving may take longer");

    execute.resolve("0xfeed");
    await flush();
    await flush();
    expect(text(app, "#send-success-title")).toBe("Unshield complete");
  });
});
