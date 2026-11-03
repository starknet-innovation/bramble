/**
 * Strict JSON text parsing for untrusted documents whose format forbids what
 * `JSON.parse` silently tolerates.
 *
 * `JSON.parse` keeps the last of two members with the same name, so a document
 * can show one value to a reviewer and hand another to the wallet; it also
 * rounds integers past 2^53 to a nearby value and accepts lone UTF-16
 * surrogates. A portable record that crosses wallets (the QSB recovery
 * manifest is the first) must be rejected for any of those, not
 * reinterpreted. This parser implements RFC 8259 grammar with the I-JSON
 * (RFC 7493) restrictions on top: no duplicate member names, no lone
 * surrogates, no number a double cannot hold exactly, and nothing after the
 * value but whitespace.
 *
 * Pure and leaf-level: no clock, randomness, storage, or network. It never
 * throws for any input; every refusal is a typed result. Objects come back
 * with a null prototype, so a `__proto__` member is plain data and cannot
 * reach a prototype. It interprets no meaning: the caller still validates the
 * returned value into its own type.
 */
import type { Json, JsonBudget } from "./json";

/**
 * Why strict parsing refused its input. A code, not copy:
 * - `budget-exceeded`: past a {@link JsonBudget} bound (size, depth, nodes,
 *   array length, member count, or string length);
 * - `duplicate-member`: one object names a member twice (compared decoded, so
 *   `"a"` and `"a"` collide);
 * - `invalid-encoding`: bytes that are not UTF-8, a byte-order mark, or a lone
 *   surrogate in a string;
 * - `invalid-syntax`: anything RFC 8259 does not admit;
 * - `non-integral-number`: a fraction or exponent where the caller required
 *   integers only;
 * - `trailing-data`: anything but whitespace after the value;
 * - `unsafe-number`: a number a double cannot represent exactly as written (an
 *   integer past 2^53 - 1, a non-finite value) or negative zero.
 */
export type StrictJsonRefusal =
  | "budget-exceeded"
  | "duplicate-member"
  | "invalid-encoding"
  | "invalid-syntax"
  | "non-integral-number"
  | "trailing-data"
  | "unsafe-number";

/**
 * Outcome of a strict parse: the value, or the single reason it was refused.
 */
export type StrictJsonResult =
  | { readonly ok: true; readonly value: Json }
  | { readonly ok: false; readonly refusal: StrictJsonRefusal };

/**
 * Caller policy for one strict parse. `budget.maxBytes` bounds the input
 * length (UTF-16 code units for text, bytes for {@link parseStrictJsonBytes}),
 * `maxDepth` how many containers may enclose a value (the root sits at depth
 * 0), `maxNodes` the values in total, `maxStringLength` each decoded string
 * including member names, and `maxArrayLength` and `maxObjectKeys` each
 * container. `integersOnly` refuses every fraction and exponent, for formats
 * whose numbers are all integers, so `1.0` and `1e0` cannot stand in for `1`.
 */
export type StrictJsonOptions = {
  readonly budget: JsonBudget;
  readonly integersOnly: boolean;
};

class StrictJsonRefused extends Error {
  public constructor(public readonly refusal: StrictJsonRefusal) {
    super(refusal);
  }
}

const refuse = (refusal: StrictJsonRefusal): never => {
  throw new StrictJsonRefused(refusal);
};

const NUMBER_PATTERN = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
const INTEGER_LEXEME = /^-?(?:0|[1-9][0-9]*)$/;
const HEX4_PATTERN = /^[0-9a-fA-F]{4}$/;
const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  "/": "/",
  "\\": "\\",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

const isWhitespace = (code: number): boolean =>
  code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

// True when every surrogate code unit is half of a well-formed pair.
const isWellFormedText = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (isHighSurrogate(code) && isLowSurrogate(value.charCodeAt(index + 1))) {
      index += 1;
    } else if (isHighSurrogate(code) || isLowSurrogate(code)) {
      return false;
    }
  }
  return true;
};

const numberValue = (lexeme: string, integersOnly: boolean): number => {
  const integral = INTEGER_LEXEME.test(lexeme);
  if (integersOnly && !integral) {
    return refuse("non-integral-number");
  }
  const value = Number(lexeme);
  const exact = integral ? Number.isSafeInteger(value) : Number.isFinite(value);
  return exact && !Object.is(value, -0) ? value : refuse("unsafe-number");
};

class StrictJsonReader {
  private index = 0;
  private nodes = 0;

  public constructor(
    private readonly text: string,
    private readonly options: StrictJsonOptions,
  ) {}

  public document(): Json {
    const value = this.value(0);
    this.skipWhitespace();
    return this.index === this.text.length ? value : refuse("trailing-data");
  }

  private get budget(): JsonBudget {
    return this.options.budget;
  }

  private skipWhitespace(): void {
    while (isWhitespace(this.text.charCodeAt(this.index))) {
      this.index += 1;
    }
  }

  private consume(char: string): boolean {
    this.skipWhitespace();
    if (this.text[this.index] !== char) {
      return false;
    }
    this.index += 1;
    return true;
  }

  private expect(char: string): void {
    if (!this.consume(char)) {
      refuse("invalid-syntax");
    }
  }

