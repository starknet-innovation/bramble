/**
 * The text discipline the sign approval card applies to every name and value it
 * prints, so that what reaches the screen cannot say something the payload does
 * not.
 *
 * `src/starknet/typed-data.ts` refuses to hash a payload whose *declared* names
 * carry a bidi override, a homoglyph, or 41,000 characters, because such a name
 * "would read as a different structure on the approval card than the one that
 * gets hashed". The card, however, also prints names the gate never vetted — an
 * undeclared message key, an enum variant a value invented, the names inside a
 * payload the gate refused outright — and it prints values, which no encoder
 * constrains on the unsigned side. This module applies the gate's own grammar to
 * all of them:
 *
 * - a name that is not `isSafeSnip12Name` is replaced by a bracketed sketch of
 *   its ASCII letters. The brackets are non-ASCII, which the grammar forbids, so
 *   a sanitized name can never be confused with a name that passed;
 * - a value has its bidi controls, zero-width characters, and control codes
 *   replaced by their `\uXXXX` spelling, and backslashes doubled so that
 *   spelling is unambiguous, then is truncated to a readable length. The exact
 *   bytes stay available in the card's raw block, which is escaped the same way.
 *
 * Trust boundary: every argument is untrusted dapp input of any shape. Nothing
 * here throws, and nothing here decides whether a payload may be signed; it only
 * bounds what the card is able to display.
 */
import { isSafeSnip12Name } from "../starknet/snip12-vocabulary";

/**
 * The most rows one block prints before it collapses the rest into a single
 * "more values" line. Without a cap a site can put tens of screens of its own
 * key/value text between the not-signed banner and the decision controls, which
 * scrolls the banner — the whole point of the block — out of view.
 */
export const SIGN_ROW_LIMIT = 48;

const MAX_VALUE_TEXT = 256;
const MAX_NAME_SKETCH = 24;
const SAFE_NAME_CHARS = /[^A-Za-z0-9 _-]/g;

// Code points that move, hide, or reorder neighbouring text rather than adding
// any of their own: C0/C1 controls, the soft hyphen, the Arabic letter mark, the
// zero-width and directional-mark range, the line/paragraph separators, the
// bidi embedding/override range, the bidi isolates, and the byte-order mark.
const isDisplayHostile = (code: number): boolean =>
  code < 0x20 ||
  (code >= 0x7f && code <= 0x9f) ||
  code === 0xad ||
  code === 0x61c ||
  (code >= 0x200b && code <= 0x200f) ||
  code === 0x2028 ||
  code === 0x2029 ||
  (code >= 0x202a && code <= 0x202e) ||
  (code >= 0x2066 && code <= 0x2069) ||
  code === 0xfeff;

const escapeCodePoint = (character: string): string => {
  const code = character.codePointAt(0) ?? 0;
  return `\\u${code.toString(16).padStart(4, "0")}`;
};

const escapeDisplay = (text: string): string =>
  [...text]
    .map((character) => {
      if (character === "\\") {
        return "\\\\";
      }
      const code = character.codePointAt(0) ?? 0;
      return isDisplayHostile(code) ? escapeCodePoint(character) : character;
    })
    .join("");

/**
 * Renders one path segment — a declared field name, an undeclared key, an enum
 * variant name — as the card may print it. A name the SNIP-12 grammar accepts is
 * printed unchanged; anything else becomes a bracketed sketch of the characters
 * that grammar would have allowed, so a homoglyph or a bidi override is visibly
 * not the name it was imitating.
 *
 * Trust boundary: the argument is untrusted. This never throws, and the result
 * is plain text that still has to be escaped for HTML by the caller.
 */
export const signNameText = (name: string): string => {
  if (isSafeSnip12Name(name)) {
    return name;
  }
  const sketch = name.replace(SAFE_NAME_CHARS, "").slice(0, MAX_NAME_SKETCH);
  return `«${sketch.length > 0 ? sketch : "unnamed"}»`;
};

/**
 * Renders one row value as the card may print it: `—` for an absent value,
 * compact JSON for a structure, the value's own text otherwise — in every case
 * with display-hostile code points spelled out and the result truncated.
 *
 * Trust boundary: the argument is untrusted and may be any shape. This never
 * throws, and the result is plain text the caller still has to escape for HTML.
 */
export const signValueText = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "—";
  }
  const text = typeof value === "object" ? (JSON.stringify(value) ?? "—") : String(value);
  return truncateDisplay(escapeDisplay(text));
};

/**
 * Escapes the card's raw payload view the same way row values are escaped, so
 * the block that is meant to carry the exact bytes cannot itself be reordered by
 * a bidi override the rest of the card refuses to render.
 *
 * Trust boundary: the argument is untrusted text. This never throws and never
 * truncates — the raw block is where the full payload stays available.
 */
export const signRawText = (text: string): string => escapeDisplay(text);

const truncateDisplay = (text: string): string =>
  text.length <= MAX_VALUE_TEXT
    ? text
    : `${text.slice(0, MAX_VALUE_TEXT)}… (+${text.length - MAX_VALUE_TEXT} characters, see Raw typed data)`;
