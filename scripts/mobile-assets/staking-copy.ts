/**
 * The extension's staking screen copy (`staking.*` in `swap-staking.ts`), rendered for the mobile
 * staking screens (M21) so neither app restates a string. `{symbol}`, `{amount}`, `{count}` and
 * the like are filled in by the apps exactly as the side panel's `t()` fills them.
 *
 * The `review.staking.*` wrappers (`review-steps-swap.ts`: the fee line, Confirm, the outcome) are
 * signing text pinned by `tests/i18n/review-pins.ts`, and are rendered here as `review*`. Not here,
 * by design: the review sentence itself, every refusal and every risk line, which come from the
 * Rust core (`StakingPlan.review`, `StakingError.Refused`, `TransferPlan.riskFlags`) and are
 * shown verbatim.
 */
// Not package exports: the English catalogs, read here only to pin the mobile copy to them.
import { reviewStepsSwapMessages } from "../../packages/presentation/wallet-ui/src/i18n/messages/review-steps-swap";
import { swapStakingMessages } from "../../packages/presentation/wallet-ui/src/i18n/messages/swap-staking";
import { HEADER, sorted } from "./shared";

/** Repository-relative path of the iOS staking copy table. */
export const STAKING_COPY_SWIFT_PATH = "mobile/ios/Bramble/Staking/StakingCopy.generated.swift";
/** Repository-relative path of the Android staking copy table. */
export const STAKING_COPY_KOTLIN_PATH =
  "mobile/android/app/src/main/java/org/bramble/wallet/staking/StakingCopy.generated.kt";

// `staking.directory.pasteAddress` → `directoryPasteAddress`; `review.staking.confirm` → `reviewConfirm`.
const camel = (key: string): string =>
  key
    .replace(/^staking\./, "")
    .replace(/^review\.staking\./, "review.")
    .split(".")
    .map((part, index) => (index === 0 ? part : `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`))
    .join("");

/** Every English `staking.*` and `review.staking.*` string, keyed by its camelCase name. */
export const stakingCopy = (): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Object.entries({ ...swapStakingMessages.en, ...reviewStepsSwapMessages.en })
      .filter(([key]) => key.startsWith("staking.") || key.startsWith("review.staking."))
      .map(([key, value]) => [camel(key), value]),
  );

const quoted = (value: string): string => JSON.stringify(value);

/** `StakingCopy.generated.swift`. */
export const renderSwiftStakingCopy = (): string =>
  [
    `// ${HEADER}`,
    "",
    "/// The extension's staking screen copy (`swap-staking.ts`); placeholders are filled by the app.",
    "enum StakingCopy {",
    ...sorted(stakingCopy()).map(([key, value]) => `    static let ${key} = ${quoted(value)}`),
    "}",
    "",
  ].join("\n");

/** `StakingCopy.generated.kt`. */
export const renderKotlinStakingCopy = (): string =>
  [
    `// ${HEADER}`,
    "package org.bramble.wallet.staking",
    "",
    "/** The extension's staking screen copy (`swap-staking.ts`); placeholders are filled by the app. */",
    "object StakingCopy {",
    ...sorted(stakingCopy()).map(
      ([key, value]) => `    const val ${key} = ${quoted(value).replaceAll("$", "\\$")}`,
    ),
    "}",
    "",
  ].join("\n");
