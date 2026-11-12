/**
 * Background-decided sentences (what a call does, why it is risky, what the
 * wallet knows about a site) in the reader's language.
 *
 * The background decides each sentence as English plus a reference (a key and
 * its facts). English readers always see the background's English unchanged.
 * Other readers see the reference rendered from its pinned catalog, but only
 * after it re-renders to exactly that English: a reference that does not state
 * the same facts as the sentence the background checked is ignored, as is any
 * reference that fails to render. Either way the English is shown.
 */
import { type Locale, type MessageRef, renderMessageRef } from "@bramble/core/i18n";
import { insightMessages } from "@bramble/permissions/insight-messages";
import { reviewMessages } from "@bramble/transactions/review-messages";
import { uiLocale } from "./locale";

type SentenceCatalogs = Readonly<Record<Locale, Readonly<Record<string, string>>>>;

// Every catalog whose references cross from the background. Keys are
// namespaced per catalog (`review.*`, `siteInsight.*`), so one lookup serves all.
const CATALOGS: readonly SentenceCatalogs[] = [reviewMessages, insightMessages];

const template =
  (locale: Locale) =>
  (key: string): string | undefined => {
    const owner = CATALOGS.find((catalog) => Object.hasOwn(catalog.en, key));
    return owner?.[locale][key];
  };

/** One background-decided line in the active language, falling back to its English. */
export const reviewLine = (text: MessageRef | undefined, english: string): string => {
  const locale = uiLocale();
  if (text === undefined || locale === "en") return english;
  try {
    if (renderMessageRef(text, template("en")) !== english) return english;
    return renderMessageRef(text, template(locale));
  } catch {
    return english;
  }
};

/** Lines in the active language; references pair with lines by index. */
export const reviewLines = (
  english: readonly string[],
  texts: readonly MessageRef[] | undefined,
): readonly string[] =>
  english.map((line, index) =>
    reviewLine(texts?.length === english.length ? texts[index] : undefined, line),
  );
