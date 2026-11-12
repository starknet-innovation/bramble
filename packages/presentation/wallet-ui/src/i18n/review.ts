/**
 * Review sentences (what a call does, why it is risky) in the reader's
 * language.
 *
 * The background decides each sentence as English plus a reference (a key and
 * its facts). English readers always see the background's English unchanged.
 * Other readers see the reference rendered from the pinned review catalog, but
 * only after it re-renders to exactly that English: a reference that does not
 * state the same facts as the sentence the background checked is ignored, as
 * is any reference that fails to render. Either way the English is shown.
 */
import { renderMessageRef } from "@bramble/core/i18n";
import {
  isReviewMessageKey,
  type ReviewText,
  reviewEnglish,
  reviewMessages,
} from "@bramble/transactions/review-messages";
import { uiLocale } from "./locale";

/** One review line in the active language, falling back to its English. */
export const reviewLine = (text: ReviewText | undefined, english: string): string => {
  const locale = uiLocale();
  if (text === undefined || locale === "en") return english;
  try {
    if (reviewEnglish(text) !== english) return english;
    const catalog = reviewMessages[locale];
    return renderMessageRef(text, (key) => (isReviewMessageKey(key) ? catalog[key] : undefined));
  } catch {
    return english;
  }
};

/** Summary lines in the active language; references pair with lines by index. */
export const reviewLines = (
  english: readonly string[],
  texts: readonly ReviewText[] | undefined,
): readonly string[] =>
  english.map((line, index) =>
    reviewLine(texts?.length === english.length ? texts[index] : undefined, line),
  );
