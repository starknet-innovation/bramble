/**
 * The one type-directed reading of a SNIP-12 leaf value: what the pinned
 * library's `encodeValue` would actually put into the message hash for a value
 * declared under a given basic type, on a given revision.
 *
 * Both the hashing gate (`./typed-data-values`) and the approval card
 * (`@bramble/wallet-ui`'s `sidepanel/shared/sign-request-decode`) resolve every scalar through this one
 * function, so what the wallet agrees to hash and what the card says it is
 * hashing are the same reading rather than two guesses that can drift.
 *
 * The reading has to be type-directed because the library's is not symmetric.
 * `getHex` tries `BigInt(value)` first and falls back to `encodeShortString`,
 * so on revision 0 — which range-checks nothing — a `u128` field accepts the
 * prose "no fee required" and hashes it as the 128-bit number
 * `0x6e6f20666565207265717569726564`, and on both revisions a `felt` field
 * accepts the string "false" and hashes it as the nonzero felt `0x66616c7365`
 * while a boolean `false` hashes as `0x0`. A validator that only asks "is this a
 * scalar" therefore admits a value whose signed meaning is a large number while
 * the receipt reads as a sentence or as `false`.
 *
 * Two rules close that:
 *
 * - each type admits only the JavaScript shapes that type can mean. Numeric
 *   types (`u128`, `i128`, `timestamp`, `ClassHash`, `ContractAddress`) take
 *   canonical numeric text or a safe integer and nothing else; `bool` takes a
 *   boolean and nothing else; the short-string types (`felt`, `shortstring`,
 *   and `string` on revision 0) take either canonical numeric text or printable
 *   ASCII the library's own `BigInt` would refuse — never a spelling such as
 *   `" 12 "` or `"0b101"` that this module would read as text and the library
 *   would read as a number;
 * - every accepted value carries the canonical felt it encodes to, so the card
 *   can print the authorized number beside the text the site wrote.
 *
 * Ranges are enforced on both revisions even though revision 0 checks none:
 * a value outside its declared type's range is a lie about the type, and on
 * revision 0 it would reach the hash unchallenged.
 *
 * Trust boundary: `value` is untrusted dapp input of any shape. Nothing here
 * throws, nothing here hashes, and a null result means the declared type cannot
 * describe the value — the gate must refuse it and the card must not present it
 * as signed content.
 */

import { canonicalFelt, STARK_FIELD_PRIME, UINT128_LIMIT } from "@bramble/wallet-model/networks";
import { typedData as snip12 } from "starknet";
import type { Snip12Revision } from "./snip12-vocabulary";

/**
 * Marks an object as a scalar this module produced. A symbol key cannot appear
 * in a payload parsed from a site's JSON, so a decoded row carrying it is one
 * the decoder built and never one a site handed over pretending to be one.
 */
export const SNIP12_SCALAR: unique symbol = Symbol("snip12-scalar");

/**
 * How a scalar must be read on screen. The kind is the display form, not the
 * declared type: `integer` is meaningful as a decimal amount, `felt` as a hex
 * field element, and the quoted kinds carry site-chosen text that has to be
 * shown as text *and* accompanied by the felt it encodes to.
 */
export type Snip12ScalarKind = "boolean" | "bytestring" | "felt" | "integer" | "selector" | "text";

/**
 * One leaf value resolved against its declared type: the type as declared, the
 * canonical felt the pinned library's own encoder produces for it (the
 * `ByteArray` hash for a revision 1 `string`), the display form, and the text a
 * renderer should show. `encoded` is never absent, so a receipt built from these
 * always states the value the account would authorize even when the text beside
 * it is truncated.
 */
export type Snip12Scalar = {
  readonly [SNIP12_SCALAR]: true;
  readonly encoded: string;
  readonly kind: Snip12ScalarKind;
  readonly text: string;
  readonly type: string;
};

// A felt is at most 66 characters as hex and 78 as decimal. Anything longer is
// out of range by construction, and refusing it before `BigInt` keeps a 64KB
// string — which the JSON budget admits — from being parsed at all.
const MAX_NUMERIC_TEXT = 80;
// `encodeShortString` refuses anything longer, and the library would throw.
const MAX_SHORT_STRING = 31;
// An entry point name is an identifier, not a sentence; the SNIP-12 name bound
// is the same 64 characters.
const MAX_SELECTOR_NAME = 64;

