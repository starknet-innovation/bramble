/**
 * Pure decoding and merge helpers for real on-chain transaction history.
 *
 * The activity feed was historically a local log of transactions this wallet
 * instance submitted; an account funded or used elsewhere showed nothing. This
 * module turns untrusted ERC20 `Transfer` events read from chain into canonical
 * {@link ActivityEntry} rows and merges them with the local log, de-duplicated
 * by transaction hash. It is network- and clock-free so every rule is
 * unit-testable; the event/timestamp queries live in ./tx-history-scan.
 *
 * Nothing here is trusted on its own: every felt is parsed through the shared
 * `networks` helpers (parse-don't-validate), and the produced entries are
 * re-checked by `isActivityEntry` at the message boundary before they render.
 */
import { hash } from "starknet";
import type { ActivityEntry } from "../storage/activity-store";
import type { TokenConfig } from "../storage/preferences-store";
import { canonicalFelt, isStarkFieldElement, type StarknetNetworkId, sameFelt } from "./networks";
import { formatTokenAmount } from "./rpc";

const UINT_128_SHIFT = 128n;
const MAX_SUMMARY_LENGTH = 200;

/**
 * The Starknet event selector emitted by an ERC20 `transfer`.
 */
export const TRANSFER_EVENT_KEY = hash.getSelectorFromName("Transfer");

/**
 * Upper bound on how many on-chain transactions one history scan contributes to
 * the feed. Each distinct block costs a header read for its timestamp, so a
 * funded account with deep history cannot fan out unbounded RPC per refresh;
 * entries past the cap are dropped at the scan boundary.
 */
export const MAX_HISTORY_ENTRIES = 25;

/**
 * Whether a transfer moved value into or out of the active account.
 */
export type TransferDirection = "in" | "out";

/**
 * One ERC20 `Transfer` decoded from an on-chain event, relative to the active
 * account. `timestampMs` is filled by the scan from the block header (events
 * carry no time), so decoding stays a pure function of the event alone.
 */
export type DecodedTransfer = {
  readonly amountRaw: string;
  readonly blockNumber: number;
  readonly counterparty: string;
  readonly direction: TransferDirection;
  readonly hash: string;
};

/**
 * A single emitted event, narrowed to the fields history decoding reads. Shaped
 * to match a Starknet `starknet_getEvents` `EMITTED_EVENT` record.
 */
export type HistoryEvent = {
  readonly block_number?: number;
  readonly data: readonly string[];
  readonly keys: readonly string[];
  readonly transaction_hash?: string;
};

const isSafeBlockNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const uint256From = (low: string | undefined, high: string | undefined): string | null => {
  if (typeof low !== "string" || typeof high !== "string") {
    return null;
  }
  try {
    return (BigInt(low) + (BigInt(high) << UINT_128_SHIFT)).toString();
  } catch {
    return null;
  }
};

/**
 * Decodes an ERC20 `Transfer` event into a {@link DecodedTransfer} relative to
 * `account`, or null when the event is not a well-formed transfer that touches
 * the account. Handles both the Cairo 1 layout (`from` and `to` are indexed
 * keys, the uint256 amount sits in `data`) and the legacy layout (all fields in
 * `data`), mirroring the shared `Approval` decoder so transfers from either
 * token generation are discoverable. The counterparty is the other party to the
 * transfer, canonicalized to `0x`-hex; a zero address (mint/burn) is kept so
 * received-by-mint activity is not silently hidden.
 */
export const decodeTransferEvent = (
  event: HistoryEvent,
  account: string,
): DecodedTransfer | null => {
  // The event is untrusted RPC output whose `keys`/`data` are only asserted to
  // be arrays by the cast at the boundary. Guard the shape so a malformed event
  // (non-array keys/data) is skipped as a non-transfer rather than throwing a
  // TypeError that would be misclassified as a transport failure and blank a
  // whole token's history.
  if (!Array.isArray(event.keys) || !Array.isArray(event.data)) {
    return null;
  }
  if (!sameFelt(event.keys[0], TRANSFER_EVENT_KEY)) {
    return null;
  }
  const indexed = event.keys.length >= 3;
  const rawFrom = indexed ? event.keys[1] : event.data[0];
  const rawTo = indexed ? event.keys[2] : event.data[1];
  const amountRaw = indexed
    ? uint256From(event.data[0], event.data[1])
    : uint256From(event.data[2], event.data[3]);
  const from = typeof rawFrom === "string" ? canonicalFelt(rawFrom) : null;
  const to = typeof rawTo === "string" ? canonicalFelt(rawTo) : null;
  const txHash =
    typeof event.transaction_hash === "string" ? canonicalFelt(event.transaction_hash) : null;
  if (from === null || to === null || amountRaw === null || txHash === null) {
    return null;
  }
  // Validate the counterparty felts symmetrically with the hash (which
  // isActivityEntry re-checks with isStarkFieldElement at the boundary): a
  // hostile event must not seat an out-of-field-range counterparty into a
  // stored/exported entry. A zero address (mint/burn) is a valid field element,
  // so received-by-mint activity is still kept.
  if (!isStarkFieldElement(from) || !isStarkFieldElement(to)) {
    return null;
  }
  if (!isSafeBlockNumber(event.block_number)) {
    return null;
  }
  const direction: TransferDirection | null = sameFelt(from, account)
    ? "out"
    : sameFelt(to, account)
      ? "in"
      : null;
  if (direction === null) {
    return null;
  }
  return {
    amountRaw,
    blockNumber: event.block_number,
    counterparty: direction === "out" ? to : from,
    direction,
    hash: txHash,
  };
};

