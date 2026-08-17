import { bindSwap, createSidepanelRuntime, createSwapClient } from "@mc-wallet/wallet-ui/lab";
import { statusFor } from "../fixtures/fixtures";
import {
  ETH_TOKEN,
  journeyBalances,
  journeyPreferences,
  STRK_TOKEN,
} from "../fixtures/journey-fixtures";
import { walletDashboard } from "../runtime/scenario-dashboard";
import { messageType, nextTurn } from "../runtime/scenario-runtime";
import type { FrameContext, WalletScenario } from "../runtime/types";

const PREPARATION_ID = `sha256:${"d".repeat(64)}`;
const SWAP_HASH = `0x03${"e".repeat(62)}`;

type SwapMode =
  | "edit"
  | "execute-failed"
  | "high-risk"
  | "loading"
  | "picker"
  | "quote"
  | "quote-failed"
  | "review"
  | "submitted";

const quoteResponse = (highRisk: boolean) => ({
  ok: true,
  swapQuote: {
    buyAmount: highRisk ? "14285" : "19357",
    buyAmountInUsd: highRisk ? 3_300 : 4_471.56,
    gasFeesInUsd: 0.08,
    quoteId: highRisk ? "fixture-high-risk" : "fixture-best-route",
    sellAmount: "1.25",
    sellAmountInUsd: 4_480.53,
  },
});

const prepareSwap =
  (mode: SwapMode) =>
  async (context: FrameContext): Promise<void> => {
    const unresolved = new Promise<never>(() => undefined);
    const runtime = {
      sendMessage: async (message: unknown): Promise<unknown> => {
        const type = messageType(message);
        context.emit({ detail: type ?? "invalid request", kind: "action" });
        if (type === "wallet.status") {
          return statusFor();
        }
        if (type === "wallet.swapTokens") {
          return {
            ok: true,
            swapTokens: [ETH_TOKEN, STRK_TOKEN].map(({ address, decimals, name, symbol }) => ({
              address,
              decimals,
              name,
              symbol,
            })),
          };
        }
        if (type === "wallet.swapQuote") {
          if (mode === "loading") {
            return unresolved;
          }
          if (mode === "quote-failed") {
            return { error: "No safe route is available for this amount." };
          }
          return quoteResponse(mode === "high-risk");
        }
        if (type === "wallet.swapPrepare") {
          return {
            ok: true,
            swapPreparation: {
              flags: [],
              id: PREPARATION_ID,
              minBuyAmount: "19260",
              payloadDigest: PREPARATION_ID,
              reviewedFee: { overallFee: "2400000000000000", unit: "FRI" },
              summaries: [
                "Approve 1.25 ETH to AVNU router",
                "Swap 1.25 ETH for at least 19,260 STRK",
              ],
            },
          };
        }
        if (type === "wallet.swapExecute") {
          return mode === "execute-failed"
            ? { error: "The quote expired before submission. Review a fresh route." }
            : { ok: true, transactionHash: SWAP_HASH };
        }
        return { error: "UI Lab blocks non-fixture runtime requests" };
      },
    };
    const wallet = createSidepanelRuntime(runtime);
    const swap = createSwapClient(runtime);
    const deps = {
      app: context.app,
      balances: () => ({ balances: journeyBalances }) as const,
      currency: () => "usd" as const,
      navigateHome: () => context.emit({ detail: "navigate home", kind: "state" }),
      preferences: () => journeyPreferences,
      render: async () => undefined,
      status: statusFor,
      swap,
      wallet,
    };
    bindSwap({ ...deps, app: null });
    bindSwap(deps);
    if (mode === "edit") {
      return;
    }
    if (mode === "picker") {
      context.app.querySelector<HTMLButtonElement>("#swap-buy-token")?.click();
      await nextTurn();
      return;
    }
    context.app.querySelector<HTMLButtonElement>("#swap-max")?.click();
    await nextTurn();
    if (mode === "loading" || mode === "quote" || mode === "quote-failed" || mode === "high-risk") {
      return;
    }
    context.app.querySelector<HTMLButtonElement>("#swap-review")?.click();
    await nextTurn();
    if (mode === "review") {
      return;
    }
    context.app.querySelector<HTMLButtonElement>("#swap-confirm-button")?.click();
    await nextTurn();
  };

const checkpoint = (
  mode: SwapMode,
  label: string,
  narrative: string,
): WalletScenario["checkpoints"][number] => ({
  content: () =>
    walletDashboard({
      balanceState: { balances: journeyBalances },
      preferences: journeyPreferences,
      view: "swap",
    }),
  id: mode,
  label,
  narrative,
  prepare: prepareSwap(mode),
  state: { fixture: true, pair: "ETH/STRK", stage: mode },
});

export const swapScenario: WalletScenario = {
  checkpoints: [
    checkpoint(
      "edit",
      "Choose amount",
      "The production binding selects a sensible pair and shows balances.",
    ),
    checkpoint(
      "picker",
      "Token picker",
      "Tracked and verified catalog tokens share one searchable sheet.",
    ),
    checkpoint(
      "loading",
      "Finding route",
      "Quote latency is explicit and the current input remains stable.",
    ),
    checkpoint(
      "quote",
      "Best route ready",
      "Rate, received amount, network fee, and USD delta appear together.",
    ),
    checkpoint(
      "high-risk",
      "High-loss route",
      "A materially poor route explains the loss and changes the action to an explicit risk choice.",
    ),
    checkpoint(
      "quote-failed",
      "No route available",
      "A failed quote keeps the editable amount and gives a concrete recovery path.",
    ),
    checkpoint(
      "review",
      "Frozen call review",
      "The exact approved calls, minimum received, slippage, and digest are locked before submission.",
    ),
    checkpoint(
      "execute-failed",
      "Submission failed",
      "An expired quote returns to edit with an actionable reason and no false success.",
    ),
    checkpoint(
      "submitted",
      "Swap submitted",
      "The submitted state acknowledges the handoff before returning to account-scoped Activity.",
    ),
  ],
  description:
    "Production swap bindings through selection, quote latency, route sanity, frozen review, failure, and submission.",
  id: "swap",
  surface: "sidepanel",
  title: "Swap lifecycle",
  views: ["swap"],
};
