/**
 * JSON guard checks prove trust boundaries reject prototype-shaped records.
 */
import { expect, test } from "bun:test";

import {
  hasOnlyKnownKeys,
  isJson,
  isJsonWithinBudget,
  isRecord,
  isStringArray,
  type JsonBudget,
  normalizeFeltBigints,
} from "../src/shared/json";

test("isRecord accepts only plain JSON records", () => {
  const inherited = Object.assign(Object.create({ target: "mc-wallet:content" }), {
    id: "123e4567-e89b-42d3-a456-426614174000",
    method: "mc_accounts",
  });
  const nullPrototype = Object.assign(Object.create(null), { ok: true });
  const symbolKey = { [Symbol("debug")]: true, ok: true };
  const hiddenKey = { ok: true };
  Object.defineProperty(hiddenKey, "debug", { value: true });
  const hiddenKnownKey = {};
  Object.defineProperty(hiddenKnownKey, "ok", { value: true });
  const accessorKnownKey = {};
  Object.defineProperty(accessorKnownKey, "ok", {
    enumerable: true,
    get() {
      return true;
    },
  });

  expect(isRecord({ ok: true })).toBe(true);
  expect(isRecord(nullPrototype)).toBe(true);
  expect(isRecord(inherited)).toBe(false);
  expect(hasOnlyKnownKeys({ ok: true }, ["ok"])).toBe(true);
  expect(hasOnlyKnownKeys({ ok: undefined }, ["ok"])).toBe(false);
  expect(hasOnlyKnownKeys(symbolKey, ["ok"])).toBe(false);
  expect(hasOnlyKnownKeys(hiddenKey, ["ok"])).toBe(false);
  expect(hasOnlyKnownKeys(hiddenKnownKey, ["ok"])).toBe(false);
  expect(hasOnlyKnownKeys(accessorKnownKey, ["ok"])).toBe(false);
});

test("isJson rejects values that stringify lossy JSON", () => {
  const hiddenKey = { ok: true };
  Object.defineProperty(hiddenKey, "debug", { value: true });
  const sparseArray = new Array<unknown>(2);
  sparseArray[0] = "one";
  const hiddenArrayKey = ["one"];
  Object.defineProperty(hiddenArrayKey, "debug", { value: true });
  const circularObject: Record<string, unknown> = {};
  circularObject["self"] = circularObject;
  const circularArray: unknown[] = [];
  circularArray.push(circularArray);
  const shared = { ok: true };

  expect(isJson({ count: 1, items: ["one", null, true] })).toBe(true);
  expect(isJson(["one", null, { count: 1 }])).toBe(true);
  expect(isJson({ first: shared, second: shared })).toBe(true);
  expect(isJson({ count: Number.NaN })).toBe(false);
  expect(isJson({ count: Number.POSITIVE_INFINITY })).toBe(false);
  expect(isJson({ count: -0 })).toBe(false);
  expect(isJson(hiddenKey)).toBe(false);
  expect(isJson(sparseArray)).toBe(false);
  expect(isJson(hiddenArrayKey)).toBe(false);
  expect(isJson(circularObject)).toBe(false);
  expect(isJson(circularArray)).toBe(false);
  expect(isJson({ value: BigInt(1) })).toBe(false);
});

test("isStringArray rejects sparse string arrays", () => {
  const sparseStrings = new Array<string>(1);

  expect(isStringArray(["one"])).toBe(true);
  expect(isStringArray(sparseStrings)).toBe(false);
  expect(isStringArray(["one", 2])).toBe(false);
});

test("hostile JSON resource budgets fail closed before expensive consumers", () => {
  const tiny: JsonBudget = {
    maxArrayLength: 2,
    maxBytes: 200,
    maxDepth: 2,
    maxNodes: 5,
    maxObjectKeys: 2,
    maxStringLength: 8,
  };
  const deep = { one: { two: { three: true } } };
  const wide = { one: 1, three: 3, two: 2 };

  expect(isJsonWithinBudget(["one", "two"], tiny)).toBe(true);
  expect(isJsonWithinBudget(["one", "two", "three"], tiny)).toBe(false);
  expect(isJsonWithinBudget({ value: "x".repeat(9) }, tiny)).toBe(false);
  expect(isJsonWithinBudget(deep, tiny)).toBe(false);
  expect(isJsonWithinBudget(wide, tiny)).toBe(false);
});

test("bounded normalization never executes accessors and rejects cycles", () => {
  let getterCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, "value", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 1n;
    },
  });
  const cyclic: Record<string, unknown> = {};
  cyclic["self"] = cyclic;

  expect(normalizeFeltBigints({ value: 15n })).toEqual({ value: "0xf" });
  expect(normalizeFeltBigints(accessor)).toBeUndefined();
  expect(normalizeFeltBigints(cyclic)).toBeUndefined();
  expect(getterCalls).toBe(0);
});
