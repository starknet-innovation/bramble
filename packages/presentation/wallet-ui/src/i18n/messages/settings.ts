/**
 * Settings copy: the language screen and its menu row.
 */
import type { Catalog } from "@bramble/core/i18n";

const en = {
  "settings.language.auto": "Browser",
  "settings.language.saveFailed": "Couldn't change the language.",
  "settings.language.title": "Language",
} as const;

/** English and Simplified Chinese settings copy. */
export const settingsMessages = {
  en,
  "zh-Hans": {
    "settings.language.auto": "跟随浏览器",
    "settings.language.saveFailed": "无法更改语言。",
    "settings.language.title": "语言",
  } satisfies Catalog<keyof typeof en>,
};
