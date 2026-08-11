/**
 * Shared JSON guards used at storage and extension message trust boundaries.
 */
export type JsonPrimitive = boolean | null | number | string;
/**
 * JSON-compatible value accepted by storage boundaries.
 */
export type Json = JsonPrimitive | { readonly [key: string]: Json } | readonly Json[];

/**
 * Structural resource budget for hostile JSON-like values. `maxBytes` is a
 * conservative upper bound on UTF-8 JSON serialization size: strings and keys
 * are charged at six bytes per UTF-16 code unit, which covers worst-case JSON
 * escaping without serializing the input first.
 */
export type JsonBudget = {
  readonly maxArrayLength: number;
  readonly maxBytes: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxObjectKeys: number;
  readonly maxStringLength: number;
};

/**
 * Single-sourced hostile-input budgets. General extension messages remain
 * small; typed data is tighter because hashing is CPU-intensive; contract
 * classes get a deliberate larger envelope without becoming unbounded.
 */
export const JSON_BUDGETS = {
  contractClass: {
    maxArrayLength: 100_000,
    maxBytes: 8 * 1024 * 1024,
    maxDepth: 64,
    maxNodes: 200_000,
    maxObjectKeys: 10_000,
    maxStringLength: 2 * 1024 * 1024,
  },
  provider: {
    maxArrayLength: 4_096,
    maxBytes: 1024 * 1024,
    maxDepth: 32,
    maxNodes: 50_000,
    maxObjectKeys: 2_048,
    maxStringLength: 512 * 1024,
  },
  strk20Proof: {
    maxArrayLength: 4_096,
    maxBytes: 8 * 1024 * 1024,
    maxDepth: 16,
    maxNodes: 50_000,
    maxObjectKeys: 32,
    maxStringLength: 512 * 1024,
  },
  typedData: {
    maxArrayLength: 1_024,
    maxBytes: 256 * 1024,
    maxDepth: 24,
    maxNodes: 10_000,
    maxObjectKeys: 512,
    maxStringLength: 64 * 1024,
  },
} as const satisfies Readonly<Record<string, JsonBudget>>;

/**
 * Checks for non-null object records from untrusted input.
 */
export const isRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/**
 * Checks that a parsed object contains only keys its boundary understands.
 */
export const hasOnlyKnownKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean =>
  Reflect.ownKeys(value).every((key) => {
    if (typeof key !== "string" || !keys.includes(key)) {
      return false;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return (
      descriptor?.enumerable === true && "value" in descriptor && descriptor.value !== undefined
    );
  });

const isArrayIndexKey = (key: string, length: number): boolean => {
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < length && String(index) === key;
};

const INVALID_JSON = Symbol("invalid-json");
type NormalizedJson = Json | typeof INVALID_JSON;
type NormalizationContext = {
  readonly ancestors: WeakSet<object>;
  readonly normalizeBigints: boolean;
  readonly tracker: JsonBudgetTracker;
};

class JsonBudgetTracker {
  private bytes = 0;
  private nodes = 0;

  public constructor(public readonly budget: JsonBudget) {}

  public consumeNode(): boolean {
    this.bytes += 32;
    this.nodes += 1;
    return this.bytes <= this.budget.maxBytes && this.nodes <= this.budget.maxNodes;
  }

  public consumeBytes(bytes: number): boolean {
    this.bytes += bytes;
    return this.bytes <= this.budget.maxBytes;
  }
}

const normalizeString = (value: string, tracker: JsonBudgetTracker): NormalizedJson =>
  value.length <= tracker.budget.maxStringLength && tracker.consumeBytes(2 + value.length * 6)
    ? value
    : INVALID_JSON;

const normalizeBigint = (value: bigint, context: NormalizationContext): NormalizedJson => {
  if (!context.normalizeBigints || value < 0n) {
    return INVALID_JSON;
  }
  return normalizeString(`0x${value.toString(16)}`, context.tracker);
};

const hasOnlyArrayEntries = (value: readonly unknown[]): boolean =>
  Reflect.ownKeys(value).every(
    (key) => key === "length" || (typeof key === "string" && isArrayIndexKey(key, value.length)),
  );

const normalizeJsonArray = (
  value: readonly unknown[],
  context: NormalizationContext,
  depth: number,
): NormalizedJson => {
  if (value.length > context.tracker.budget.maxArrayLength || !hasOnlyArrayEntries(value)) {
    return INVALID_JSON;
  }
  const normalized: Json[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (descriptor?.enumerable !== true || !("value" in descriptor)) {
      return INVALID_JSON;
    }
    const item = normalizeJsonValue(descriptor.value, context, depth + 1);
    if (item === INVALID_JSON) {
      return INVALID_JSON;
    }
    normalized.push(item);
  }
  return normalized;
};

const normalizeJsonRecord = (
  value: Record<string, unknown>,
  context: NormalizationContext,
  depth: number,
): NormalizedJson => {
  const keys = Reflect.ownKeys(value);
  if (keys.length > context.tracker.budget.maxObjectKeys) {
    return INVALID_JSON;
  }
  const normalizedEntries: Array<readonly [string, Json]> = [];
  for (const key of keys) {
    if (
      typeof key !== "string" ||
      key.length > context.tracker.budget.maxStringLength ||
      !context.tracker.consumeBytes(3 + key.length * 6)
    ) {
      return INVALID_JSON;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor?.enumerable !== true || !("value" in descriptor)) {
      return INVALID_JSON;
    }
    const item = normalizeJsonValue(descriptor.value, context, depth + 1);
    if (item === INVALID_JSON) {
      return INVALID_JSON;
    }
    normalizedEntries.push([key, item]);
  }
  // Object.fromEntries creates own data properties even for `__proto__` and
  // `constructor`; removing the prototype also prevents inherited collisions.
  return Object.setPrototypeOf(Object.fromEntries(normalizedEntries), null) as Record<string, Json>;
};

const normalizeJsonObject = (
  value: object | null,
  context: NormalizationContext,
  depth: number,
): NormalizedJson => {
  if (value === null || context.ancestors.has(value) || depth === context.tracker.budget.maxDepth) {
    return value === null ? null : INVALID_JSON;
  }
  context.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return normalizeJsonArray(value, context, depth);
    }
    return isRecord(value) ? normalizeJsonRecord(value, context, depth) : INVALID_JSON;
  } finally {
    context.ancestors.delete(value);
  }
};

