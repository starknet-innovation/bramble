/**
 * The bramble-ff v1 document contract, as the wallet reads it: constants,
 * types, and a closed-world validator for a signed payload.
 *
 * Mirrors `src/schema.ts` in the bramble-ff repository (the publisher's
 * authority). Every object is checked for exact keys, so an unknown field at
 * any level is a rejection, never something silently ignored. Flag *keys* the
 * wallet does not know are a different matter: they are valid on the wire and
 * dropped later by `evaluate.ts`, because the publisher serves several wallet
 * versions from one published file.
 *
 * Pure: no clock, no network, no storage. Throws {@link FlagContractError} on
 * any violation; callers translate that into "keep the last good document".
 */
import { HTTP_BODY_LIMITS } from "@mc-wallet/core/http-json";
import { hasOnlyKnownKeys, isRecord } from "@mc-wallet/core/json";

/** The only document schema this build understands. */
export const FLAG_SCHEMA_VERSION = 1;

/**
 * Hard ceiling on a published document, checked on the encoded bytes before
 * parsing. Single-sourced with the HTTP read budget so the transport and the
 * verifier can never disagree about what "too large" means.
 */
export const MAX_FLAG_DOCUMENT_BYTES = HTTP_BODY_LIMITS.flagDocument;

/** Rollout is expressed in basis points: 10000 means everyone. */
export const MAX_ROLLOUT = 10_000;

/** Release channels the publisher signs documents for. */
export const FLAG_CHANNELS = ["production", "beta", "development"] as const;

/** Chains a flag may be restricted to. Custom networks and devnet never match. */
export const FLAG_CHAINS = ["SN_MAIN", "SN_SEPOLIA"] as const;

/** A publisher release channel. */
export type FlagChannel = (typeof FLAG_CHANNELS)[number];

/** A chain id a flag rule may target. */
export type FlagChain = (typeof FLAG_CHAINS)[number];

/** One remote flag rule after validation. */
export type FlagRule = {
  readonly chains?: readonly FlagChain[];
  readonly enabled: boolean;
  readonly maxVersion?: string;
  readonly minVersion?: string;
  readonly rollout?: number;
};

/** A signed, validated document payload. */
export type FlagPayload = {
  readonly channel: FlagChannel;
  readonly expiresAt: number;
  readonly flags: Readonly<Record<string, FlagRule>>;
  readonly issuedAt: number;
  readonly schema: typeof FLAG_SCHEMA_VERSION;
  readonly sequence: number;
};

/** Raised for any contract violation; carries no document content. */
export class FlagContractError extends Error {
  override readonly name = "FlagContractError";
}

const FLAG_KEY_PATTERN = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*){1,3}$/;
const MAX_FLAG_KEY_LENGTH = 64;
const MAX_FLAGS = 64;
const MAX_TTL_MS = 90 * 86_400_000;
const SEMVER_PATTERN = /^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$/;
const TIMESTAMP_PATTERN = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})Z$/;
const PAYLOAD_KEYS = ["channel", "expiresAt", "flags", "issuedAt", "schema", "sequence"];
const RULE_KEYS = ["chains", "enabled", "maxVersion", "minVersion", "rollout"];

const fail = (message: string): never => {
  throw new FlagContractError(message);
};

/** Returns whether a string is a well-formed flag key under the v1 grammar. */
export const isFlagKey = (key: string): boolean =>
  key.length <= MAX_FLAG_KEY_LENGTH && FLAG_KEY_PATTERN.test(key);

/** Returns whether a string is a strict `x.y.z` version. */
export const isFlagVersion = (value: unknown): value is string =>
  typeof value === "string" && SEMVER_PATTERN.test(value);

/** Orders two strict `x.y.z` versions; both must satisfy {@link isFlagVersion}. */
export const compareFlagVersions = (left: string, right: string): number => {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) {
      return delta < 0 ? -1 : 1;
    }
  }
  return 0;
};

const daysInMonth = (year: number, month: number): number =>
  month === 2
    ? year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
      ? 29
      : 28
    : [4, 6, 9, 11].includes(month)
      ? 30
      : 31;

/**
 * Parses a strict `YYYY-MM-DDTHH:MM:SSZ` timestamp to epoch milliseconds,
 * rejecting impossible calendar dates (2026-02-30) rather than rolling them.
 */