  private value(depth: number): Json {
    this.nodes += 1;
    if (depth > this.budget.maxDepth || this.nodes > this.budget.maxNodes) {
      return refuse("budget-exceeded");
    }
    this.skipWhitespace();
    switch (this.text[this.index]) {
      case "{":
        return this.object(depth);
      case "[":
        return this.array(depth);
      case '"':
        return this.string();
      case "t":
        return this.literal("true", true);
      case "f":
        return this.literal("false", false);
      case "n":
        return this.literal("null", null);
      default:
        return this.number();
    }
  }

  private literal(word: string, value: boolean | null): boolean | null {
    if (!this.text.startsWith(word, this.index)) {
      return refuse("invalid-syntax");
    }
    this.index += word.length;
    return value;
  }

  private number(): number {
    NUMBER_PATTERN.lastIndex = this.index;
    const match = NUMBER_PATTERN.exec(this.text);
    if (match === null) {
      return refuse("invalid-syntax");
    }
    this.index += match[0].length;
    return numberValue(match[0], this.options.integersOnly);
  }

  private array(depth: number): Json[] {
    this.expect("[");
    const items: Json[] = [];
    if (this.consume("]")) {
      return items;
    }
    do {
      if (items.length === this.budget.maxArrayLength) {
        refuse("budget-exceeded");
      }
      items.push(this.value(depth + 1));
    } while (this.consume(","));
    this.expect("]");
    return items;
  }

  private object(depth: number): Record<string, Json> {
    this.expect("{");
    const record: Record<string, Json> = Object.create(null);
    const names = new Set<string>();
    if (this.consume("}")) {
      return record;
    }
    do {
      this.member(record, names, depth);
    } while (this.consume(","));
    this.expect("}");
    return record;
  }

  private member(record: Record<string, Json>, names: Set<string>, depth: number): void {
    this.skipWhitespace();
    if (this.text[this.index] !== '"') {
      refuse("invalid-syntax");
    }
    const name = this.string();
    if (names.has(name)) {
      refuse("duplicate-member");
    }
    if (names.size === this.budget.maxObjectKeys) {
      refuse("budget-exceeded");
    }
    names.add(name);
    this.expect(":");
    Object.defineProperty(record, name, {
      configurable: true,
      enumerable: true,
      value: this.value(depth + 1),
      writable: true,
    });
  }

  private string(): string {
    this.index += 1;
    let decoded = this.plainRun();
    // plainRun stops only on a quote or a backslash.
    while (this.text.charCodeAt(this.index) === 0x5c) {
      this.index += 1;
      decoded += this.escape() + this.plainRun();
      if (decoded.length > this.budget.maxStringLength) {
        refuse("budget-exceeded");
      }
    }
    this.index += 1;
    if (decoded.length > this.budget.maxStringLength) {
      refuse("budget-exceeded");
    }
    return isWellFormedText(decoded) ? decoded : refuse("invalid-encoding");
  }

  // Reads unescaped characters up to the next quote or backslash; a control
  // character or the end of input inside a string is a syntax error.
  private plainRun(): string {
    const start = this.index;
    let code = this.text.charCodeAt(this.index);
    while (code !== 0x22 && code !== 0x5c) {
      if (Number.isNaN(code) || code < 0x20) {
        refuse("invalid-syntax");
      }
      this.index += 1;
      code = this.text.charCodeAt(this.index);
    }
    return this.text.slice(start, this.index);
  }

  private escape(): string {
    const char = this.text[this.index] ?? "";
    this.index += 1;
    const simple = SIMPLE_ESCAPES[char];
    if (simple !== undefined) {
      return simple;
    }
    const hex = this.text.slice(this.index, this.index + 4);
    if (char !== "u" || !HEX4_PATTERN.test(hex)) {
      return refuse("invalid-syntax");
    }
    this.index += 4;
    return String.fromCharCode(Number.parseInt(hex, 16));
  }
}

/**
 * Parses untrusted JSON text under the strict rules above. Total for every
 * string: a refusal is returned, never thrown, and no partial value escapes.
 * An input longer than `budget.maxBytes` is refused before any parsing work.
 */
export const parseStrictJson = (text: string, options: StrictJsonOptions): StrictJsonResult => {
  if (text.length > options.budget.maxBytes) {
    return { ok: false, refusal: "budget-exceeded" };
  }
  try {
    return { ok: true, value: new StrictJsonReader(text, options).document() };
  } catch (error) {
    if (error instanceof StrictJsonRefused) {
      return { ok: false, refusal: error.refusal };
    }
    // A host-level failure (stack exhaustion past an unusually deep budget) is
    // still a refusal of this document, never a crash of its caller.
    return { ok: false, refusal: "budget-exceeded" };
  }
};

/**
 * Parses untrusted UTF-8 bytes under the strict rules above. Invalid UTF-8 and
 * a byte-order mark are refused as `invalid-encoding` rather than replaced or
 * skipped, so the bytes a user exported are exactly the text that was checked.
 * The byte length is bounded by `budget.maxBytes` before decoding.
 */
export const parseStrictJsonBytes = (
  bytes: Uint8Array,
  options: StrictJsonOptions,
): StrictJsonResult => {
  if (bytes.length > options.budget.maxBytes) {
    return { ok: false, refusal: "budget-exceeded" };
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return { ok: false, refusal: "invalid-encoding" };
  }
  return text.charCodeAt(0) === 0xfeff
    ? { ok: false, refusal: "invalid-encoding" }
    : parseStrictJson(text, options);
};
