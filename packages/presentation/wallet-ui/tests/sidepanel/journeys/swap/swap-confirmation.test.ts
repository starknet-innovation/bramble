/**
 * A swap receipt states what the chain answered, not what the wallet handed
 * over. A transaction hash is a handoff: the swap can still revert, so the
 * screen may not claim completion until the chain reports the execution.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { isRecord } from "@bramble/core/json";
import type { TokenConfig, WalletPreferences } from "@bramble/settings/preferences";
import { account } from "@bramble/testkit/sidepanel";
import type { ActivityStatus } from "@bramble/transactions/activity";
import { DEFAULT_TOKENS } from "@bramble/wallet-model/networks";
import type { TokenBalance, WalletStatus } from "../../../../src/popup/responses/responses";
import { createSwapClient } from "../../../../src/sidepanel/journeys/swap/swap-client";
import { bindSwap, type SwapUiDeps } from "../../../../src/sidepanel/journeys/swap/swap-ui";
import { swapFlow } from "../../../../src/sidepanel/journeys/swap/swap-views";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import { flush, paint } from "../../../support/transfer-ui-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => document.body.replaceChildren());

const HASH = "0x03eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const PREPARATION_ID = `sha256:${"a".repeat(64)}`;
// Real mainnet ETH/STRK entries: the tradable list drops anything the spam
// heuristics flag, so a made-up address under a known ticker would be dropped.
const tokens: readonly TokenConfig[] = DEFAULT_TOKENS.filter(
  (token) => token.networkId === "SN_MAIN" && (token.symbol === "ETH" || token.symbol === "STRK"),
).map((token) => ({ ...token, id: `SN_MAIN:${token.symbol}:${token.address}` }));
const preferences: WalletPreferences = {
  activeNetworkId: "SN_MAIN",
  addressBook: [],
  schemaVersion: 1,
  tokens,
};
const ETH = tokens.find((token) => token.symbol === "ETH");
if (!ETH) throw new Error("mainnet ETH fixture missing");

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

const balance: TokenBalance = {
  address: ETH.address,
  balance: `${10n ** 18n}`,
  decimals: 18,
  formatted: "1",
  id: ETH.id,
  name: ETH.name,
  networkId: "SN_MAIN",
  symbol: ETH.symbol,
};

/** Mounts the swap screen over the real client with a chain that reports `chainStatus`. */
const mountSwap = (
  chainStatus: ActivityStatus | null,
  beforeRead: () => Promise<void> = async () => undefined,
  execute: () => Promise<unknown> = async () => ({ ok: true, transactionHash: HASH }),
) => {
  const sent: string[] = [];
  const navigated: string[] = [];
  const app = document.createElement("div");
  app.id = "app";
  paint(app, swapFlow(status, account));
  document.body.append(app);
  const swap = createSwapClient({
    async sendMessage(message: unknown) {
      const type = isRecord(message) ? message["type"] : null;
      sent.push(String(type));
      if (type === "wallet.swapQuote") {
        return {
          ok: true,
          swapQuote: {
            buyAmount: "1000",
            buyAmountInUsd: 400,
            gasFeesInUsd: 0.02,
            quoteId: "dae4e180-e2cb-49f4-bd91-6f3de3a0c3ca",
            sellAmount: "1",
            sellAmountInUsd: 400,
          },
        };
      }
      if (type === "wallet.swapPrepare") {
        return {
          ok: true,
          swapPreparation: {
            flags: [],
            id: PREPARATION_ID,
            minBuyAmount: "990",
            payloadDigest: PREPARATION_ID,
            reviewedFee: { overallFee: "1", unit: "FRI" },
            summaries: ["Swap 1 ETH for at least 990 STRK"],
          },
        };
      }
      return execute();
    },
  });
  const deps: SwapUiDeps = {
    app,
    balances: () => ({ balances: [balance] }),
    confirmationDelaysMs: [0],
    currency: () => "usd",
    navigateActivity: () => undefined,
    navigateHome: () => {
      navigated.push("home");
    },
    preferences: () => preferences,
    render: async () => undefined,
    status: () => status,
    swap,
    wallet: {
      loadActivity: async () => {
        await beforeRead();
        return {
          entries:
            chainStatus === null
              ? []
              : [
                  {
                    accountId: account.id,
                    hash: HASH,
                    kind: "swap" as const,
                    networkId: "SN_MAIN" as const,
                    status: chainStatus,
                    submittedAt: 1,
                    summary: "Swap 1 ETH for STRK",
                  },
                ],
          historyUnavailable: false,
        };
      },
      loadStatus: async () => status,
    } as unknown as SwapUiDeps["wallet"],
  };
  bindSwap(deps);
  return { app, deps, navigated, sent };
};

