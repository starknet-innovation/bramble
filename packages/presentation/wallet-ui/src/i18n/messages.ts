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
import { multisigMessages } from "./messages/multisig";
import { multisigProposeMessages } from "./messages/multisig-propose";
import { multisigSetupMessages } from "./messages/multisig-setup";
import { multisigSignerMessages } from "./messages/multisig-signers";
import { onboardingMessages } from "./messages/onboarding";
import { privacyMessages } from "./messages/privacy";
import { sendMessages } from "./messages/send";
import { settingsMessages } from "./messages/settings";
import { swapStakingMessages } from "./messages/swap-staking";

const en = {
  ...multisigProposeMessages.en,
  ...multisigSetupMessages.en,
  ...multisigSignerMessages.en,
  ...multisigMessages.en,
  ...onboardingMessages.en,
  ...privacyMessages.en,
  ...sendMessages.en,
  ...settingsMessages.en,
  ...swapStakingMessages.en,
} as const;

/** Every UI message, per locale. Exported for the catalog test. */
export const uiCatalogs = {
  en,
  "zh-Hans": {
    ...multisigProposeMessages["zh-Hans"],
    ...multisigSetupMessages["zh-Hans"],
    ...multisigSignerMessages["zh-Hans"],
    ...multisigMessages["zh-Hans"],
    ...onboardingMessages["zh-Hans"],
    ...privacyMessages["zh-Hans"],
    ...sendMessages["zh-Hans"],
    ...settingsMessages["zh-Hans"],
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