const shortAddress = (address: string): string =>
  address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;

const clampSummary = (summary: string): string => summary.slice(0, MAX_SUMMARY_LENGTH);

/**
 * Folds a decoded on-chain transfer into a canonical {@link ActivityEntry} for
 * the feed. The status is always `accepted` — `getEvents` only returns events
 * emitted by transactions already included in a block — and `submittedAt` is
 * the block timestamp (the honest "when", since chain history has no local
 * submit time). The amount is formatted with the known token's decimals and the
 * summary names the direction and counterparty so the row reads by type,
 * counterparty, and amount without the caller re-decoding it.
 */
export const onChainActivityEntry = (input: {
  readonly accountId: string;
  readonly decoded: DecodedTransfer;
  readonly networkId: StarknetNetworkId;
  readonly timestampMs: number;
  readonly token: TokenConfig;
}): ActivityEntry => {
  const { accountId, decoded, networkId, timestampMs, token } = input;
  const amount = formatTokenAmount(BigInt(decoded.amountRaw), token.decimals);
  const shortCounterparty = shortAddress(decoded.counterparty);
  const summary =
    decoded.direction === "in"
      ? `Received ${amount} ${token.symbol} from ${shortCounterparty}`
      : `Sent ${amount} ${token.symbol} to ${shortCounterparty}`;
  return {
    accountId,
    amount,
    counterparty: decoded.counterparty,
    hash: decoded.hash,
    kind: "transfer",
    networkId,
    status: "accepted",
    submittedAt: timestampMs,
    summary: clampSummary(summary),
    token: token.symbol,
  };
};

// Transaction identity: a local record is unique per (network, hash). Hashes
// are canonicalized so a local record ("0x07ab…") and a chain event ("0x7ab…")
// that name the same transaction collapse to one row.
const txKey = (entry: ActivityEntry): string =>
  `${entry.networkId}:${canonicalFelt(entry.hash) ?? entry.hash}`;

// Leg identity for a chain-discovered row. One transaction can emit several
// Transfer events — a DEX swap emits an outgoing and an incoming leg, a
// multicall emits many — that all share a hash. Keying on the hash alone would
// collapse them to one arbitrary leg, so chain rows are keyed on the full
// (network, hash, token, counterparty, amount) tuple; those fields together
// distinguish every leg (a swap's legs differ by token, a multicall's by
// counterparty) while two genuinely identical legs still collapse. Fields are
// joined on a NUL (written as a backslash-u escape, never a raw control byte in
// source) so the separator can never appear inside a felt-derived value or a
// free-form token symbol and make two distinct legs alias.
const legKey = (entry: ActivityEntry): string =>
  `${txKey(entry)}\u0000${entry.token ?? ""}\u0000${entry.counterparty ?? ""}\u0000${entry.amount ?? ""}`;

/**
 * Merges the wallet's locally recorded activity with transactions discovered on
 * chain, sorted newest-first. A locally submitted transaction collapses every
 * chain leg that shares its hash: the local record carries the richer,
 * user-facing summary and a status already reconciled against chain via the
 * pending re-poll, so it keeps its identity while purely chain-discovered
 * transactions are added around it. Chain rows with no local record are
 * de-duplicated per leg, so a swap or multicall keeps all of its transfers
 * rather than showing one arbitrary leg. The result is the union, never fewer
 * rows than the local log.
 */
export const mergeActivity = (
  local: readonly ActivityEntry[],
  onChain: readonly ActivityEntry[],
): readonly ActivityEntry[] => {
  const byKey = new Map<string, ActivityEntry>();
  const localTxKeys = new Set<string>();
  for (const entry of local) {
    localTxKeys.add(txKey(entry));
    byKey.set(txKey(entry), entry);
  }
  for (const entry of onChain) {
    if (localTxKeys.has(txKey(entry))) {
      continue;
    }
    const key = legKey(entry);
    if (!byKey.has(key)) {
      byKey.set(key, entry);
    }
  }
  return [...byKey.values()].sort((a, b) => b.submittedAt - a.submittedAt);
};
