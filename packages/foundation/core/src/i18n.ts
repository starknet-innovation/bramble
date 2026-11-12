/**
 * Message catalogs and typed lookup for user-facing copy.
 *
 * English is the source of truth: every other locale's catalog is typed
 * against the English keys, so a missing translation is a compile error rather
 * than a blank label. A message is plain text with `{name}` placeholders; the
 * facts a sentence carries (amounts, symbols, addresses) are filled in by the
 * caller and never translated, so a translation can change the grammar around
 * a fact but not the fact itself.
 *
 * Trust boundary: catalog text is plain text, never markup. Lookup does not
 * escape; a caller writing into an HTML string must escape the result like any
 * other dynamic text. `catalogFailures` rejects markup characters in every
 * locale so a translation cannot smuggle a tag into a view even when escaped
 * text is later mishandled.
 */

/** Every locale the wallet ships, English first. */
export const LOCALES = ["en", "zh-Hans"] as const;

/** One shipped locale, as a BCP 47 tag. */
export type Locale = (typeof LOCALES)[number];

/** The locale every catalog is written in first and falls back to. */
export const SOURCE_LOCALE = "en" satisfies Locale;

/** Whether a value names a shipped locale. */
export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (LOCALES as readonly string[]).includes(value);

// Traditional-script tags and regions. Simplified text is not a substitute for
// a reader of Traditional, so these keep looking down the browser's list.
const TRADITIONAL = /^zh-(?:hant|tw|hk|mo)(?:-|$)/u;

/**
 * Picks the shipped locale for a browser's ordered language list (as
 * `navigator.languages` reports it). The first tag the wallet can serve wins;
 * a Traditional Chinese tag is skipped rather than answered in Simplified.
 * Falls back to English when nothing matches, including on an empty list.
 */
export const localeForLanguages = (languages: readonly string[]): Locale => {
  for (const tag of languages) {
    const lower = tag.trim().toLowerCase();
    if (lower === "en" || lower.startsWith("en-")) return "en";
    if ((lower === "zh" || lower.startsWith("zh-")) && !TRADITIONAL.test(lower)) return "zh-Hans";
  }
  return SOURCE_LOCALE;
};

/** One locale's messages, keyed by message id. */
export type Catalog<K extends string> = Readonly<Record<K, string>>;

/** Every locale's catalog for one set of message ids. */
export type Catalogs<K extends string> = Readonly<Record<Locale, Catalog<K>>>;

/** The `{name}` placeholders a message template declares, as a union. */
export type Placeholders<S extends string> = S extends `${string}{${infer P}}${infer R}`
  ? P | Placeholders<R>
  : never;

/** The argument list a message needs: none, or one value per placeholder. */
export type MessageArgs<S extends string> = [Placeholders<S>] extends [never]
  ? []
  : [params: Readonly<Record<Placeholders<S>, string>>];

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/gu;

/** The distinct placeholder names in a template, sorted. */
export const placeholderNames = (template: string): readonly string[] =>
  [...new Set([...template.matchAll(PLACEHOLDER)].map((match) => match[1] ?? ""))].sort();

/**
 * Fills a template's placeholders. Throws when a placeholder has no value: a
 * sentence that silently loses its amount or address is worse than a screen
 * that fails, and the typed translator makes this unreachable from typed code.
 */
export const formatMessage = (
  template: string,
  params: Readonly<Record<string, string>> = {},
): string =>
  template.replace(PLACEHOLDER, (_whole, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`missing message parameter: ${name}`);
    return value;
  });

/** A lookup bound to one locale: message id plus its placeholder values. */
export type Translate<E extends Catalog<string>> = <K extends keyof E & string>(
  key: K,
  ...args: MessageArgs<E[K]>
) => string;

/**
 * Binds a catalog set to a locale. Declare the English catalog `as const` so
 * each message's placeholders are checked at every call site.
 */
export const translator =
  <E extends Catalog<string>>(catalogs: {
    readonly en: E;
    readonly "zh-Hans": Catalog<keyof E & string>;
  }) =>
  (locale: Locale): Translate<E> =>
  (key, ...args) =>
    formatMessage(catalogs[locale][key] ?? catalogs.en[key], args[0]);

const MARKUP = /[<>]/u;

// Problems with one translated entry measured against its English source.
const entryFailures = (
  locale: Locale,
  key: string,
  text: string,
  english: string | undefined,
): readonly string[] => {
  if (english === undefined) return [`${locale}: unknown ${key}`];
  const failures: string[] = [];
  if (placeholderNames(text).join() !== placeholderNames(english).join()) {
    failures.push(`${locale}: ${key} placeholders differ from ${SOURCE_LOCALE}`);
  }
  if (MARKUP.test(text)) failures.push(`${locale}: ${key} contains markup`);
  if (text.length === 0 || text.trim() !== text)
    failures.push(`${locale}: ${key} is empty or padded`);
  return failures;
};

/**
 * Every structural problem in a catalog set, for a test to assert empty:
 * a key missing from or extra to a locale, a translation whose placeholders
 * differ from English, markup characters, and empty or padded text.
 */
export const catalogFailures = (catalogs: Catalogs<string>): readonly string[] => {
  const source = catalogs[SOURCE_LOCALE];
  return LOCALES.flatMap((locale) => {
    const catalog = catalogs[locale];
    return [
      ...Object.keys(source)
        .filter((key) => !Object.hasOwn(catalog, key))
        .map((key) => `${locale}: missing ${key}`),
      ...Object.entries(catalog).flatMap(([key, text]) =>
        entryFailures(locale, key, text, source[key]),
      ),
    ];
  });
};
