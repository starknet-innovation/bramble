/**
 * The activity entry schema: its types, the validator every stored or
 * discovered row passes before it is trusted, and the scope boundary. Split
 * from ./activity so the store module stays within the size budget; import it
 * through `@bramble/transactions/activity`, which re-exports everything here.
 */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { isAccountIdForNetwork } from "@bramble/wallet-model/accounts";
import {
  isStarkFieldElement,
  isStarknetNetworkId,
  type StarknetNetworkId,
} from "@bramble/wallet-model/networks";

/**
 * Lifecycle status of a submitted transaction.
 *
 * `preconfirmed` is provisional: the block proposer executed the transaction
 * (so a revert is already visible) but consensus has not committed its block.
 * `accepted` covers both `ACCEPTED_ON_L2` and `ACCEPTED_ON_L1`; L1 finality is
 * carried by {@link ActivityEntry.finalizedOnL1} instead of a separate status,
 * so the feed never grows a third success tier.
 */
export type ActivityStatus = "accepted" | "pending" | "preconfirmed" | "rejected" | "reverted";

/**
 * Whether a status can still change on chain. Pre-confirmed and pending
 * transactions are both unresolved; `accepted` is a real outcome even though
 * reconciliation keeps watching it until L1 finality. Single source of truth —
 * do not re-derive this comparison at call sites.
 */
export const isUnresolvedActivityStatus = (status: ActivityStatus): boolean =>
  status === "pending" || status === "preconfirmed";

/**
 * Resolves two status observations without allowing stale asynchronous reads
 * to demote chain progress or overwrite a terminal failure.
 */
export const monotonicActivityStatus = (
  current: ActivityStatus,
  observed: ActivityStatus,
): ActivityStatus => {
  const terminal = (status: ActivityStatus): boolean =>
    status === "rejected" || status === "reverted";
  if (terminal(current)) {
    return current;
  }
  if (terminal(observed)) {
    return observed;
  }
  const progress = (status: ActivityStatus): number =>
    status === "accepted" ? 2 : status === "preconfirmed" ? 1 : 0;
  return progress(observed) >= progress(current) ? observed : current;
};

/**
 * One recorded transaction. The `amount`, `counterparty`, and `token` fields
 * are optional so entries stored before they existed still load and export;
 * absent values fall back to blank CSV cells. The three tracking fields below
 * are internal bookkeeping for background reconciliation and are never
 * rendered; they are optional for the same reason.
 */
export type ActivityEntry = {
  readonly accountId: string;
  readonly amount?: string;
  readonly counterparty?: string;
  /**
   * Set to `"pending"` when reconciliation observes a failure the user has
   * already moved past, and flipped to `"delivered"` once the side panel has
   * shown it. Absent means there is nothing to tell the user.
   */
  readonly failureNotice?: "delivered" | "pending";
  /**
   * True once the chain reported `ACCEPTED_ON_L1`. Reconciliation's terminal
   * condition; not a user-visible state.
   */
  readonly finalizedOnL1?: boolean;
  readonly hash: string;
  /**
   * What the account submitted. `"declare"` is its own kind rather than being
   * folded into `"invoke"` so the feed and the CSV export can tell a class
   * declaration apart from a call — they are different transaction types on
   * chain and carry different meaning in an audit.
   */
  readonly kind: "declare" | "deploy" | "invoke" | "transfer";
  readonly networkId: StarknetNetworkId;
  /**
   * Consecutive `TXN_HASH_NOT_FOUND` observations. Reset by any answer that
   * finds the transaction, so ordinary RPC noise never accumulates.
   */
  readonly notFoundCount?: number;
  /**
   * Provenance: `"wallet"` only on rows this wallet recorded for a transaction
   * it submitted itself (see the background's `recordSubmittedActivity`). Rows
   * discovered from chain history or an explorer never carry it, so a
   * third-party event that names this account cannot pose as a payment the
   * user made. Absent on legacy rows, which are treated as unknown origin.
   */
  readonly origin?: "wallet";
  /**
   * True once a status read returned a real finality for this hash. Only a
   * transaction the wallet has seen can be judged gone after repeated
   * not-found answers; an unseen one stays pending until its observation
   * window lapses.
   */
  readonly seenOnChain?: boolean;
  readonly status: ActivityStatus;
  readonly submittedAt: number;
  readonly summary: string;
  readonly token?: string;
};

