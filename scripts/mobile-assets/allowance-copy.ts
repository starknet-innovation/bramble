/**
 * The extension's allowance-manager copy (`portfolio.allowance.*`, `allowance-views.ts`), rendered
 * for the mobile allowance screens (M19) so neither app restates a string. `{count}` and `{amount}`
 * are filled in by the apps exactly as the side panel's `t()` fills them.
 *
 * Not here, by design: the revoke's review sentence, its risk lines and its refusals, which come
 * from the Rust core (`TransferPlan.currentReview`, `riskFlags`, `RevokeError`'s Display) and are
 * shown verbatim or through the generated friendly-error copy; and the unlimited cut-off and the
 * retention cap, which the core exports (`AllowanceView.unlimited`, `allowance_entries_per_scope`).
 */
// Not package exports: the English catalogs, read here only to pin the mobile copy to them.
import { activityMessages } from "../../packages/presentation/wallet-ui/src/i18n/messages/activity";
import { portfolioMessages } from "../../packages/presentation/wallet-ui/src/i18n/messages/portfolio";
import { settingsMessages } from "../../packages/presentation/wallet-ui/src/i18n/messages/settings";
import { HEADER, sorted } from "./shared";

/** Repository-relative path of the iOS allowance copy table. */
export const ALLOWANCE_COPY_SWIFT_PATH =
  "mobile/ios/Bramble/Portfolio/AllowanceCopy.generated.swift";
/** Repository-relative path of the Android allowance copy table. */
export const ALLOWANCE_COPY_KOTLIN_PATH =
  "mobile/android/app/src/main/java/org/bramble/wallet/allowances/AllowanceCopy.generated.kt";

/**
 * The mobile revoke screen's receipt rows. The extension reviews a revoke inline in its row, so it
 * has no such labels; they are written once here, apart, so the drift test can enumerate them.
 */
export const ALLOWANCE_MOBILE_ONLY = {
  amountRow: "Allowance",
  spenderRow: "Spender",
  tokenRow: "Token",
} as const;

// `none` and `of` read badly as Swift members (`AllowanceCopy.none` looks like `Optional.none`).
const RENAMED: Readonly<Record<string, string>> = { none: "noneFound", of: "ofContract" };

/** Every string the allowance screens show, keyed by its camelCase name. */
export const allowanceCopy = (): Readonly<Record<string, string>> => ({
  ...Object.fromEntries(
    Object.entries(portfolioMessages.en)
      .filter(([key]) => key.startsWith("portfolio.allowance."))
      .map(([key, value]) => {
        const name = key.slice("portfolio.allowance.".length);
        return [RENAMED[name] ?? name, value];
      }),
  ),
  ...ALLOWANCE_MOBILE_ONLY,
  copyTokenContract: activityMessages.en["portfolio.activity.copyTokenContract"],
  settingsRow: settingsMessages.en["settings.dock.allowances"],
  settingsSection: settingsMessages.en["settings.dock.access"],
});

const quoted = (value: string): string => JSON.stringify(value);

/** `AllowanceCopy.generated.swift`. */
export const renderSwiftAllowanceCopy = (): string =>
  [
    `// ${HEADER}`,
    "",
    "/// The extension's allowance-manager copy (`portfolio.allowance.*`); placeholders are filled by",
    "/// the app.",
    "enum AllowanceCopy {",
    ...sorted(allowanceCopy()).map(([key, value]) => `    static let ${key} = ${quoted(value)}`),
    "}",
    "",
  ].join("\n");

/** `AllowanceCopy.generated.kt`. */
export const renderKotlinAllowanceCopy = (): string =>
  [
    `// ${HEADER}`,
    "package org.bramble.wallet.allowances",
    "",
    "/** The extension's allowance-manager copy (`portfolio.allowance.*`); placeholders are filled by the app. */",
    "object AllowanceCopy {",
    ...sorted(allowanceCopy()).map(
      ([key, value]) => `    const val ${key} = ${quoted(value).replaceAll("$", "\\$")}`,
    ),
    "}",
    "",
  ].join("\n");
