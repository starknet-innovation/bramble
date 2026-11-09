/**
 * Strict reader for Starkscan's staking validator directory
 * (`GET /v1/{chain}/staking/validators`, schema `StakingValidatorPage`), as
 * read directly from Starkscan's keyless API.
 *
 * Trust boundary: the directory is untrusted third-party data. It only helps
 * the user find a staker address; it never supplies a pool, calldata, or any
 * text that is signed. Every field the wallet reads is checked for type,
 * length and format, every array is bounded, and anything malformed rejects
 * the whole page (null), so the screen falls back to a pasted address rather
 * than showing a partial or shifted list. Fields the wallet does not read are
 * ignored, so an added Starkscan field cannot take the list down.
 *
 * Coverage is read by `stakingCoverage` (./staking-coverage): a `prepared`
 * snapshot, or a `catching_up` one that is only just behind, is usable and its
 * validators are offered; anything else is reported as incomplete with no
 * validators offered. A null metric is "unknown", never zero.
 */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { isStarkFieldElement, sameFelt } from "@bramble/wallet-model/networks";
import { type StakingCoverage, stakingCoverage } from "./staking-coverage";
import { stakerAddress } from "./staking-networks";

/** Validators requested per page; a page with more is refused. */
export const STAKING_DIRECTORY_PAGE_SIZE = 50;
/** Longest opaque cursor accepted from, or sent back to, the directory. */
export const MAX_DIRECTORY_CURSOR_LENGTH = 1024;
const MAX_NAME_LENGTH = 64;
const MAX_WEBSITE_LENGTH = 200;
const MAX_TOKENS_PER_VALIDATOR = 32;
const MAX_RAW_DIGITS = 78;
const PPM = 1_000_000n;

/** The Starkscan chain ids the directory may answer for. */
export type StakingDirectoryChain = "SN_MAIN" | "SN_SEPOLIA";

/** One pool as listed: a token and whether it is taking stake. */
type DirectoryPool = { readonly active: boolean; readonly token: string };

/** One validator as read from a page; figures null when unknown. */
export type DirectoryValidator = {
  /** Commission in parts per million, or null when unknown. */
  readonly commissionPpm: number | null;
  /** Delegated stake per token, raw base units; null when unknown. */
  readonly delegated: readonly { readonly raw: bigint | null; readonly token: string }[];
  /** 30-day liveness in parts per million, or null when unknown. */
  readonly liveness30dPpm: number | null;
  readonly name: string | null;
  readonly pools: readonly DirectoryPool[];
  readonly staker: string;
  readonly status: "active" | "exiting" | "inactive" | null;
  /** The website's hostname (https only), or null. */
  readonly website: string | null;
};

/** One validated directory page. */
export type StakingDirectoryPage = {
  readonly coverage: StakingCoverage;
  readonly nextCursor: string | null;
  readonly validators: readonly DirectoryValidator[];
};

const STATUSES: readonly string[] = ["active", "exiting", "inactive"];
const POOL_STATUSES: readonly string[] = ["active", "retired"];
// C0/C1 controls, and the bidi overrides and isolates that can reorder an
// address or name on screen.
const isUnsafeCode = (code: number): boolean =>
  code <= 0x1f ||
  (code >= 0x7f && code <= 0x9f) ||
  code === 0x200e ||
  code === 0x200f ||
  (code >= 0x202a && code <= 0x202e) ||
  (code >= 0x2066 && code <= 0x2069);
const hasUnsafeText = (value: string): boolean =>
  [...value].some((char) => isUnsafeCode(char.codePointAt(0) ?? 0));

/** A cursor the wallet will echo back: bounded printable ASCII, no spaces. */
export const isDirectoryCursor = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= MAX_DIRECTORY_CURSOR_LENGTH &&
  /^[\x21-\x7e]+$/.test(value);

