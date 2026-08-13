/**
 * Shared JSON guards, plus the scalar grammars that travel inside those JSON
 * values, used at storage and extension message trust boundaries.
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
 * Narrows a property descriptor to an own enumerable data property — the only
 * shape a validator may read an untrusted value from. A missing key, a
 * non-enumerable key, or an accessor is rejected, so hostile input can never run
 * a getter (or return a different value on a second read) during validation.
 * This is the one shared predicate behind the JSON normalizers and the popup
 * response readers; do not re-derive it locally.
 */
export const isOwnDataProperty = (
  descriptor: PropertyDescriptor | undefined,
): descriptor is PropertyDescriptor => descriptor?.enumerable === true && "value" in descriptor;

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
    return isOwnDataProperty(descriptor) && descriptor.value !== undefined;
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

/**
 * Checks that an array carries nothing but `length` and its own in-range index
 * keys. An extra own property — `Object.defineProperty(list, "evil", …)`, a
 * symbol key, or an out-of-range index — makes the value fail, so a boundary
 * that validates by walking indices can never miss data a later consumer would
 * still read. Shared by the JSON normalizer and the popup consent-queue reader;
 * do not re-derive it locally.
 */
export const hasOnlyArrayEntries = (value: readonly unknown[]): boolean =>
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
    if (!isOwnDataProperty(descriptor)) {
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
    if (!isOwnDataProperty(descriptor)) {
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

const TOKEN_SYMBOL_PATTERN = /^[A-Z0-9]{2,12}$/;
// Every base-units integer the wallet handles is an on-chain u256 or smaller,
// so 78 digits is the widest one that can exist (2^256 - 1 has 78). The bound
// belongs in the grammar rather than at each call site: an unbounded digit
// string reaching `BigInt()` from a message boundary is work an untrusted caller
// chose the size of, and "each boundary caps it" only holds until one forgets.
const MAX_BASE_UNITS_DIGITS = 78;
const BASE_UNITS_PATTERN = new RegExp(`^(?:0|[1-9][0-9]{0,${MAX_BASE_UNITS_DIGITS - 1}})$`);
const DECIMAL_AMOUNT_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

/**
 * Checks a value is an uppercase token ticker of 2..12 alphanumerics — the
 * grammar the on-chain metadata reader, the watch-asset boundary, the stored
 * token entry, and the popup balance reader all have to agree on. The one
 * shared rule; do not re-derive the pattern locally (five copies once drifted,
 * so a symbol one layer stored was rejected by the next).
 */
export const isTokenSymbol = (value: unknown): value is string =>
  typeof value === "string" && TOKEN_SYMBOL_PATTERN.test(value);

/**
 * Checks a value is a canonical base-units integer string: digits only, no sign,
 * no leading zero, no exponent, so one amount has exactly one spelling, and at
 * most {@link MAX_BASE_UNITS_DIGITS} of them — the width of an on-chain u256,
 * so nothing legitimate is refused and no untrusted caller decides how much
 * `BigInt()` work the wallet does. Boundaries with a tighter limit still apply
 * it next to this call. The one shared grammar for raw amounts, fees, and
 * numeric NFT token ids; do not re-derive the pattern locally.
 */
export const isBaseUnitsAmount = (value: unknown): value is string =>
  typeof value === "string" && BASE_UNITS_PATTERN.test(value);

/**
 * Checks a value is a human-scale decimal amount as typed or displayed: a
 * canonical integer part plus an optional fractional part, never a sign or an
 * exponent. Scaling to base units happens later via `parseTokenAmount`. The one
 * shared grammar behind the transfer, swap, and privacy amount readers; do not
 * re-derive the pattern locally.
 */
export const isDecimalAmountText = (value: unknown): value is string =>
  typeof value === "string" && DECIMAL_AMOUNT_PATTERN.test(value);

// A chain descriptor's `id` and display name are free text a dapp chooses, so
// the only rules are "says something" and "cannot be used as a storage bomb".
// 256 raw characters is far past any real chain name and is the width the
// stored custom network was already built for.
const MAX_NETWORK_LABEL_LENGTH = 256;

/**
 * Checks a value is a custom-network label: a string of at most 256 characters
 * whose trimmed form says something. The one shared grammar for a chain
 * descriptor's `id` and display name, applied identically by the dapp-facing
 * `wallet_addStarknetChain` reader and by the stored-network validator, so a
 * descriptor the bridge accepts is always one the store can persist — trimming
 * only shortens a label, so the trimmed text the reader hands on still passes
 * this same bound. The size bound is measured on the raw string, never the
 * trimmed one: the raw string is what an untrusted runtime message carries and
 * what the store would persist if a lane forgot to trim, so a trimmed measure
 * would let megabytes of padding through the background re-validation. Do not
 * re-derive either half locally (two near-identical copies once differed on
 * whether the surrounding whitespace counted).
 */
export const isNetworkLabel = (value: unknown): value is string =>
  typeof value === "string" && value.length <= MAX_NETWORK_LABEL_LENGTH && value.trim().length > 0;

const RISK_FLAG_CODE_PATTERN = /^[a-z][a-z-]{1,40}$/;

/**
 * Checks a value is a reviewed-risk code: lowercase kebab-case, 2..41
 * characters. The vocabulary itself is owned by the verifier
 * (`starknet/verify`'s `RiskFlagCode`); this is only the lexical rule every
 * surface that re-reads a flag off the message boundary applies before
 * rendering it. The one shared spelling — do not re-derive the pattern locally,
 * or a code one screen shows becomes a code the next silently drops.
 */
export const isRiskFlagCode = (value: unknown): value is string =>
  typeof value === "string" && RISK_FLAG_CODE_PATTERN.test(value);

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