/**
 * The reconciled result written back for one hash. Policy (which transition
 * deserves a user-visible notice, when a disappearance counts as failure) is
 * decided by the caller; this store only applies what it is handed.
 */
export type ActivityOutcome = {
  readonly failureNotice?: "pending";
  readonly finalizedOnL1?: boolean;
  readonly notFoundCount?: number;
  readonly seenOnChain?: boolean;
  readonly status: ActivityStatus;
};

/**
 * Account and network boundary for a single activity feed. Both fields remain
 * explicit so callers cannot accidentally treat an account id as globally
 * scoped if its representation changes in a future vault schema.
 */
export type ActivityScope = {
  readonly accountId: string;
  readonly networkId: StarknetNetworkId;
};

const isActivityStatus = (value: unknown): value is ActivityStatus =>
  value === "accepted" ||
  value === "pending" ||
  value === "preconfirmed" ||
  value === "rejected" ||
  value === "reverted";

const isFailureNotice = (value: unknown): value is ActivityEntry["failureNotice"] =>
  value === undefined || value === "delivered" || value === "pending";

const isNotFoundCount = (value: unknown): value is number | undefined =>
  value === undefined || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);

const isActivityKind = (value: unknown): value is ActivityEntry["kind"] =>
  value === "declare" || value === "deploy" || value === "invoke" || value === "transfer";

const isOptionalDetail = (value: unknown): value is string | undefined =>
  value === undefined || (typeof value === "string" && value.length > 0 && value.length <= 200);

/**
 * Checks stored activity entries before trusting them. The detail fields are
 * optional, so older entries that predate them still validate.
 */
export const isActivityEntry = (value: unknown): value is ActivityEntry =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, [
    "accountId",
    "amount",
    "counterparty",
    "failureNotice",
    "finalizedOnL1",
    "hash",
    "kind",
    "networkId",
    "notFoundCount",
    "origin",
    "seenOnChain",
    "status",
    "submittedAt",
    "summary",
    "token",
  ]) &&
  isStarknetNetworkId(value["networkId"]) &&
  isAccountIdForNetwork(value["accountId"], value["networkId"]) &&
  typeof value["hash"] === "string" &&
  isStarkFieldElement(value["hash"]) &&
  isActivityKind(value["kind"]) &&
  isActivityStatus(value["status"]) &&
  typeof value["submittedAt"] === "number" &&
  Number.isSafeInteger(value["submittedAt"]) &&
  value["submittedAt"] >= 0 &&
  typeof value["summary"] === "string" &&
  value["summary"].length > 0 &&
  value["summary"].length <= 200 &&
  isOptionalDetail(value["amount"]) &&
  isOptionalDetail(value["counterparty"]) &&
  isOptionalDetail(value["token"]) &&
  isFailureNotice(value["failureNotice"]) &&
  (value["finalizedOnL1"] === undefined || typeof value["finalizedOnL1"] === "boolean") &&
  (value["seenOnChain"] === undefined || typeof value["seenOnChain"] === "boolean") &&
  isNotFoundCount(value["notFoundCount"]) &&
  (value["origin"] === undefined || value["origin"] === "wallet");

/** Whether an entry belongs to one account on one network. */
export const matchesScope = (entry: ActivityEntry, scope: ActivityScope): boolean =>
  entry.accountId === scope.accountId && entry.networkId === scope.networkId;

/**
 * Selects the rows that belong to one account on one network. The persistent
 * store may contain many scopes, but no UI or status reconciliation boundary
 * should consume the unfiltered list.
 */
export const activityForScope = (
  entries: readonly ActivityEntry[],
  scope: ActivityScope,
): readonly ActivityEntry[] => entries.filter((entry) => matchesScope(entry, scope));