/** A Starkscan address field as a lowercase felt, or null when malformed. Pure. */
export const starkscanFelt = (value: unknown): string | null =>
  typeof value === "string" &&
  value.length <= 66 &&
  /^0x[0-9a-fA-F]+$/.test(value) &&
  isStarkFieldElement(value.toLowerCase())
    ? value.toLowerCase()
    : null;

/**
 * A Starkscan raw figure: null stays null (unknown), a bounded digit string is
 * a bigint, anything else is undefined (malformed). Pure.
 */
export const starkscanRaw = (value: unknown, positive = false): bigint | null | undefined => {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > MAX_RAW_DIGITS || !/^[0-9]+$/.test(value)) {
    return undefined;
  }
  const raw = BigInt(value);
  return positive && raw === 0n ? undefined : raw;
};

// A ratio at most 1, in parts per million (rounded down). Null stays null
// (unknown); undefined means malformed.
const ratioPpm = (value: unknown): number | null | undefined => {
  if (value === null) return null;
  if (!isRecord(value) || !hasOnlyKnownKeys(value, ["denominatorRaw", "numeratorRaw"])) {
    return undefined;
  }
  const numerator = starkscanRaw(value["numeratorRaw"]);
  const denominator = starkscanRaw(value["denominatorRaw"], true);
  if (typeof numerator !== "bigint" || typeof denominator !== "bigint") return undefined;
  return numerator > denominator ? undefined : Number((numerator * PPM) / denominator);
};

const textOf = (value: unknown, max: number): string | null | undefined => {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > max || hasUnsafeText(value)) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

// A website is shown only as its hostname, and only over https with no
// credentials. Any other scheme or a malformed URL is dropped, never shown.
const websiteOf = (value: unknown): string | null | undefined => {
  const text = textOf(value, MAX_WEBSITE_LENGTH);
  if (text === undefined || text === null) return text;
  try {
    const url = new URL(text);
    return url.protocol === "https:" && url.username === "" && url.password === ""
      ? url.hostname
      : null;
  } catch {
    return null;
  }
};

const boundedArray = (value: unknown): readonly unknown[] | null =>
  Array.isArray(value) && value.length <= MAX_TOKENS_PER_VALIDATOR ? value : null;

const poolOf = (value: unknown): DirectoryPool | null => {
  if (!isRecord(value)) return null;
  const token = starkscanFelt(value["tokenAddress"]);
  const status = value["status"];
  return token &&
    starkscanFelt(value["address"]) &&
    typeof status === "string" &&
    POOL_STATUSES.includes(status)
    ? { active: status === "active", token }
    : null;
};

const stakeOf = (value: unknown): DirectoryValidator["delegated"][number] | null => {
  if (!isRecord(value)) return null;
  const token = starkscanFelt(value["tokenAddress"]);
  const raw = starkscanRaw(value["delegatedStakeRaw"]);
  return token && raw !== undefined ? { raw, token } : null;
};

const allOf = <T>(values: readonly unknown[], read: (value: unknown) => T | null): T[] | null => {
  const out: T[] = [];
  for (const value of values) {
    const item = read(value);
    if (item === null) return null;
    out.push(item);
  }
  return out;
};

const validatorOf = (value: unknown): DirectoryValidator | null => {
  if (!isRecord(value)) return null;
  const staker = stakerAddress(starkscanFelt(value["address"]));
  const name = textOf(value["name"], MAX_NAME_LENGTH);
  const website = websiteOf(value["website"]);
  const status = value["status"];
  const commissionPpm = ratioPpm(value["commission"]);
  const liveness30dPpm = ratioPpm(value["liveness30d"]);
  const poolValues = boundedArray(value["pools"]);
  const stakeValues = boundedArray(value["stake"]);
  const pools = poolValues && allOf(poolValues, poolOf);
  const delegated = stakeValues && allOf(stakeValues, stakeOf);
  if (
    !staker ||
    name === undefined ||
    website === undefined ||
    !(status === null || (typeof status === "string" && STATUSES.includes(status))) ||
    commissionPpm === undefined ||
    liveness30dPpm === undefined ||
    !pools ||
    !delegated
  ) {
    return null;
  }
  return {
    commissionPpm,
    delegated,
    liveness30dPpm,
    name,
    pools,
    staker,
    status: status as DirectoryValidator["status"],
    website,
  };
};