const normalizeJsonValue = (
  value: unknown,
  context: NormalizationContext,
  depth: number,
): NormalizedJson => {
  if (!context.tracker.consumeNode() || depth > context.tracker.budget.maxDepth) {
    return INVALID_JSON;
  }
  switch (typeof value) {
    case "boolean":
      return value;
    case "string":
      return normalizeString(value, context.tracker);
    case "number":
      return Number.isFinite(value) && !Object.is(value, -0) ? value : INVALID_JSON;
    case "bigint":
      return normalizeBigint(value, context);
    case "object":
      return normalizeJsonObject(value, context, depth);
    default:
      return INVALID_JSON;
  }
};

const normalizeWithinBudget = (
  value: unknown,
  budget: JsonBudget,
  normalizeBigints: boolean,
): NormalizedJson => {
  try {
    return normalizeJsonValue(
      value,
      {
        ancestors: new WeakSet<object>(),
        normalizeBigints,
        tracker: new JsonBudgetTracker(budget),
      },
      0,
    );
  } catch {
    return INVALID_JSON;
  }
};

/**
 * Checks that a runtime value can be serialized as JSON without lossy numeric
 * coercion or exceeding the supplied hostile-input resource budget.
 */
export const isJsonWithinBudget = (
  value: unknown,
  budget: JsonBudget = JSON_BUDGETS.provider,
): value is Json => normalizeWithinBudget(value, budget, false) !== INVALID_JSON;

/**
 * Default bounded JSON guard used by extension and storage boundaries.
 */
export const isJson = (value: unknown): value is Json => isJsonWithinBudget(value);

/**
 * Checks for arrays containing only strings.
 */
export const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && isJson(value) && value.every((item) => typeof item === "string");

/**
 * Checks a value is a token decimals count: a non-negative safe integer within
 * the 0..36 range accepted at the watch-asset, preferences, and provider input
 * boundaries. The one shared bound — do not re-derive the `36` literal locally.
 */
export const isSafeDecimals = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 36;

/**
 * Checks that a list of strings has no duplicates. The one shared implementation
 * used by the storage and extension-message validators — do not re-derive it
 * locally (five copies once drifted across features).
 */
export const hasUniqueStrings = (values: readonly string[]): boolean =>
  new Set(values).size === values.length;

/**
 * Deep-coerces felt-shaped bigints to their canonical `0x`-hex string so a value
 * a dapp passes with bigint felts (get-starknet forwards `request` args
 * unserialized) survives the isJson gate instead of being dropped. A negative
 * bigint is not a felt, so it is left untouched and still fails isJson.
 */
export const normalizeFeltBigints = (
  value: unknown,
  budget: JsonBudget = JSON_BUDGETS.provider,
): Json | undefined => {
  const normalized = normalizeWithinBudget(value, budget, true);
  return normalized === INVALID_JSON ? undefined : normalized;
};
