/**
 * Catalog sentences whose facts are already-built HTML fragments (a copyable
 * address, a `<code>` class hash, a bold amount).
 *
 * The caller looks the sentence up with each fact replaced by its own
 * `{name}` token, so the translation decides where every fact sits. This
 * escapes the sentence as plain text, then swaps each token for its fragment
 * in one pass, so a fragment is never re-read as a token. Fragments are
 * trusted markup: build them with `escapeHtml` around every dynamic value.
 */
import { escapeHtml } from "@bramble/core/html";

/** The `{name}` token for each fragment, to pass as the lookup's parameters. */
export const fragmentTokens = <K extends string>(
  fragments: Readonly<Record<K, string>>,
): Record<K, string> =>
  Object.fromEntries(Object.keys(fragments).map((name) => [name, `{${name}}`])) as Record<
    K,
    string
  >;

/** Escapes `sentence` and places each fragment at its token. */
export const htmlSentence = (
  sentence: string,
  fragments: Readonly<Record<string, string>>,
): string =>
  escapeHtml(sentence).replace(/\{([A-Za-z][A-Za-z0-9]*)\}/gu, (token, name: string) =>
    Object.hasOwn(fragments, name) ? (fragments[name] ?? token) : token,
  );
