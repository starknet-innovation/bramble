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
const mountSwap = (chainStatus: ActivityStatus | null) => {
  const app = document.createElement("div");
  app.id = "app";
  paint(app, swapFlow(status, account));
  document.body.append(app);
  const swap = createSwapClient({
    async sendMessage(message: unknown) {
      const type = isRecord(message) ? message["type"] : null;
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
      return { ok: true, transactionHash: HASH };
    },
  });
  const deps: SwapUiDeps = {
    app,
    balances: () => ({ balances: [balance] }),
    confirmationDelaysMs: [0],
    currency: () => "usd",
    navigateActivity: () => undefined,
    navigateHome: () => undefined,
    preferences: () => preferences,
    render: async () => undefined,
    status: () => status,
    swap,
    wallet: {
      loadActivity: async () => ({
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
      }),
      loadStatus: async () => status,
    } as unknown as SwapUiDeps["wallet"],
  };
  bindSwap(deps);
  return app;
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

const title = (app: Element): string | undefined =>
  app.querySelector("#swap-success-title")?.textContent ?? undefined;
const onReceipt = (app: Element): boolean =>
  app.querySelector("#swap-success")?.hasAttribute("hidden") === false;

describe("swap confirmation", () => {
  test("claims completion only once the chain pre-confirms", async () => {
    const app = mountSwap("preconfirmed");
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
    const app = mountSwap(null);
    await runSwap(app);
    expect(onReceipt(app)).toBe(true);
    expect(title(app)).toBe("Swap submitted");
    expect(app.querySelector("#swap-success-note")?.textContent).toContain("Not confirmed yet");
  });

  test("keeps a reverted swap on the review with the reason", async () => {
    const app = mountSwap("reverted");
    await runSwap(app);
    // No receipt: nothing was swapped, and the review is where a retry starts.
    expect(onReceipt(app)).toBe(false);
    expect(app.querySelector("#swap-result")?.textContent).toContain("reverted");
  });
});
