/**
 * On-chain transaction-history discovery for the activity feed. For each of the
 * account's tracked tokens it pages that token's `Transfer` events over a recent
 * block window, keeps the ones the active account sent or received, and reads
 * each transaction's block timestamp so the row sorts and exports with an honest
 * time. The RPC node is the discovery source — the same provider that reads
 * balances and allowances — so no new dependency or indexer is introduced; a
 * dedicated indexer could replace {@link scanTransactionHistory} without
 * touching callers.
 *
 * A transport failure propagates so the caller can degrade to the local-only
 * feed with a clear "history unavailable" indicator, exactly like the external
 * allowance scan; a semantic per-token error is skipped so one odd token cannot
 * blank the whole feed.
 */
import type { RpcProvider } from "starknet";
import { type ActivityEntry, isActivityEntry } from "../storage/activity-store";
import type { TokenConfig } from "../storage/preferences-store";
import { canonicalFelt, isNonZeroStarkFieldElement, type StarknetNetworkId } from "./networks";
import { isTransportRpcError, withRpcFallback } from "./provider";
import {
  type DecodedTransfer,
  decodeTransferEvent,
  type HistoryEvent,
  MAX_HISTORY_ENTRIES,
  onChainActivityEntry,
  TRANSFER_EVENT_KEY,
} from "./tx-history";

// Bounds so a refresh stays cheap against a public RPC node: how many event
// pages to read per range, the page size, and how far back the recent-history
// window reaches. A production indexer would lift these; deeper history beyond
// the window is intentionally not scanned here.
const MAX_EVENT_PAGES = 3;
const EVENT_CHUNK_SIZE = 100;
const HISTORY_BLOCK_WINDOW = 200_000;
// `getEvents` streams a block range oldest-first, so a range with more matching
// events than the page budget yields only its OLDEST events before the budget
// runs out. When that happens the full window is abandoned and just this most
// recent slice is re-read, so a heavy account's feed shows genuinely recent
// transfers instead of the window's oldest ones dressed up as recent.
const HISTORY_RECENT_STRIDE = 20_000;

/**
 * Minimal event filter this scan issues, mirroring the allowance scan's shape.
 * `from_block`/`to_block` bound the range read; the scan pins `to_block` to a
 * snapshot of the latest height so paging is stable as new blocks arrive.
 */
export type HistoryEventFilter = {
  readonly address: string;
  readonly chunk_size: number;
  readonly continuation_token?: string;
  readonly from_block: number;
  readonly keys: readonly string[][];
  readonly to_block: number;
};

/**
 * The RPC surface history discovery needs: the latest block height (to bound
 * the window), paged event reads, and a per-block timestamp lookup. Kept narrow
 * so a fake can drive it in tests and an {@link RpcProvider} in production.
 * `getBlockTimestamp` returns seconds, or null when the block header genuinely
 * carries no timestamp (that transaction is then dropped rather than dated with
 * a guess); a transport failure reading the header must THROW so the scan
 * aborts and the caller degrades with a "history unavailable" indicator, rather
 * than silently dropping the row and showing a truncated feed as complete.
 */
export type HistoryRpc = {
  readonly getBlockTimestamp: (blockNumber: number) => Promise<number | null>;
  readonly getEvents: (filter: HistoryEventFilter) => Promise<{
    readonly continuation_token?: string;
    readonly events?: readonly HistoryEvent[];
  }>;
  readonly getLatestBlockNumber: () => Promise<number>;
};

/**
 * Inputs for scanning one account's on-chain history on one network.
 */
export type TransactionHistoryScan = {
  readonly account: string;
  readonly accountId: string;
  readonly networkId: StarknetNetworkId;
  readonly rpcUrls: readonly string[];
  readonly tokens: readonly TokenConfig[];
};

type TokenTransfer = {
  readonly decoded: DecodedTransfer;
  readonly token: TokenConfig;
};

