/**
 * isJson rejects a plain object carrying a symbol own-key. Reflect.ownKeys —
 * unlike Object.entries — surfaces symbol keys, so the record validator's
 * non-string-key guard is a real (if contrived) reachable branch: a symbol-keyed
 * value is not JSON-serializable and must fail the gate.
 */
import { describe, expect, test } from "bun:test";
import { isJson } from "../../src/shared/json";

describe("isJson symbol-key guard", () => {
  test("rejects a plain record with a symbol own-key", () => {
    const withSymbol: Record<string, unknown> = { ok: true };
    (withSymbol as Record<symbol, unknown>)[Symbol("debug")] = true;

    expect(isJson(withSymbol)).toBe(false);
  });

  test("still accepts an equivalent record without the symbol key", () => {
    expect(isJson({ ok: true })).toBe(true);
  });
});
