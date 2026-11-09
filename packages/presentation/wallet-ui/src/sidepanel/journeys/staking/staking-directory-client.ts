/**
 * The staking screen's state (issue 750): the validator directory, in
 * Starkscan's own order, and the one validator the user opened (picked from
 * the list or pasted). The directory is Starkscan data relayed by the
 * background and is re-validated here key by key; it is display data only.
 * Opening a validator keeps only its staker address and the directory name to
 * show beside it; every figure on the validator's own screen is read on chain.
 */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import {
  isDirectoryCursor,
  STAKING_DIRECTORY_PAGE_SIZE,
} from "@bramble/transactions/staking-directory";
import { stakerAddress } from "@bramble/transactions/staking-networks";
import { refusalText } from "../../runtime/runtime-errors";
import type { StakingValidatorState } from "./staking-client";
import type { StakingPositionsState } from "./staking-positions-client";

const MAX_TEXT = 120;
const MAX_POOLS = 32;
/** The most validators the list holds, however many pages are loaded. */
export const MAX_LISTED_VALIDATORS = 500;

/** One validator as listed, mirroring the background's entry. */
export type StakingDirectoryEntry = {
  readonly commission: string | null;
  readonly name: string | null;
  readonly pools: readonly { readonly delegated: string | null; readonly symbol: string }[];
  readonly staker: string;
  readonly uptime: string | null;
  readonly website: string | null;
};

/** The directory: loading, no route, incomplete, unreadable, or listed. */
export type StakingDirectoryState =
  | { readonly loading: true }
  | { readonly off: true }
  | { readonly incomplete: true }
  | { readonly unavailable: string }
  | {
      readonly entries: readonly StakingDirectoryEntry[];
      /** Set when loading the next page failed; the list shown stays. */
      readonly moreError?: string;
      readonly nextCursor: string | null;
    };

/** The whole staking screen. */
export type StakingState = {
  readonly directory: StakingDirectoryState;
  /** "Your stakes": the account's positions the chain confirmed. */
  readonly positions: StakingPositionsState;
  /** The validator the user opened, or null for the list. */
  readonly selected: { readonly name: string | null; readonly staker: string } | null;
  readonly validator: StakingValidatorState;
  /** Home's open portfolio tab, kept for this account and network. */
  readonly homeTab?: "nfts" | "staking" | "tokens";
};

/** The state before the first read. */
export const STAKING_LOADING: StakingState = {
  directory: { loading: true },
  positions: { loading: true },
  selected: null,
  validator: { loading: true },
};

const UNREADABLE = "Couldn't load the validator list. Paste a validator address instead.";

const isText = (value: unknown, max = MAX_TEXT): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;
const isNullableText = (value: unknown): boolean => value === null || isText(value);

const isPool = (value: unknown): boolean =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["delegated", "symbol"]) &&
  isNullableText(value["delegated"]) &&
  isText(value["symbol"]);

const isEntry = (value: unknown): value is StakingDirectoryEntry =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["commission", "name", "pools", "staker", "uptime", "website"]) &&
  stakerAddress(value["staker"]) === value["staker"] &&
  isNullableText(value["name"]) &&
  isNullableText(value["website"]) &&
  isNullableText(value["commission"]) &&
  isNullableText(value["uptime"]) &&
  Array.isArray(value["pools"]) &&
  value["pools"].length > 0 &&
  value["pools"].length <= MAX_POOLS &&
  value["pools"].every(isPool);

/**
 * Reads a `wallet.stakingDirectory` reply. A refusal keeps the background's
 * sentence; anything unrecognised reads as unavailable, never as empty.
 */
export const stakingDirectoryFrom = (response: unknown): StakingDirectoryState => {
  const directory = isRecord(response) ? response["stakingDirectory"] : undefined;
  if (
    !isRecord(response) ||
    !hasOnlyKnownKeys(response, ["ok", "stakingDirectory"]) ||
    response["ok"] !== true ||
    !isRecord(directory)
  ) {
    return { unavailable: refusalText(response, UNREADABLE) };
  }
  const state = directory["state"];
  if ((state === "off" || state === "incomplete") && hasOnlyKnownKeys(directory, ["state"])) {
    return state === "off" ? { off: true } : { incomplete: true };
  }
  const entries = directory["entries"];
  const cursor = directory["nextCursor"];
  return state === "ready" &&
    hasOnlyKnownKeys(directory, ["entries", "nextCursor", "state"]) &&
    (cursor === null || isDirectoryCursor(cursor)) &&
    Array.isArray(entries) &&
    entries.length <= STAKING_DIRECTORY_PAGE_SIZE &&
    entries.every(isEntry)
    ? { entries, nextCursor: cursor }
    : { unavailable: UNREADABLE };
};

/**
 * Appends the next page to a listed directory, dropping any staker already
 * shown and stopping at {@link MAX_LISTED_VALIDATORS}. A failed page keeps the
 * list and records why. A page saying the directory is now incomplete or off
 * replaces the list, so nothing from it stays selectable. Pure.
 */
export const appendDirectoryPage = (
  current: StakingDirectoryState,
  next: StakingDirectoryState,
): StakingDirectoryState => {
  if (!("entries" in current) || "incomplete" in next || "off" in next) return next;
  if (!("entries" in next)) {
    const moreError = "unavailable" in next ? next.unavailable : UNREADABLE;
    return { entries: current.entries, moreError, nextCursor: current.nextCursor };
  }
  const seen = new Set(current.entries.map((entry) => entry.staker));
  const entries = [...current.entries, ...next.entries.filter((entry) => !seen.has(entry.staker))];
  const full = entries.length >= MAX_LISTED_VALIDATORS;
  return {
    entries: entries.slice(0, MAX_LISTED_VALIDATORS),
    nextCursor: full ? null : next.nextCursor,
  };
};

/**
 * Creates the directory half of the staking client over the panel's sender.
 */
export const createStakingDirectoryRuntimeClient = (
  sendMessage: (message: unknown) => Promise<unknown>,
) => ({
  /** One page of the validator directory; `cursor` asks for the next one. */
  async loadStakingDirectory(cursor?: string): Promise<StakingDirectoryState> {
    return stakingDirectoryFrom(
      await sendMessage({
        ...(cursor === undefined ? {} : { cursor }),
        type: "wallet.stakingDirectory",
      }).catch(() => null),
    );
  },
});

/**
 * A pasted validator address in canonical form, or null when it is not one.
 * Surrounding space and upper-case hex are accepted. Pure.
 */
export const pastedStaker = (text: string): string | null =>
  stakerAddress(text.trim().toLowerCase());
