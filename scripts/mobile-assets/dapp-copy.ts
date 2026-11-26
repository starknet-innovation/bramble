/**
 * The in-app browser's copy (P16), rendered for both apps so neither restates a string. The
 * connection card and the site warnings are the extension's own signing text (the side panel's
 * `approval-connect-card.ts` and `@bramble/permissions` insight messages), imported verbatim:
 * approval and warning sentences are edited as a reviewed group, never here. `{target}` and
 * `{tld}` are filled in by the apps from the core's `SiteWarning`.
 */
import { insightMessages } from "@bramble/permissions/insight-messages";
// Not package exports: the English catalogs, read here only to pin the mobile copy to them.
import { reviewApprovalMessages } from "../../packages/presentation/wallet-ui/src/i18n/messages/review-approvals";
import { reviewDetailMessages } from "../../packages/presentation/wallet-ui/src/i18n/messages/review-details";
import { HEADER, sorted } from "./shared";

/** Repository-relative path of the iOS browser copy table. */
export const DAPP_COPY_SWIFT_PATH = "mobile/ios/Bramble/Browser/DappCopy.generated.swift";
/** Repository-relative path of the Android browser copy table. */
export const DAPP_COPY_KOTLIN_PATH =
  "mobile/android/app/src/main/java/org/bramble/wallet/browser/DappCopy.generated.kt";

/** The browser screen's own strings; the extension has no browser, so they are written once here. */
const DAPP_MOBILE_ONLY = {
  addressInvalid: "Enter an https address",
  addressPlaceholder: "Site address",
  browserTitle: "Browser",
  browserUnavailable: "Browser unavailable",
} as const;

const camel = (key: string): string =>
  key.replace(/\.([a-z])/g, (_, letter: string) => letter.toUpperCase());

/** Every string the browser and its connection card show, keyed by camelCase name. */
const dappCopy = (): Readonly<Record<string, string>> => {
  const details = reviewDetailMessages.en;
  const approvals = reviewApprovalMessages.en;
  return {
    ...DAPP_MOBILE_ONLY,
    ...Object.fromEntries(
      Object.entries(insightMessages.en).map(([key, value]) => [camel(key), value]),
    ),
    connectAccount: approvals["approval.context.account"],
    connectAction: details["detail.connect.action"],
    connectCancel: details["detail.connect.cancel"],
    connectNoFee: approvals["approval.noFee"],
    connectSelectAccount: details["detail.connect.selectAccount"],
    connectShares: details["detail.connect.shares"],
    connectTitle: details["detail.connect.title"],
  };
};

const quoted = (value: string): string => JSON.stringify(value);

/** `DappCopy.generated.swift`. */
export const renderSwiftDappCopy = (): string =>
  [
    `// ${HEADER}`,
    "",
    "/// The in-app browser's copy: the extension's connection card and site warnings, verbatim.",
    "enum DappCopy {",
    ...sorted(dappCopy()).map(([key, value]) => `    static let ${key} = ${quoted(value)}`),
    "}",
    "",
  ].join("\n");

/** `DappCopy.generated.kt`. */
export const renderKotlinDappCopy = (): string =>
  [
    `// ${HEADER}`,
    "package org.bramble.wallet.browser",
    "",
    "/** The in-app browser's copy: the extension's connection card and site warnings, verbatim. */",
    "object DappCopy {",
    ...sorted(dappCopy()).map(
      ([key, value]) => `    const val ${key} = ${quoted(value).replaceAll("$", "\\$")}`,
    ),
    "}",
    "",
  ].join("\n");
