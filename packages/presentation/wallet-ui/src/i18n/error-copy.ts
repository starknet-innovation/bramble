/**
 * Error copy in the reader's language, applied where an error is displayed.
 *
 * `friendlyError` keeps returning the reviewed English: other code classifies
 * its output (an "outcome unknown" sentence reads as a warning, not a failure),
 * and the copy tables stay keyed on the raw English the background emits. The
 * English copy therefore has one source, the tables (or, for a sentence the
 * panel shows as written, its literal); the translations here are keyed by
 * that exact English, so editing a sentence there leaves its old
 * translation unmatched and `errors-zh.test.ts` fails until it is redone.
 *
 * Only reviewed copy is translated. A raw message shown as written (a service
 * diagnostic, a swap safety refusal, a sanitised detail in parentheses) passes
 * through unchanged: it is a fact, and support reads it as written.
 */
import { ledgerMessagesByEnglish } from "@bramble/ledger-protocol/errors-i18n";
import { ERROR_COPY_ZH_A } from "./error-copy-zh-a";
import { ERROR_COPY_ZH_B } from "./error-copy-zh-b";
import { ERROR_COPY_ZH_UI } from "./error-copy-zh-ui";
import { uiLocale } from "./locale";

/** Every translated reviewed sentence, keyed by its English. Exported for the coverage test. */
export const ERROR_COPY_ZH: ReadonlyMap<string, string> = new Map([
  ...Object.entries(ERROR_COPY_ZH_A),
  ...Object.entries(ERROR_COPY_ZH_B),
  ...Object.entries(ERROR_COPY_ZH_UI),
  ...ledgerMessagesByEnglish("zh-Hans"),
]);

// Longest first, so a head that extends another is matched before it.
const HEADS = [...ERROR_COPY_ZH.keys()].sort((a, b) => b.length - a.length);

// A reviewed sentence or head with what the classifiers append to it: a
// sanitised detail in parentheses, or a reason after a colon, or a full stop.
const composite = (english: string): string | null => {
  for (const head of HEADS) {
    const zh = ERROR_COPY_ZH.get(head) ?? head;
    if (english === `${head}.`) return `${zh}。`;
    if (english.startsWith(`${head}: `)) return `${zh}：${english.slice(head.length + 2)}`;
    if (english.startsWith(`${head} (`) && english.endsWith(")")) {
      return `${zh}${english.slice(head.length)}`;
    }
  }
  return null;
};

/**
 * One error line in the active language. English readers get it unchanged;
 * other readers get the translation of a reviewed sentence (or of its head,
 * with the appended detail kept verbatim), and anything else as written.
 */
export const localizeErrorCopy = (english: string): string => {
  if (uiLocale() === "en") return english;
  return ERROR_COPY_ZH.get(english) ?? composite(english) ?? english;
};