const DECIMAL_TEXT = /^-?[0-9]+$/;
const HEX_TEXT = /^0[xX][0-9a-fA-F]+$/;
const SELECTOR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const I128_LIMIT = 1n << 127n;

// Printable ASCII only. `encodeShortString` admits every code point below 0x80,
// but a control character inside a signed short string is a display trick with
// no legitimate use, and the iteration is over code points so an astral
// character cannot slip through as a surrogate pair.
const isPrintableAscii = (text: string): boolean =>
  [...text].every((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code >= 0x20 && code <= 0x7e;
  });

// Exactly the library's own first step: `getHex` reads a value as a number when
// `BigInt` accepts it, whatever it looks like. Used to prove a value the
// short-string branch would encode as text is one the library would too.
const parsesAsNumber = (value: string): boolean => {
  try {
    BigInt(value);
    return true;
  } catch {
    return false;
  }
};

// The canonical numeric readings this module admits: a safe integer, or text
// that is unambiguously decimal or `0x` hex, signed only where the declared type
// can hold a negative. Deliberately narrower than `BigInt` — `""`, `" 12 "`,
// `"+12"`, `"0b101"`, `"0o17"` and `"-0"` all parse there, and each is a second
// spelling of a number whose only use is to read as something else on screen.
const numericValue = (value: unknown, signed: boolean): bigint | null => {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && (signed || !Object.is(value, -0)) ? BigInt(value) : null;
  }
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_NUMERIC_TEXT) {
    return null;
  }
  if (!signed && value.startsWith("-")) {
    return null;
  }
  if (!DECIMAL_TEXT.test(value) && !HEX_TEXT.test(value)) {
    return null;
  }
  try {
    return BigInt(value);
  } catch {
    return null;
  }
};

// The felt this module reports is the library's own leaf encoding of the value,
// not a second implementation of it: `encodeValue` with an empty type map
// resolves no struct and no preset, so for a basic type it is exactly the leaf
// encoder the message hash is built from. Canonicalized on the way out — the
// selector branch hands back the site's own hex spelling untouched — so two
// accepted spellings of one felt cannot render as two different receipts.
//
// A throw here means the library would refuse the value; the callers below have
// already refused everything they are unwilling to display, so this is the last
// fail-closed step rather than the policy.
const encodedBy = (value: unknown, type: string, revision: Snip12Revision): string | null => {
  try {
    const [, encoded] = snip12.encodeValue(
      {},
      type,
      value as never,
      undefined,
      revision as never,
    ) as readonly [string, unknown];
    return typeof encoded === "string" ? canonicalFelt(encoded) : null;
  } catch {
    return null;
  }
};

// The one place a scalar is built. A null `text` means "show the encoding
// itself", which is what a hex-shaped type reads as.
const scalar = (
  value: unknown,
  type: string,
  revision: Snip12Revision,
  kind: Snip12ScalarKind,
  text: string | null,
): Snip12Scalar | null => {
  const encoded = encodedBy(value, type, revision);
  return encoded === null
    ? null
    : { [SNIP12_SCALAR]: true, encoded, kind, text: text ?? encoded, type };
};

// A whole-number type: canonical numeric input inside the type's own range,
// reported as a decimal amount beside the felt it encodes to.
const boundedInteger = (
  value: unknown,
  type: string,
  revision: Snip12Revision,
  min: bigint,
  max: bigint,
): Snip12Scalar | null => {
  const parsed = numericValue(value, min < 0n);
  if (parsed === null || parsed < min || parsed > max) {
    return null;
  }
  return scalar(value, type, revision, "integer", parsed.toString(10));
};

// An address-shaped type: canonical numeric input inside the field, reported as
// the hex felt it is. The row text is the encoding itself, so every accepted
// spelling of one address — `0x0ab`, `0xAB`, `171` — reads as one row.
const boundedFelt = (
  value: unknown,
  type: string,
  revision: Snip12Revision,
): Snip12Scalar | null => {
  const parsed = numericValue(value, false);
  return parsed === null || parsed >= STARK_FIELD_PRIME
    ? null
    : scalar(value, type, revision, "felt", null);
};

