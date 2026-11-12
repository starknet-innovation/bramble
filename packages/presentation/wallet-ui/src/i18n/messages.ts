/**
 * The wallet UI's message catalog and lookup.
 *
 * Each area keeps its copy in `./messages/<area>.ts`; this module merges them
 * so one key space covers the whole UI and the catalog test sees every entry.
 * `t` returns plain text: pass it to a UI Kit helper (which escapes) or to
 * `textContent`. Writing into a string-HTML template goes through `th`, which
 * escapes the whole result, facts included.
 */
import { escapeHtml } from "@bramble/core/html";
import { type Locale, type MessageArgs, translator } from "@bramble/core/i18n";
import { uiLocale } from "./locale";
import { activityMessages } from "./messages/activity";
import { collectiblesMessages } from "./messages/collectibles";
import { ledgerMessages } from "./messages/ledger";
import { multisigMessages } from "./messages/multisig";
import { multisigProposeMessages } from "./messages/multisig-propose";
import { multisigSetupMessages } from "./messages/multisig-setup";
import { multisigSignerMessages } from "./messages/multisig-signers";
import { onboardingMessages } from "./messages/onboarding";
import { portfolioMessages } from "./messages/portfolio";
import { privacyMessages } from "./messages/privacy";
import { reviewApprovalMessages } from "./messages/review-approvals";
import { reviewDetailMessages } from "./messages/review-details";
import { reviewFeeMessages } from "./messages/review-fees";
import { reviewSignMessages } from "./messages/review-sign";
import { sendMessages } from "./messages/send";
import { settingsMessages } from "./messages/settings";
import { shellMessages } from "./messages/shell";
import { shellScreenMessages } from "./messages/shell-screens";
import { swapStakingMessages } from "./messages/swap-staking";

/**
 * Every area catalog by file name (`./messages/<name>.ts`). The catalog tests
 * read it to refuse a message id two areas define and to pin signing text.
 */
export const UI_AREA_CATALOGS = {
  activity: activityMessages,
  collectibles: collectiblesMessages,
  ledger: ledgerMessages,
  "multisig-propose": multisigProposeMessages,
  "multisig-setup": multisigSetupMessages,
  "multisig-signers": multisigSignerMessages,
  multisig: multisigMessages,
  onboarding: onboardingMessages,
  portfolio: portfolioMessages,
  privacy: privacyMessages,
  "review-approvals": reviewApprovalMessages,
  "review-details": reviewDetailMessages,
  "review-fees": reviewFeeMessages,
  "review-sign": reviewSignMessages,
  send: sendMessages,
  settings: settingsMessages,
  "shell-screens": shellScreenMessages,
  shell: shellMessages,
  "swap-staking": swapStakingMessages,
} as const;

const en = {
  ...activityMessages.en,
  ...collectiblesMessages.en,
  ...ledgerMessages.en,
  ...multisigProposeMessages.en,
  ...multisigSetupMessages.en,
  ...multisigSignerMessages.en,
  ...multisigMessages.en,
  ...onboardingMessages.en,
  ...portfolioMessages.en,
  ...privacyMessages.en,
  ...reviewApprovalMessages.en,
  ...reviewDetailMessages.en,
  ...reviewFeeMessages.en,
  ...reviewSignMessages.en,
  ...sendMessages.en,
  ...settingsMessages.en,
  ...shellScreenMessages.en,
  ...shellMessages.en,
  ...swapStakingMessages.en,
} as const;

/** Every UI message, per locale. Exported for the catalog test. */
export const uiCatalogs = {
  en,
  "zh-Hans": {
    ...activityMessages["zh-Hans"],
    ...collectiblesMessages["zh-Hans"],
    ...ledgerMessages["zh-Hans"],
    ...multisigProposeMessages["zh-Hans"],
    ...multisigSetupMessages["zh-Hans"],
    ...multisigSignerMessages["zh-Hans"],
    ...multisigMessages["zh-Hans"],
    ...onboardingMessages["zh-Hans"],
    ...portfolioMessages["zh-Hans"],
    ...privacyMessages["zh-Hans"],
    ...reviewApprovalMessages["zh-Hans"],
    ...reviewDetailMessages["zh-Hans"],
    ...reviewFeeMessages["zh-Hans"],
    ...reviewSignMessages["zh-Hans"],
    ...sendMessages["zh-Hans"],
    ...settingsMessages["zh-Hans"],
    ...shellScreenMessages["zh-Hans"],
    ...shellMessages["zh-Hans"],
    ...swapStakingMessages["zh-Hans"],
  },
};

/** A UI message id. */
export type UiMessageKey = keyof typeof en;

const lookup = translator(uiCatalogs);

/** A UI message in the active language, as plain text. */
export const t = <K extends UiMessageKey>(key: K, ...args: MessageArgs<(typeof en)[K]>): string =>
  lookup(uiLocale())(key, ...args);

/** A UI message in the active language, escaped for a string-HTML template. */
export const th = <K extends UiMessageKey>(key: K, ...args: MessageArgs<(typeof en)[K]>): string =>
  escapeHtml(t(key, ...args));

/**
 * Each language's name in its own script, so a reader can find theirs whatever
 * language the UI is in. Never translated.
 */
export const LANGUAGE_NAMES: Readonly<Record<Locale, string>> = {
  en: "English",
  "zh-Hans": "简体中文",
};
