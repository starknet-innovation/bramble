/**
 * Local record of SNIP-9 OutsideExecution messages this wallet signed for a
 * dapp or relayer (issue 299). A signed message handed to a site is not a
 * transaction: the wallet never sees a submission or a transaction hash, so
 * these rows are kept apart from the transaction log and are never observed as
 * transactions. Each one carries only what the user signed plus what the chain
 * has since shown about it:
 *
 * - `signed`: no on-chain evidence yet. It may still be relayed.
 * - `executed`: the account reports the message's nonce used, which happens
 *   only when an outside execution with that nonce runs.
 * - `expired`: at a block whose timestamp passed the message's deadline, the
 *   nonce was still unused, so it can no longer run.
 *
 * Plain public data kept outside the encrypted vault; the record is local to
 * this device and is not restored on another one. The clock is injected.
 */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import type { KeyValueStore } from "@bramble/store/kv";
import { serializeStoreMutations } from "@bramble/store/mutation";
import { isAccountIdForNetwork } from "@bramble/wallet-model/accounts";
import {
  isStarkFieldElement,
  isStarknetNetworkId,
  type StarknetNetworkId,
  sameFelt,
} from "@bramble/wallet-model/networks";
import { type ActivityScope, activityOrigin, MAX_ACTIVITY_TIMESTAMP_MS } from "./activity-entry";

const RELAY_SIGNATURES_KEY = "bramble:relay-signatures";

/** Most records kept across every account; the newest survive. */
export const MAX_RELAY_SIGNATURES = 100;

/** What the chain has shown about a signed message so far. */
export type RelaySignatureStatus = "executed" | "expired" | "signed";

/** One OutsideExecution message the user signed in this wallet. */
export type RelaySignature = {
  readonly accountId: string;
  readonly callCount: number;
  /**
   * Whether the account family's nonce view is known to answer for this
   * message, so its status can be read from chain. When false the row stays
   * `signed` and says it is not tracked.
   */
  readonly checkable: boolean;
  /** Last status read attempt, in ms; absent until the first one. */
  readonly checkedAt?: number;
  /** Unix seconds; absent when the message set no practical deadline. */
  readonly executeBefore?: number;
  readonly messageHash: string;
  readonly networkId: StarknetNetworkId;
  readonly nonce: string;
  /** The requesting site, cut to its registrable end like activity origins. */
  readonly origin: string;
  readonly revision: "1" | "2";
  readonly signedAt: number;
  readonly status: RelaySignatureStatus;
};

const isTimestamp = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= MAX_ACTIVITY_TIMESTAMP_MS;

/** Checks a stored or transmitted record before it is trusted. */
export const isRelaySignature = (value: unknown): value is RelaySignature =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, [
    "accountId",
    "callCount",
    "checkable",
    "checkedAt",
    "executeBefore",
    "messageHash",
    "networkId",
    "nonce",
    "origin",
    "revision",
    "signedAt",
    "status",
  ]) &&
  isStarknetNetworkId(value["networkId"]) &&
  isAccountIdForNetwork(value["accountId"], value["networkId"]) &&
  typeof value["callCount"] === "number" &&
  Number.isSafeInteger(value["callCount"]) &&
  value["callCount"] >= 0 &&
  value["callCount"] <= 1_000 &&
  typeof value["checkable"] === "boolean" &&
  (value["checkedAt"] === undefined || isTimestamp(value["checkedAt"])) &&
  (value["executeBefore"] === undefined ||
    (typeof value["executeBefore"] === "number" &&
      Number.isSafeInteger(value["executeBefore"]) &&
      value["executeBefore"] >= 0)) &&
  typeof value["messageHash"] === "string" &&
  isStarkFieldElement(value["messageHash"]) &&
  typeof value["nonce"] === "string" &&
  isStarkFieldElement(value["nonce"]) &&
  typeof value["origin"] === "string" &&
  value["origin"].length > 0 &&
  value["origin"].length <= 80 &&
  (value["revision"] === "1" || value["revision"] === "2") &&
  isTimestamp(value["signedAt"]) &&
  (value["status"] === "signed" || value["status"] === "executed" || value["status"] === "expired");

/** The record a signing path hands over; status and timing are the store's. */
export type RelaySignatureInput = Omit<RelaySignature, "checkedAt" | "signedAt" | "status">;

/**
 * The relay log. `record` and `updateStatuses` reject only on a
 * storage failure; a signing path must absorb that so a message already
 * produced is still returned.
 */