// The short-string family. `getHex` reads a number when it can and falls back to
// `encodeShortString`, so a number is read here first for exactly the same
// reason, and the text branch admits only values the library's own `BigInt`
// refuses — otherwise this module would report a short string where the library
// hashed a number.
const shortStringOrNumber = (
  value: unknown,
  type: string,
  revision: Snip12Revision,
): Snip12Scalar | null => {
  const numeric = boundedFelt(value, type, revision);
  if (numeric !== null) {
    return numeric;
  }
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_SHORT_STRING &&
    isPrintableAscii(value) &&
    !parsesAsNumber(value)
    ? scalar(value, type, revision, "text", value)
    : null;
};

// `prepareSelector` passes a hex value straight through and otherwise hashes the
// value as an entry point name, so both spellings reach one felt and both are
// reported with that felt beside them.
const selectorScalar = (value: unknown, revision: Snip12Revision): Snip12Scalar | null => {
  if (typeof value !== "string") {
    return null;
  }
  if (HEX_TEXT.test(value)) {
    return boundedFelt(value, "selector", revision);
  }
  return value.length <= MAX_SELECTOR_NAME && SELECTOR_NAME.test(value)
    ? scalar(value, "selector", revision, "selector", value)
    : null;
};

/**
 * Resolves an untrusted leaf value against the type its payload declares for it
 * and the revision the payload would be hashed under, reporting the canonical
 * felt the pinned library would hash and the form the value must be shown in.
 *
 * Trust boundary: `value` is untrusted dapp input of any shape. This never
 * throws and never hashes. A null result means the declared type cannot describe
 * the value — either the library would refuse it, or it would encode it as
 * something other than what it reads as — so the caller must refuse to sign it
 * and must not present it as signed content.
 */
export const snip12Scalar = (
  value: unknown,
  type: string,
  revision: Snip12Revision,
): Snip12Scalar | null => {
  switch (type) {
    case "bool":
      // Revision 1 asserts the value is a boolean; revision 0 would hash any
      // scalar under the type, which is exactly how `"false"` becomes nonzero.
      return typeof value === "boolean"
        ? scalar(value, type, revision, "boolean", String(value))
        : null;
    case "string":
      // Only revision 1 hashes a `string` as a `ByteArray` — over 31-character
      // chunks that are themselves short strings, so it is ASCII-only too.
      // Revision 0 falls through to `getHex`, which is the short-string family.
      return revision === "0"
        ? shortStringOrNumber(value, type, revision)
        : typeof value === "string" && isPrintableAscii(value)
          ? scalar(value, type, revision, "bytestring", value)
          : null;
    case "felt":
    case "shortstring":
      return shortStringOrNumber(value, type, revision);
    case "selector":
      return selectorScalar(value, revision);
    case "timestamp":
    case "u128":
      return boundedInteger(value, type, revision, 0n, UINT128_LIMIT - 1n);
    case "i128":
      // A negative `i128` is only encodable on revision 1, where the encoder
      // wraps it into the field; revision 0 would emit the unparsable `0x-1`.
      // Both revisions keep the `i128` ceiling (Sherlock 229): a larger value
      // is not an `i128`, whatever the field could hold.
      return revision === "1"
        ? boundedInteger(value, type, revision, -I128_LIMIT, I128_LIMIT - 1n)
        : boundedInteger(value, type, revision, 0n, I128_LIMIT - 1n);
    case "ClassHash":
    case "ContractAddress":
      return boundedFelt(value, type, revision);
    default:
      // Revision 1 throws on an unknown leaf type and revision 0 silently
      // coerces it to a felt; the graph gate admits neither, and a card
      // rendering a refused payload must not claim to know what it covers.
      return null;
  }
};

/**
 * Checks whether a decoded row value is a scalar this module produced.
 *
 * Trust boundary: the argument may be untrusted site data. The brand is a
 * symbol, which no parsed JSON can carry, so a site cannot forge one.
 */
export const isSnip12Scalar = (value: unknown): value is Snip12Scalar =>
  typeof value === "object" && value !== null && SNIP12_SCALAR in value;
