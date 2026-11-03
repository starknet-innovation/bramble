/**
 * Strict JSON parsing: RFC 8259 grammar with the I-JSON restrictions, for
 * documents whose format forbids what `JSON.parse` tolerates. Every case
 * `JSON.parse` would silently accept is pinned as a refusal here.
 */
import { describe, expect, test } from "bun:test";
import { JSON_BUDGETS, type JsonBudget } from "@bramble/core/json";
import {
  parseStrictJson,
  parseStrictJsonBytes,
  type StrictJsonOptions,
  type StrictJsonRefusal,
} from "@bramble/core/strict-json";

const options: StrictJsonOptions = { budget: JSON_BUDGETS.provider, integersOnly: false };
const integers: StrictJsonOptions = { budget: JSON_BUDGETS.provider, integersOnly: true };

const refusal = (text: string, policy = options): StrictJsonRefusal | null => {
  const result = parseStrictJson(text, policy);
  return result.ok ? null : result.refusal;
};

describe("parseStrictJson", () => {
  test("parses every JSON value as JSON.parse does when the text is strict", () => {
    for (const text of [
      '{"a":[1,-2,3.5,1e3,true,false,null],"b":{"c":"d"},"e":""}',
      " \n\t\r[ ] ",
      '"\\"\\\\\\/\\b\\f\\n\\r\\t\\u0041\\ud83d\\ude00"',
      "0",
      "-12",
      "9007199254740991",
    ]) {
      expect(parseStrictJson(text, options)).toEqual({ ok: true, value: JSON.parse(text) });
    }
  });

  test("returns null-prototype objects, so __proto__ is only data", () => {
    const result = parseStrictJson('{"__proto__":{"polluted":true},"a":{}}', options);
    if (!result.ok) throw new Error(result.refusal);
    const value = result.value as Record<string, unknown>;
    expect(Object.getPrototypeOf(value)).toBeNull();
    expect(Object.getPrototypeOf(value["a"])).toBeNull();
    expect(Object.keys(value)).toEqual(["__proto__", "a"]);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  const refusals: readonly (readonly [string, string, StrictJsonRefusal])[] = [
    ["a duplicate member", '{"a":1,"a":2}', "duplicate-member"],
    ["a duplicate spelled by escape", '{"a":1,"\\u0061":2}', "duplicate-member"],
    ["a nested duplicate", '{"x":[{"k":1,"k":1}]}', "duplicate-member"],
    ["trailing data", '{"a":1} {"a":2}', "trailing-data"],
    ["a trailing literal", "truex", "trailing-data"],
    ["a lone high surrogate", '"\\ud800"', "invalid-encoding"],
    ["a lone low surrogate", '"\\udc00x"', "invalid-encoding"],
    ["an integer past 2^53 - 1", "9007199254740993", "unsafe-number"],
    ["an overflowing number", "1e400", "unsafe-number"],
    ["negative zero", "-0", "unsafe-number"],
    ["empty input", "", "invalid-syntax"],
    ["a trailing comma", "[1,]", "invalid-syntax"],
    ["a trailing member comma", '{"a":1,}', "invalid-syntax"],
    ["a leading zero", "[01]", "invalid-syntax"],
    ["a bare fraction", "[.5]", "invalid-syntax"],
    ["a plus sign", "[+1]", "invalid-syntax"],
    ["a single-quoted string", "['a']", "invalid-syntax"],
    ["an unquoted name", "{a:1}", "invalid-syntax"],
    ["a raw control character", '"a\u0001b"', "invalid-syntax"],
    ["an unknown escape", '"\\x41"', "invalid-syntax"],
    ["a short unicode escape", '"\\u41"', "invalid-syntax"],
    ["an unterminated string", '"abc', "invalid-syntax"],
    ["an unterminated array", "[1", "invalid-syntax"],
    ["a missing colon", '{"a" 1}', "invalid-syntax"],
    ["NaN", "NaN", "invalid-syntax"],
    ["a comment", "1 // one", "trailing-data"],
  ];
  for (const [name, text, expected] of refusals) {
    test(`refuses ${name}`, () => {
      expect(refusal(text)).toBe(expected);
    });
  }

  test("integers-only refuses every fraction and exponent, even integral ones", () => {
    for (const text of ["1.0", "1e0", "10E-1", "[0, 2.5]"]) {
      expect(refusal(text, integers)).toBe("non-integral-number");
    }
    expect(parseStrictJson("[0, -7, 2147483648]", integers)).toEqual({
      ok: true,
      value: [0, -7, 2147483648],
    });
  });

  test("enforces every budget bound as a refusal", () => {
    const tight: JsonBudget = {
      maxArrayLength: 2,
      maxBytes: 64,
      maxDepth: 2,
      maxNodes: 6,
      maxObjectKeys: 2,
      maxStringLength: 4,
    };
    const policy = { budget: tight, integersOnly: false };
    expect(refusal("[1,2]", policy)).toBeNull();
    expect(refusal("[1,2,3]", policy)).toBe("budget-exceeded");
    expect(refusal('{"a":1,"b":2,"c":3}', policy)).toBe("budget-exceeded");
    expect(refusal("[[1]]", policy)).toBeNull();
    expect(refusal("[[[1]]]", policy)).toBe("budget-exceeded");
    expect(refusal('"abcd"', policy)).toBeNull();
    expect(refusal('"abcde"', policy)).toBe("budget-exceeded");
    expect(refusal('"ab\\u0063de"', policy)).toBe("budget-exceeded");
    expect(refusal('{"abcde":1}', policy)).toBe("budget-exceeded");
    expect(refusal("[[1,1],[1,1]]", policy)).toBe("budget-exceeded");
    expect(refusal(" ".repeat(65), policy)).toBe("budget-exceeded");
  });

  test("never throws, even past the host stack under a careless budget", () => {
    const deep = `${"[".repeat(1_000_000)}${"]".repeat(1_000_000)}`;
    const budget = {
      ...JSON_BUDGETS.provider,
      maxBytes: deep.length,
      maxDepth: 2_000_000,
      maxNodes: 2_000_000,
    };
    expect(parseStrictJson(deep, { budget, integersOnly: false })).toEqual({
      ok: false,
      refusal: "budget-exceeded",
    });
  });
});

describe("parseStrictJsonBytes", () => {
  const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

  test("parses UTF-8 bytes, including multi-byte text", () => {
    expect(parseStrictJsonBytes(encode('{"name":"Zoë 😀"}'), options)).toEqual({
      ok: true,
      value: { name: "Zoë 😀" },
    });
  });

  test("refuses invalid UTF-8 and a byte-order mark instead of repairing them", () => {
    for (const bytes of [
      new Uint8Array([0x22, 0xc3, 0x28, 0x22]),
      new Uint8Array([0x22, 0xed, 0xa0, 0x80, 0x22]),
      new Uint8Array([0x22, 0xff, 0x22]),
      new Uint8Array([0xef, 0xbb, 0xbf, 0x31]),
    ]) {
      expect(parseStrictJsonBytes(bytes, options)).toEqual({
        ok: false,
        refusal: "invalid-encoding",
      });
    }
  });

  test("bounds the byte length before decoding", () => {
    const budget = { ...JSON_BUDGETS.provider, maxBytes: 3 };
    expect(parseStrictJsonBytes(encode('"é"'), { budget, integersOnly: false }).ok).toBe(false);
    expect(parseStrictJsonBytes(encode('"e"'), { budget, integersOnly: false }).ok).toBe(true);
  });
});
