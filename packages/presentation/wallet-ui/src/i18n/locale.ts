/**
 * The wallet UI's active language.
 *
 * One extension page renders one language at a time, so the active locale is
 * page state set by the entrypoint before each paint (`applyEntryLanguage`)
 * and read by every view through `t`. Views stay pure functions of their
 * inputs plus this value; tests set it explicitly.
 *
 * Trust boundary: the locale only selects which catalog text renders. It never
 * changes what a review checks, which facts a sentence carries, or any value
 * sent to the background.
 */
import { type Locale, localeForLanguages, SOURCE_LOCALE } from "@bramble/core/i18n";
import type { LanguagePreference } from "@bramble/wallet-model/preferences";

let active: Locale = SOURCE_LOCALE;

/** The language the UI is rendering in. English until an entrypoint sets one. */
export const uiLocale = (): Locale => active;

/** Sets the language the next render uses. */
export const setUiLocale = (locale: Locale): void => {
  active = locale;
};

/**
 * Resolves the stored preference against the browser's language list. Absent
 * or `"auto"` follows the browser, which also covers the onboarding surface
 * before any preference exists; a pinned locale wins outright.
 */
export const resolveUiLocale = (
  preference: LanguagePreference | undefined,
  browserLanguages: readonly string[],
): Locale =>
  preference === undefined || preference === "auto"
    ? localeForLanguages(browserLanguages)
    : preference;
