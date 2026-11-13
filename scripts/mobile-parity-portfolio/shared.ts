/**
 * Helpers shared by the portfolio/activity parity blocks: in-process HTTP responses, a scripted
 * clock, and HTML readers for the side panel's rendered markup. Nothing here reaches a network
 * or reads a real clock: every exchange is answered from the case data, so the fixture is a pure
 * function of the extension's code.
 */

/** One scripted HTTP answer: a status and body text, or `null` for a transport failure. */
export type ScriptedAnswer = { readonly body: string; readonly status: number } | null;

/** Builds a fetch-shaped transport that answers from a function of the URL and records URLs. */
export const scriptedFetch = (
  answer: (url: string) => ScriptedAnswer,
  seen: string[] = [],
  headers: Record<string, string>[] = [],
): ((url: string, init: RequestInit) => Promise<Response>) => {
  return async (url: string, init: RequestInit) => {
    seen.push(url);
    headers.push({ ...((init.headers as Record<string, string> | undefined) ?? {}) });
    const scripted = answer(url);
    if (scripted === null) {
      throw new TypeError("fetch failed");
    }
    return new Response(scripted.body, { status: scripted.status });
  };
};

/** A settable clock for services that take an injected `now`. */
export type ScriptedClock = { now: number; readonly read: () => number };

/** Creates a clock that reads whatever `now` was last set to. */
export const scriptedClock = (start: number): ScriptedClock => {
  const clock = {
    now: start,
    read: () => clock.now,
  };
  return clock;
};

/** Reverses the side panel's `escapeHtml`. */
export const unescapeHtml = (value: string): string =>
  value
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");

/**
 * The text of rendered markup with every tag removed. Repeated until nothing changes, so a tag
 * split around another (`<scr<b>ipt>`) cannot survive one pass as a new tag.
 */
export const stripTags = (html: string): string => {
  let text = html;
  for (let previous = ""; previous !== text; ) {
    previous = text;
    text = text.replace(/<[^>]*>/g, "");
  }
  return text;
};

/** First capture of a pattern in rendered markup, unescaped, or null. */
export const firstMatch = (html: string, pattern: RegExp): string | null => {
  const match = pattern.exec(html);
  return match?.[1] === undefined ? null : unescapeHtml(match[1]);
};

/** Reads a `tokenGlyph` rendering: the bundled logo's key or the letter badge's tone and text. */
export const readGlyph = (
  html: string,
): { readonly logo: boolean; readonly letters: string | null; readonly tone: string | null } => {
  const mark = /<span class="token-mark" data-tone="([^"]*)">([^<]*)<\/span>/.exec(html);
  return mark
    ? { letters: unescapeHtml(mark[2] ?? ""), logo: false, tone: mark[1] ?? null }
    : { letters: null, logo: html.includes("<svg"), tone: null };
};