// Cairo 1 ERC20 `Transfer` indexes `from` (key 1) and `to` (key 2), so the node
// can return only the account's own transfers instead of every holder's. Without
// this the scan reads an unbounded stream of third-party transfers and the
// account's rows almost never fall inside the page budget on a busy token. Two
// filters are issued — outgoing (`from = account`) and incoming (`to = account`);
// an empty group is the RPC wildcard for that key position. The client-side
// `decodeTransferEvent` direction check is kept as defence in case a node ignores
// the key filter.
const transferKeyFilters = (account: string): readonly (readonly string[][])[] => [
  [[TRANSFER_EVENT_KEY], [account]],
  [[TRANSFER_EVENT_KEY], [], [account]],
];

type EventPage = {
  readonly transfers: readonly TokenTransfer[];
  // True when the page budget ran out with more (newer) events still unread, so
  // the transfers collected are the oldest of the range rather than all of it.
  readonly truncated: boolean;
};

// Pages one block range oldest-first, decoding the account's transfers up to the
// page budget. Marks the result truncated when the budget was exhausted while
// the node still had more events to return.
const pageTokenTransfers = async (
  rpc: HistoryRpc,
  token: TokenConfig,
  account: string,
  fromBlock: number,
  toBlock: number,
  keys: readonly string[][],
): Promise<EventPage> => {
  const transfers: TokenTransfer[] = [];
  let continuationToken: string | undefined;
  for (let page = 0; page < MAX_EVENT_PAGES; page += 1) {
    const chunk = await rpc.getEvents({
      address: token.address,
      chunk_size: EVENT_CHUNK_SIZE,
      from_block: fromBlock,
      to_block: toBlock,
      keys,
      ...(continuationToken === undefined ? {} : { continuation_token: continuationToken }),
    });
    for (const event of chunk.events ?? []) {
      const decoded = decodeTransferEvent(event, account);
      if (decoded) {
        transfers.push({ decoded, token });
      }
    }
    if (chunk.continuation_token === undefined) {
      return { transfers, truncated: false };
    }
    continuationToken = chunk.continuation_token;
  }
  return { transfers, truncated: true };
};

// Collects one token+direction's transfers over the recent-history block range.
// A range that fits inside the page budget is returned whole; a heavier one would
// truncate to its OLDEST events (the node streams the range oldest-first), so on
// overflow the most recent block stride is re-read and used instead — the feed
// stays genuinely recent rather than surfacing the window's oldest transfers.
const collectTokenTransfers = async (
  rpc: HistoryRpc,
  token: TokenConfig,
  account: string,
  fromBlock: number,
  latestBlock: number,
  keys: readonly string[][],
): Promise<readonly TokenTransfer[]> => {
  const full = await pageTokenTransfers(rpc, token, account, fromBlock, latestBlock, keys);
  if (!full.truncated) {
    return full.transfers;
  }
  const recentFrom = Math.max(fromBlock, latestBlock - HISTORY_RECENT_STRIDE);
  const recent = await pageTokenTransfers(rpc, token, account, recentFrom, latestBlock, keys);
  return recent.transfers;
};

/**
 * Collects the account's recent on-chain transfers across its tracked tokens
 * using an injected RPC surface, most-recent first and capped at
 * {@link MAX_HISTORY_ENTRIES}. Separated from {@link scanTransactionHistory} so
 * the paging, capping, and timestamp-join logic is testable without a network.
 * A per-token semantic failure is skipped; a transport failure aborts the scan
 * so the caller degrades rather than showing a partial feed as complete.
 */