/**
 * Validates one directory page for `chain`. Null when anything the wallet
 * reads is malformed or out of bounds, when the page answers for another
 * chain, holds more than `limit` validators, or lists a staker twice. Pure.
 */
export const parseStakingDirectoryPage = (
  value: unknown,
  chain: StakingDirectoryChain,
  limit: number = STAKING_DIRECTORY_PAGE_SIZE,
): StakingDirectoryPage | null => {
  if (!isRecord(value)) return null;
  const coverage = stakingCoverage(value["coverage"]);
  const items = value["items"];
  const cursor = value["nextCursor"];
  if (
    value["chainId"] !== chain ||
    value["source"] !== "finalized_prepared_staking_snapshot" ||
    coverage === null ||
    !(cursor === null || isDirectoryCursor(cursor)) ||
    !Array.isArray(items) ||
    items.length > limit
  ) {
    return null;
  }
  const validators = allOf(items, validatorOf);
  if (!validators) return null;
  const unique = validators.every(
    (validator, index) =>
      validators.findIndex((other) => sameFelt(other.staker, validator.staker)) === index,
  );
  return unique ? { coverage, nextCursor: cursor, validators } : null;
};

/** A tracked token, as the directory filter needs it. */
type DirectoryToken = {
  readonly address: string;
  readonly decimals: number;
  readonly symbol: string;
};

/**
 * One validator as the screen lists it: display strings only. Nothing here is
 * signed or used to build a call.
 */
export type StakingDirectoryEntry = {
  /** Commission, e.g. "10%"; null when unknown. */
  readonly commission: string | null;
  readonly name: string | null;
  /** Each tracked token with an active pool, and its total delegated. */
  readonly pools: readonly { readonly delegated: string | null; readonly symbol: string }[];
  readonly staker: string;
  /** 30-day liveness, e.g. "99.5%"; null when unknown. */
  readonly uptime: string | null;
  readonly website: string | null;
};

/** A parts-per-million figure as a percentage, rounded down to 0.01%. Pure. */
export const ppmPercent = (ppm: number): string =>
  `${(Math.floor(ppm / 100) / 100).toFixed(2).replace(/\.?0+$/, "")}%`;

/**
 * The validators worth offering from one page: status `active`, with an
 * active pool for at least one token the account tracks. Delegated totals are
 * formatted in the wallet's own token decimals, never the directory's. The
 * directory's own order (most STRK staked first) is kept. Pure.
 */
export const directoryEntries = (
  page: StakingDirectoryPage,
  tokens: readonly DirectoryToken[],
  format: (raw: bigint, decimals: number) => string,
): StakingDirectoryEntry[] =>
  page.validators.flatMap((validator) => {
    if (validator.status !== "active") return [];
    const pools = tokens
      .filter((token) =>
        validator.pools.some((pool) => pool.active && sameFelt(pool.token, token.address)),
      )
      .map((token) => {
        const raw = validator.delegated.find((stake) => sameFelt(stake.token, token.address))?.raw;
        return {
          delegated: raw === undefined || raw === null ? null : format(raw, token.decimals),
          symbol: token.symbol,
        };
      });
    if (pools.length === 0) return [];
    return [
      {
        commission: validator.commissionPpm === null ? null : ppmPercent(validator.commissionPpm),
        name: validator.name,
        pools,
        staker: validator.staker,
        uptime: validator.liveness30dPpm === null ? null : ppmPercent(validator.liveness30dPpm),
        website: validator.website,
      },
    ];
  });