/** Quotes, reviews and confirms, then settles the confirmation wait. */
const runSwap = async (app: Element): Promise<void> => {
  app.querySelector<HTMLButtonElement>("#swap-max")?.click();
  await flush();
  app.querySelector<HTMLButtonElement>("#swap-review")?.click();
  await flush();
  app.querySelector<HTMLButtonElement>("#swap-confirm-button")?.click();
  await flush();
  await flush();
};

const visible = (app: Element, selector: string): boolean =>
  app.querySelector(selector)?.hasAttribute("hidden") === false;

/** Reviews the current quote, then presses the header's Back arrow. */
const reviewAndBack = async (app: Element): Promise<void> => {
  app.querySelector<HTMLButtonElement>("#swap-review")?.click();
  await flush();
  expect(visible(app, "#swap-confirm")).toBe(true);
  document.querySelector<HTMLButtonElement>("#swap-header-back")?.click();
  await flush();
};

const title = (app: Element): string | undefined =>
  app.querySelector("#swap-success-title")?.textContent ?? undefined;
const onReceipt = (app: Element): boolean =>
  app.querySelector("#swap-success")?.hasAttribute("hidden") === false;

describe("swap confirmation", () => {
  test("claims completion only once the chain pre-confirms", async () => {
    const { app } = mountSwap("preconfirmed");
    await runSwap(app);
    expect(onReceipt(app)).toBe(true);
    expect(title(app)).toBe("Swap complete");
    expect(app.querySelector("#swap-success-note")?.hasAttribute("hidden")).toBe(true);
    // The identifier is the same row every other outcome ends on.
    expect(app.querySelector("#swap-success-hash")?.textContent?.length).toBeGreaterThan(0);
  });

  test("says submitted, not complete, when the chain has not answered yet", async () => {
    // Running out of patience is not a failure and not a success: the swap is
    // on its way and the reader is told exactly that.
    const { app } = mountSwap(null);
    await runSwap(app);
    expect(onReceipt(app)).toBe(true);
    expect(title(app)).toBe("Swap submitted");
    expect(app.querySelector("#swap-success-note")?.textContent).toContain("Not confirmed yet");
  });

  // mc-wallet #476: the review's preparation is spent once Confirm ran, so
  // staying on it left a Confirm button that did nothing. A failed swap goes
  // back to edit and re-quotes the same amount, keeping the reason on screen.
  test("returns a reverted swap to edit with a fresh quote and the reason", async () => {
    const { app, sent } = mountSwap("reverted");
    await runSwap(app);
    await flush();
    expect(onReceipt(app)).toBe(false);
    expect(app.querySelector("#swap-edit")?.hasAttribute("hidden")).toBe(false);
    expect(app.querySelector("#swap-confirm")?.hasAttribute("hidden")).toBe(true);
    expect(app.querySelector("#swap-result")?.textContent).toContain("reverted");
    expect(sent.filter((type) => type === "wallet.swapQuote")).toHaveLength(2);
    // The fresh quote can be reviewed again: a new preparation is requested.
    app.querySelector<HTMLButtonElement>("#swap-review")?.click();
    await flush();
    expect(sent.filter((type) => type === "wallet.swapPrepare")).toHaveLength(2);
  });

  // mc-wallet #476: header Back during the confirmation wait used to drop to
  // edit while the old wait kept running and could take over the next swap.
  test("ignores header Back while the submitted swap is confirming", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { app } = mountSwap("preconfirmed", () => held);
    await runSwap(app);
    document.querySelector<HTMLButtonElement>("#swap-header-back")?.click();
    await flush();
    expect(app.querySelector("#swap-confirm")?.hasAttribute("hidden")).toBe(false);
    release();
    await flush();
    await flush();
    expect(onReceipt(app)).toBe(true);
    expect(title(app)).toBe("Swap complete");
  });

  test("ignores header Back while execute() is still in flight", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { app, navigated } = mountSwap("preconfirmed", undefined, async () => {
      await held;
      return { ok: true, transactionHash: HASH };
    });
    await runSwap(app);
    document.querySelector<HTMLButtonElement>("#swap-header-back")?.click();
    await flush();
    expect(navigated).toEqual([]);
    expect(visible(app, "#swap-confirm")).toBe(true);
    release();
    await flush();
    await flush();
    expect(onReceipt(app)).toBe(true);
  });

  // The submitting hold must end with the swap, or header Back stays dead on
  // the next review.
  test("header Back steps off the next review after a refused execute", async () => {
    const { app, navigated, sent } = mountSwap("preconfirmed", undefined, async () => ({
      error: "swap preparation changed",
    }));
    await runSwap(app);
    expect(visible(app, "#swap-edit")).toBe(true);
    await reviewAndBack(app);
    expect(visible(app, "#swap-edit")).toBe(true);
    expect(visible(app, "#swap-confirm")).toBe(false);
    expect(navigated).toEqual([]);
    expect(sent.filter((type) => type === "wallet.swapQuote")).toHaveLength(3);
  });

  test("header Back works on a fresh visit after leaving mid-confirmation", async () => {
    const never = new Promise<void>(() => undefined);
    const { app, deps } = mountSwap("preconfirmed", () => never);
    await runSwap(app);
    expect(visible(app, "#swap-confirm")).toBe(true);
    // Leaving the screen unmounts it; the abandoned wait never settles.
    app.remove();
    bindSwap({ ...deps, app: document.createElement("div") });
    const next = mountSwap("preconfirmed");
    next.app.querySelector<HTMLButtonElement>("#swap-max")?.click();
    await flush();
    await reviewAndBack(next.app);
    expect(visible(next.app, "#swap-edit")).toBe(true);
    expect(next.navigated).toEqual([]);
  });
});