export const collectTransactionHistory = async (
  rpc: HistoryRpc,
  { account, accountId, networkId, tokens }: Omit<TransactionHistoryScan, "rpcUrls">,
): Promise<readonly ActivityEntry[]> => {
  const canonicalAccount = canonicalFelt(account);
  if (!canonicalAccount || !isNonZeroStarkFieldElement(canonicalAccount)) {
    return [];
  }
  const latest = await rpc.getLatestBlockNumber();
  const fromBlock = Math.max(0, latest - HISTORY_BLOCK_WINDOW);
  const transfers: TokenTransfer[] = [];
  for (const token of tokens) {
    const address = canonicalFelt(token.address);
    if (!address || !isNonZeroStarkFieldElement(address)) {
      continue;
    }
    try {
      for (const keys of transferKeyFilters(canonicalAccount)) {
        transfers.push(
          ...(await collectTokenTransfers(rpc, token, canonicalAccount, fromBlock, latest, keys)),
        );
      }
    } catch (error) {
      if (isTransportRpcError(error)) {
        throw error;
      }
    }
  }
  // A self-transfer (from = to = account) matches both the outgoing and incoming
  // filter, so collapse to one row per transaction hash before capping.
  const byHash = new Map<string, TokenTransfer>();
  for (const transfer of transfers) {
    if (!byHash.has(transfer.decoded.hash)) {
      byHash.set(transfer.decoded.hash, transfer);
    }
  }
  const recent = [...byHash.values()]
    .sort((a, b) => b.decoded.blockNumber - a.decoded.blockNumber)
    .slice(0, MAX_HISTORY_ENTRIES);
  // Read each distinct block's timestamp once and in parallel: the reads are
  // independent, so a deep refresh does not pay one serial round-trip per row
  // against a slow public node. Bounded by MAX_HISTORY_ENTRIES distinct blocks.
  const distinctBlocks = [...new Set(recent.map(({ decoded }) => decoded.blockNumber))];
  const timestamps = new Map(
    await Promise.all(
      distinctBlocks.map(
        async (blockNumber) => [blockNumber, await rpc.getBlockTimestamp(blockNumber)] as const,
      ),
    ),
  );
  const entries: ActivityEntry[] = [];
  for (const { decoded, token } of recent) {
    const seconds = timestamps.get(decoded.blockNumber);
    if (seconds === null || seconds === undefined) {
      continue;
    }
    const entry = onChainActivityEntry({
      accountId,
      decoded,
      networkId,
      timestampMs: seconds * 1000,
      token,
    });
    // Re-check every node-derived row here, not only at the popup boundary: that
    // boundary rejects the whole feed if any single entry is invalid, so one
    // out-of-range value from the node would drop local history too. Dropping the
    // bad row here keeps the rest of the feed intact.
    if (isActivityEntry(entry)) {
      entries.push(entry);
    }
  }
  return entries;
};

/**
 * Discovers the active account's recent on-chain transactions across its tracked
 * tokens, failing over across the configured RPC endpoints. Returns an empty
 * list when no tokens are tracked; a thrown transport error means "history
 * unavailable" and the caller falls back to the local activity log.
 * `makeProvider` is an injection seam for tests (mirroring {@link withRpcFallback});
 * production omits it and gets the real {@link RpcProvider} factory.
 */
export const scanTransactionHistory = async (
  { account, accountId, networkId, rpcUrls, tokens }: TransactionHistoryScan,
  makeProvider?: (nodeUrl: string) => RpcProvider,
): Promise<readonly ActivityEntry[]> => {
  if (tokens.length === 0) {
    return [];
  }
  return withRpcFallback(
    rpcUrls,
    (provider) =>
      collectTransactionHistory(
        {
          async getBlockTimestamp(blockNumber) {
            try {
              const block = await provider.getBlockWithTxHashes(blockNumber);
              return typeof block.timestamp === "number" ? block.timestamp : null;
            } catch (error) {
              // A transport failure reading the header propagates like the
              // getEvents path: it fails over and ultimately degrades the feed.
              // Only a semantic/absent-header error drops the single row.
              if (isTransportRpcError(error)) {
                throw error;
              }
              return null;
            }
          },
          getEvents: (filter) =>
            provider.getEvents({
              address: filter.address,
              chunk_size: filter.chunk_size,
              from_block: { block_number: filter.from_block },
              keys: filter.keys.map((group) => [...group]),
              to_block: { block_number: filter.to_block },
              ...(filter.continuation_token === undefined
                ? {}
                : { continuation_token: filter.continuation_token }),
            }),
          getLatestBlockNumber: () => provider.getBlockNumber(),
        },
        { account, accountId, networkId, tokens },
      ),
    makeProvider,
  );
};
