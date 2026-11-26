/**
 * The mobile Swap screens' copy and loss tiers, rendered for Swift and Kotlin from the extension's
 * own catalog (`swap.*`, `review.swap.*`) and the swap screen's loss thresholds
 * (`swap-client.ts`), so neither native app retypes a string or a threshold. Review, risk and
 * refusal sentences are not here: the mobile apps show the core's own (`SwapReview.summaries`,
 * `RiskFlag.message`, `SwapError.Refused.reason`).
 */
import { uiCatalogs } from "../../packages/presentation/wallet-ui/src/i18n/messages";
// Not package exports: the side panel's swap thresholds, read here only to pin the mobile port.
import {
  SWAP_LOSS_HIGH_RISK_PERCENT,
  SWAP_LOSS_WARN_PERCENT,
} from "../../packages/presentation/wallet-ui/src/sidepanel/journeys/swap/swap-client";
import { HEADER, sorted } from "./shared";

/** Repository-relative path of the iOS swap copy table. */
export const SWAP_COPY_SWIFT_PATH = "mobile/ios/Bramble/Swap/SwapCopy.generated.swift";
/** Repository-relative path of the Android swap copy table. */
export const SWAP_COPY_KOTLIN_PATH =
  "mobile/android/app/src/main/java/org/bramble/wallet/swap/SwapCopy.generated.kt";

type Key = keyof typeof uiCatalogs.en;

/** Mobile name → the extension catalog key it reads. */
const FROM_CATALOG: Readonly<Record<string, Key>> = {
  amountToSell: "swap.edit.amountToSell",
  back: "swap.back",
  buy: "swap.edit.buy",
  chooseBuyToken: "swap.edit.chooseBuyToken",
  chooseSellToken: "swap.edit.chooseSellToken",
  complete: "swap.success.complete",
  confirm: "review.swap.confirm",
  confirming: "review.swap.confirming",
  fee: "swap.edit.fee",
  finding: "swap.edit.finding",
  flip: "swap.edit.flip",
  highSlippage: "swap.edit.highSlippage",
  homeAction: "portfolio.home.swap",
  insufficientToken: "swap.edit.insufficientToken",
  max: "swap.edit.max",
  minimumReceived: "review.swap.minimumReceived",
  notConfirmed: "swap.success.notConfirmed",
  preparing: "swap.edit.preparing",
  review: "swap.edit.review",
  reviewReceive: "review.swap.receive",
  reviewSell: "review.swap.sell",
  reviewTitle: "review.swap.title",
  select: "swap.edit.select",
  sell: "swap.edit.sell",
  submitted: "swap.success.submitted",
  submitting: "review.swap.submitting",
  swapAnyway: "swap.edit.swapAnyway",
  swapFailed: "review.swap.failed",
  title: "swap.title",
  transaction: "swap.success.transaction",
  viewActivity: "swap.success.viewActivity",
};

/**
 * Mobile-only strings, written here once. The extension re-quotes on every edit and has no
 * refresh control; a phone's quote can sit on screen while the app is backgrounded.
 */
const MOBILE_ONLY: Readonly<Record<string, string>> = {
  refreshQuote: "Refresh quote",
};

const SWAP_COPY: Readonly<Record<string, string>> = {
  ...Object.fromEntries(
    Object.entries(FROM_CATALOG).map(([name, key]) => [name, uiCatalogs.en[key]]),
  ),
  ...MOBILE_ONLY,
};

const quoted = (value: string): string => JSON.stringify(value);

/** `SwapCopy.generated.swift`. */
export const renderSwiftSwapCopy = (): string =>
  [
    `// ${HEADER}`,
    "",
    "/// The extension's Swap-screen strings and loss tiers (`swap.*`, `review.swap.*`,",
    "/// `swap-client.ts`). Review, risk and refusal sentences come from the core, never from here.",
    "enum SwapCopy {",
    ...sorted(SWAP_COPY).map(([key, value]) => `    static let ${key} = ${quoted(value)}`),
    `    static let lossWarnPercent: Double = ${SWAP_LOSS_WARN_PERCENT}`,
    `    static let lossHighRiskPercent: Double = ${SWAP_LOSS_HIGH_RISK_PERCENT}`,
    "}",
    "",
  ].join("\n");

/** `SwapCopy.generated.kt`. */
export const renderKotlinSwapCopy = (): string =>
  [
    `// ${HEADER}`,
    "package org.bramble.wallet.swap",
    "",
    "/**",
    " * The extension's Swap-screen strings and loss tiers (`swap.*`, `review.swap.*`,",
    " * `swap-client.ts`). Review, risk and refusal sentences come from the core, never from here.",
    " */",
    "object SwapCopy {",
    ...sorted(SWAP_COPY).map(
      ([key, value]) => `    const val ${key} = ${quoted(value).replaceAll("$", "\\$")}`,
    ),
    `    const val lossWarnPercent: Double = ${SWAP_LOSS_WARN_PERCENT.toFixed(1)}`,
    `    const val lossHighRiskPercent: Double = ${SWAP_LOSS_HIGH_RISK_PERCENT.toFixed(1)}`,
    "}",
    "",
  ].join("\n");
