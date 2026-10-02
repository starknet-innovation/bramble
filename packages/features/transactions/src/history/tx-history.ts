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

import { formatTokenAmount } from "@bramble/starknet/rpc";
import { type ActivityEntry, isUnresolvedActivityStatus } from "@bramble/transactions/activity";
import {
  canonicalFelt,
  isStarkFieldElement,
  type StarknetNetworkId,
  sameFelt,
  uint256Felts,
} from "@bramble/wallet-model/networks";
import type { TokenConfig } from "@bramble/wallet-model/preferences";
import { hash } from "starknet";

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

const uint256From = (low: string | undefined, high: string | undefined): string | null =>
  uint256Felts(low, high)?.toString() ?? null;

// The (from, to, amount) triple of a Transfer event, canonicalized to 0x-hex
// felts. Present only when all three parse to in-field-range values.
type TransferParties = {
  readonly amountRaw: string;
  readonly from: string;
  readonly to: string;
};

// Reads the parties for whichever Transfer layout the event uses: the Cairo 1
// layout indexes `from`/`to` as keys[1]/keys[2] with the uint256 amount in
// data[0..1]; the legacy layout carries all fields in `data`. Returns null
// unless every field parses to an in-field-range element — validated
// symmetrically with the hash (which isActivityEntry re-checks at the boundary)
// so a hostile event cannot seat an out-of-range counterparty into a stored or
// exported entry. A zero address (mint/burn) is a valid field element, so
// received-by-mint activity is still kept.
const readTransferParties = (event: HistoryEvent): TransferParties | null => {
  const indexed = event.keys.length >= 3;
  const rawFrom = indexed ? event.keys[1] : event.data[0];
  const rawTo = indexed ? event.keys[2] : event.data[1];
  const amountRaw = indexed
    ? uint256From(event.data[0], event.data[1])
    : uint256From(event.data[2], event.data[3]);
  const from = typeof rawFrom === "string" ? canonicalFelt(rawFrom) : null;
  const to = typeof rawTo === "string" ? canonicalFelt(rawTo) : null;
  if (from === null || to === null || amountRaw === null) {
    return null;
  }
  if (!isStarkFieldElement(from) || !isStarkFieldElement(to)) {
    return null;
  }
  return { amountRaw, from, to };
};

// Which side of the transfer the active account sits on, or null when the
// transfer does not touch it.
const transferDirection = (parties: TransferParties, account: string): TransferDirection | null =>
  sameFelt(parties.from, account) ? "out" : sameFelt(parties.to, account) ? "in" : null;

/**
 * Decodes an ERC20 `Transfer` event into a {@link DecodedTransfer} relative to
 * `account`, or null when the event is not a well-formed transfer that touches
 * the account. Handles both the Cairo 1 layout (`from` and `to` are indexed
 * keys, the uint256 amount sits in `data`) and the legacy layout (all fields in
 * `data`), mirroring the shared `Approval` decoder so transfers from either
 * token generation are discoverable. The counterparty is the other party to the
 * transfer, canonicalized to `0x`-hex; a zero address (mint/burn) is kept so
 * received-by-mint activity is not silently hidden.
 *
 * A zero-amount transfer is dropped in both directions (audit #163): on OZ
 * ERC20 tokens anyone may call `transfer_from(victim, lookalike, 0)` with no
 * allowance, and a lookalike may send the victim 0, so such an event proves
 * nothing about the account and exists only to plant a copyable lookalike
 * counterparty in the feed. The user's own zero-value sends keep their local
 * wallet-recorded row, which owns the hash in {@link mergeActivity}.
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
  const parties = readTransferParties(event);
  const txHash =
    typeof event.transaction_hash === "string" ? canonicalFelt(event.transaction_hash) : null;
  if (parties === null || txHash === null || BigInt(parties.amountRaw) === 0n) {
    return null;
  }
  if (!isSafeBlockNumber(event.block_number)) {
    return null;
  }
  const direction = transferDirection(parties, account);
  if (direction === null) {
    return null;
  }
  return {
    amountRaw: parties.amountRaw,
    blockNumber: event.block_number,
    counterparty: direction === "out" ? parties.to : parties.from,
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

// The symbol the explorer lane gives a token the wallet does not track.
const UNTRACKED_TOKEN_SYMBOL = "TOKEN";

const isZeroAmountLabel = (amount: string | undefined): boolean =>
  amount !== undefined && /^0(?:\.0*)?$/.test(amount);

/**
 * Applies the planted-row rule of {@link decodeTransferEvent} and the explorer
 * lane to rows already persisted before it existed (audit #163). Stored rows
 * reach {@link mergeActivity} as `local` and are kept unconditionally, so a
 * zero-value or untracked-token "Sent to" row planted under an older version
 * would otherwise keep offering a one-click copy of the lookalike until the
 * per-scope cap evicted it. Rows this wallet recorded itself (`origin:
 * "wallet"`) are never touched. For rows of unknown origin: zero-amount
 * transfers and outgoing untracked-token transfers are dropped, and an
 * incoming untracked-token transfer keeps its row but loses its counterparty.
 */
export const withoutPlantedRows = (entries: readonly ActivityEntry[]): readonly ActivityEntry[] =>
  entries.flatMap((entry): readonly ActivityEntry[] => {
    if (entry.origin === "wallet" || entry.kind !== "transfer") {
      return [entry];
    }
    if (isZeroAmountLabel(entry.amount)) {
      return [];
    }
    if (entry.token !== UNTRACKED_TOKEN_SYMBOL) {
      return [entry];
    }
    if (entry.summary.startsWith("Sent ")) {
      return [];
    }
    const { counterparty: _untrusted, ...withoutCounterparty } = entry;
    return [withoutCounterparty];
  });

/**
 * Merges the wallet's locally recorded activity with transactions discovered on
 * chain, sorted newest-first. A locally submitted transaction collapses every
 * chain leg that shares its hash: the local record carries the richer,
 * user-facing summary, so it keeps its identity while purely chain-discovered
 * transactions are added around it. The one exception is status: a local row
 * still unresolved (`pending` or the provisional `preconfirmed`) is reconciled
 * to `accepted` when the chain scan found a
 * `Transfer` event for its hash, since an emitted event proves the transaction
 * was included and succeeded (a reverted transaction emits none). This closes
 * the gap where the status re-poll fails but the event scan succeeds,
 * which would otherwise leave a confirmed transfer showing as provisional.
 * Terminal local states (`accepted`, `rejected`, `reverted`) are authoritative
 * and left untouched. Chain rows with no local record are de-duplicated per leg, so a
 * swap or multicall keeps all of its transfers rather than showing one arbitrary
 * leg. The result is the union, never fewer rows than the local log.
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
    const tk = txKey(entry);
    if (localTxKeys.has(tk)) {
      // A local record owns this transaction and keeps its richer summary, so
      // the chain leg adds no row. But an emitted `Transfer` proves the
      // transaction was included and succeeded, so a still-unresolved local row
      // is reconciled to `accepted` even when the status re-poll never
      // landed. Terminal local states are left untouched.
      const localMatch = byKey.get(tk);
      if (
        localMatch !== undefined &&
        isUnresolvedActivityStatus(localMatch.status) &&
        entry.status === "accepted"
      ) {
        byKey.set(tk, { ...localMatch, status: "accepted" });
      }
      continue;
    }
    const key = legKey(entry);
    if (!byKey.has(key)) {
      byKey.set(key, entry);
    }
  }
  return [...byKey.values()].sort((a, b) => b.submittedAt - a.submittedAt);
};
