/**
 * JSON guard checks prove trust boundaries reject prototype-shaped records.
 */
import { expect, test } from "bun:test";

import { hasOnlyKnownKeys, isJson, isRecord } from "../src/shared/json";

test("isRecord accepts only plain JSON records", () => {
  const inherited = Object.assign(Object.create({ target: "mc-wallet:content" }), {
    id: "123e4567-e89b-42d3-a456-426614174000",
    method: "mc_accounts",
  });
  const nullPrototype = Object.assign(Object.create(null), { ok: true });
  const symbolKey = { [Symbol("debug")]: true, ok: true };
  const hiddenKey = { ok: true };
  Object.defineProperty(hiddenKey, "debug", { value: true });

  expect(isRecord({ ok: true })).toBe(true);
  expect(isRecord(nullPrototype)).toBe(true);
  expect(isRecord(inherited)).toBe(false);
  expect(hasOnlyKnownKeys({ ok: true }, ["ok"])).toBe(true);
  expect(hasOnlyKnownKeys(symbolKey, ["ok"])).toBe(false);
  expect(hasOnlyKnownKeys(hiddenKey, ["ok"])).toBe(false);
});

test("isJson rejects values that stringify lossy JSON", () => {
  const hiddenKey = { ok: true };
  Object.defineProperty(hiddenKey, "debug", { value: true });
  const sparseArray = new Array<unknown>(2);
  sparseArray[0] = "one";
  const hiddenArrayKey = ["one"];
  Object.defineProperty(hiddenArrayKey, "debug", { value: true });
  const circularObject: Record<string, unknown> = {};
  circularObject.self = circularObject;
  const circularArray: unknown[] = [];
  circularArray.push(circularArray);
  const shared = { ok: true };

  expect(isJson({ count: 1, items: ["one", null, true] })).toBe(true);
  expect(isJson(["one", null, { count: 1 }])).toBe(true);
  expect(isJson({ first: shared, second: shared })).toBe(true);
  expect(isJson({ count: Number.NaN })).toBe(false);
  expect(isJson({ count: Number.POSITIVE_INFINITY })).toBe(false);
  expect(isJson(hiddenKey)).toBe(false);
  expect(isJson(sparseArray)).toBe(false);
  expect(isJson(hiddenArrayKey)).toBe(false);
  expect(isJson(circularObject)).toBe(false);
  expect(isJson(circularArray)).toBe(false);
  expect(isJson({ value: BigInt(1) })).toBe(false);
});