export type RelaySignatureLog = {
  /** Newest-first records for one account on one network. */
  readonly list: (scope: ActivityScope) => Promise<readonly RelaySignature[]>;
  /**
   * Records a signed message, or refreshes the same message signed again (same
   * scope and message hash) without adding a row. Invalid input is dropped.
   */
  readonly record: (entry: RelaySignatureInput) => Promise<void>;
  /**
   * Applies status reads for one scope, keyed by message hash. `executed` is
   * final; `expired` yields only to `executed`; `signed` changes nothing but
   * the check time.
   */
  readonly updateStatuses: (
    scope: ActivityScope,
    reads: ReadonlyMap<string, RelaySignatureStatus>,
    checkedAt: number,
  ) => Promise<readonly RelaySignature[]>;
};

const inScope = (entry: RelaySignature, scope: ActivityScope): boolean =>
  entry.accountId === scope.accountId && entry.networkId === scope.networkId;

const sameMessage = (a: RelaySignature, b: RelaySignature): boolean =>
  a.accountId === b.accountId &&
  a.networkId === b.networkId &&
  sameFelt(a.messageHash, b.messageHash);

const newestFirst = (entries: readonly RelaySignature[]): RelaySignature[] =>
  [...entries].sort((a, b) => b.signedAt - a.signedAt);

// Only chain evidence moves a status, and never back: an expiry read at a past
// block cannot undo an execution the account reports.
const nextStatus = (
  current: RelaySignatureStatus,
  read: RelaySignatureStatus | undefined,
): RelaySignatureStatus =>
  read === "executed"
    ? "executed"
    : read === "expired" && current === "signed"
      ? "expired"
      : current;

const afterRecord = (
  entries: readonly RelaySignature[],
  next: RelaySignature,
): readonly RelaySignature[] =>
  newestFirst([...entries.filter((entry) => !sameMessage(entry, next)), next]).slice(
    0,
    MAX_RELAY_SIGNATURES,
  );

const afterReads = (
  entries: readonly RelaySignature[],
  scope: ActivityScope,
  reads: ReadonlyMap<string, RelaySignatureStatus>,
  checkedAt: number,
): readonly RelaySignature[] =>
  entries.map((entry) => {
    if (!inScope(entry, scope)) return entry;
    const read = [...reads].find(([hash]) => sameFelt(hash, entry.messageHash))?.[1];
    if (read === undefined) return entry;
    const next = { ...entry, checkedAt, status: nextStatus(entry.status, read) };
    return isRelaySignature(next) ? next : entry;
  });

const stamped = (entry: RelaySignatureInput, signedAt: number): RelaySignature | null => {
  const next: RelaySignature = {
    ...entry,
    origin: activityOrigin(entry.origin),
    signedAt,
    status: "signed",
  };
  return isRelaySignature(next) ? next : null;
};

/** Creates the persistent relay log over browser storage. */
export const createRelaySignatureLog = ({
  now,
  store,
}: {
  readonly now: () => number;
  readonly store: KeyValueStore;
}): RelaySignatureLog => {
  const read = async (): Promise<readonly RelaySignature[]> => {
    const stored = await store.get(RELAY_SIGNATURES_KEY);
    return Array.isArray(stored) ? stored.filter(isRelaySignature) : [];
  };
  return serializeStoreMutations<RelaySignatureLog>(
    {
      async list(scope) {
        return newestFirst((await read()).filter((entry) => inScope(entry, scope)));
      },
      async record(entry) {
        const next = stamped(entry, now());
        if (next) await store.set(RELAY_SIGNATURES_KEY, afterRecord(await read(), next));
      },
      async updateStatuses(scope, reads, checkedAt) {
        const next = afterReads(await read(), scope, reads, checkedAt);
        await store.set(RELAY_SIGNATURES_KEY, next);
        return newestFirst(next.filter((entry) => inScope(entry, scope)));
      },
    },
    ["list"],
  );
};

/** In-memory log: the router's default when no persistent one is wired. */
export const memoryRelaySignatureLog = (now: () => number = () => 0): RelaySignatureLog => {
  let entries: readonly RelaySignature[] = [];
  return {
    async list(scope) {
      return newestFirst(entries.filter((entry) => inScope(entry, scope)));
    },
    async record(entry) {
      const next = stamped(entry, now());
      if (next) entries = afterRecord(entries, next);
    },
    async updateStatuses(scope, reads, checkedAt) {
      entries = afterReads(entries, scope, reads, checkedAt);
      return newestFirst(entries.filter((entry) => inScope(entry, scope)));
    },
  };
};