export const parseFlagTimestamp = (value: unknown): number => {
  const match = typeof value === "string" ? TIMESTAMP_PATTERN.exec(value) : null;
  if (!match) {
    return fail("timestamp must be YYYY-MM-DDTHH:MM:SSZ");
  }
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return fail("timestamp is not a real date/time");
  }
  return Date.UTC(year, month - 1, day, hour, minute, second);
};

const readInteger = (value: unknown, min: number, max: number, what: string): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max
    ? value
    : fail(`${what} must be an integer in [${min}, ${max}]`);

const readOneOf = <T extends string>(value: unknown, options: readonly T[], what: string): T =>
  typeof value === "string" && (options as readonly string[]).includes(value)
    ? (value as T)
    : fail(`${what} is not allowed`);

const readChains = (value: unknown): readonly FlagChain[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > FLAG_CHAINS.length) {
    return fail("chains must be a non-empty array");
  }
  const chains = value.map((chain) => readOneOf(chain, FLAG_CHAINS, "chain"));
  return new Set(chains).size === chains.length ? chains : fail("chains must be unique");
};

const readVersion = (value: unknown): string =>
  isFlagVersion(value) ? value : fail("version must be x.y.z");

const parseRule = (value: unknown): FlagRule => {
  if (!isRecord(value) || !hasOnlyKnownKeys(value, RULE_KEYS)) {
    return fail("flag rule has an unknown or malformed field");
  }
  if (typeof value["enabled"] !== "boolean") {
    return fail("flag rule needs a boolean enabled");
  }
  const has = (key: string): boolean => Object.hasOwn(value, key);
  const minVersion = has("minVersion") ? readVersion(value["minVersion"]) : undefined;
  const maxVersion = has("maxVersion") ? readVersion(value["maxVersion"]) : undefined;
  if (minVersion && maxVersion && compareFlagVersions(minVersion, maxVersion) > 0) {
    fail("minVersion must be <= maxVersion");
  }
  return {
    enabled: value["enabled"],
    ...(has("chains") ? { chains: readChains(value["chains"]) } : {}),
    ...(maxVersion ? { maxVersion } : {}),
    ...(minVersion ? { minVersion } : {}),
    ...(has("rollout")
      ? { rollout: readInteger(value["rollout"], 0, MAX_ROLLOUT, "rollout") }
      : {}),
  };
};

const parseFlagMap = (value: unknown): Readonly<Record<string, FlagRule>> => {
  if (!isRecord(value)) {
    return fail("flags must be an object");
  }
  const keys = Object.keys(value);
  if (keys.length > MAX_FLAGS) {
    fail(`at most ${MAX_FLAGS} flags`);
  }
  const flags: Record<string, FlagRule> = Object.create(null);
  for (const key of keys) {
    if (!isFlagKey(key)) {
      fail("invalid flag key");
    }
    flags[key] = parseRule(value[key]);
  }
  return flags;
};

/**
 * Validates an already Ed25519-verified payload. A signed document is not
 * thereby well formed, so this runs after verification as well, never instead
 * of it. `schema` is checked separately by the verifier so a future schema is
 * reported as such rather than as generic malformation.
 */
export const parseFlagPayload = (value: unknown): FlagPayload => {
  if (!isRecord(value) || !hasOnlyKnownKeys(value, PAYLOAD_KEYS)) {
    return fail("payload has an unknown or malformed field");
  }
  for (const key of PAYLOAD_KEYS) {
    if (!Object.hasOwn(value, key)) {
      fail(`payload is missing ${key}`);
    }
  }
  if (value["schema"] !== FLAG_SCHEMA_VERSION) {
    fail("unsupported schema");
  }
  const issuedAt = parseFlagTimestamp(value["issuedAt"]);
  const expiresAt = parseFlagTimestamp(value["expiresAt"]);
  if (expiresAt <= issuedAt || expiresAt - issuedAt > MAX_TTL_MS) {
    fail("validity window is invalid");
  }
  return {
    channel: readOneOf(value["channel"], FLAG_CHANNELS, "channel"),
    expiresAt,
    flags: parseFlagMap(value["flags"]),
    issuedAt,
    schema: FLAG_SCHEMA_VERSION,
    sequence: readInteger(value["sequence"], 1, Number.MAX_SAFE_INTEGER, "sequence"),
  };
};