// Audit #173, swap sibling: a lost reply may already be on chain, so the swap
// is never re-quoted into a second swap of the same amount.
describe("swap with a lost reply", () => {
  const unknown = (transactionHash?: string) => async () => ({
    error:
      "Transaction submission status is unknown. Check activity and on-chain state before retrying.",
    submissionUnknown: true,
    ...(transactionHash ? { transactionHash } : {}),
  });

  test("follows the signed hash to the chain's answer", async () => {
    const { app, sent } = mountSwap("preconfirmed", undefined, unknown(HASH));
    await runSwap(app);
    expect(onReceipt(app)).toBe(true);
    expect(title(app)).toBe("Swap complete");
    expect(sent.filter((type) => type === "wallet.swapQuote")).toHaveLength(1);
  });

  test("says status unknown without a hash and offers Activity, not a re-quote", async () => {
    const { app, sent } = mountSwap(null, undefined, unknown());
    await runSwap(app);
    await flush();
    expect(onReceipt(app)).toBe(true);
    expect(title(app)).toBe("Status unknown");
    expect(app.querySelector("#swap-success-note")?.textContent).toContain("status is unknown");
    expect(visible(app, "#swap-edit")).toBe(false);
    expect(visible(app, "#swap-confirm")).toBe(false);
    expect(visible(app, "#swap-view-activity")).toBe(true);
    expect(app.querySelector("#swap-success .send-receipt-tx")?.hasAttribute("hidden")).toBe(true);
    expect(app.querySelector("#swap-success .send-outcome-mark")?.hasAttribute("hidden")).toBe(
      true,
    );
    expect(sent.filter((type) => type === "wallet.swapQuote")).toHaveLength(1);
    expect(sent.filter((type) => type === "wallet.swapPrepare")).toHaveLength(1);
  });
});

// Errors audit F2: only a refusal made before signing re-quotes. Anything else
// may be on chain, so the screen says so and never arms a second swap.
describe("swap rejections that are not a refusal before signing", () => {
  const UNKNOWN = "The swap may not have gone through. Check Activity before trying again.";
  const cases: readonly (readonly [string, unknown, string])[] = [
    ["an unrecognised reply", { ok: true }, UNKNOWN],
    ["the client's fallback", { error: "swap failed" }, UNKNOWN],
    ["the router's catch-all", { error: "wallet request failed" }, UNKNOWN],
    [
      "a bookkeeping failure that surfaced as a plain error",
      { error: "vault storage limit reached" },
      `This wallet is full, so this change wasn't saved. ${UNKNOWN}`,
    ],
  ];
  for (const [name, reply, note] of cases) {
    test(name, async () => {
      const { app, sent } = mountSwap(null, undefined, async () => reply);
      await runSwap(app);
      await flush();
      expect(onReceipt(app)).toBe(true);
      expect(title(app)).toBe("Status unknown");
      expect(app.querySelector("#swap-success-note")?.textContent).toBe(note);
      expect(visible(app, "#swap-view-activity")).toBe(true);
      expect(visible(app, "#swap-edit")).toBe(false);
      expect(app.querySelector("#swap-result")?.textContent ?? "").toBe("");
      // No fresh quote, so no second swap of the same amount is armed.
      expect(sent.filter((type) => type === "wallet.swapQuote")).toHaveLength(1);
      expect(sent.filter((type) => type === "wallet.swapPrepare")).toHaveLength(1);
    });
  }

  test("a refusal before signing still returns to edit with a fresh quote", async () => {
    const { app, sent } = mountSwap("preconfirmed", undefined, async () => ({
      error: "swap preparation not found",
    }));
    await runSwap(app);
    expect(visible(app, "#swap-edit")).toBe(true);
    expect(onReceipt(app)).toBe(false);
    expect(sent.filter((type) => type === "wallet.swapQuote")).toHaveLength(2);
  });
});
