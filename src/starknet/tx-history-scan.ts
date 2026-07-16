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
// pages to read per token, the page size, and how far back the recent-history
// window reaches. A production indexer would lift these; deeper history beyond
// the window is intentionally not scanned here.
const MAX_EVENT_PAGES = 3;
const EVENT_CHUNK_SIZE = 100;
const HISTORY_BLOCK_WINDOW = 200_000;

/**
 * Minimal event filter this scan issues, mirroring the allowance scan's shape.
 */
export type HistoryEventFilter = {
  readonly address: string;
  readonly chunk_size: number;
  readonly continuation_token?: string;
  readonly from_block: number;
  readonly keys: readonly string[][];
};

/**
 * The RPC surface history discovery needs: the latest block height (to bound
 * the window), paged event reads, and a per-block timestamp lookup. Kept narrow
 * so a fake can drive it in tests and an {@link RpcProvider} in production.
 * `getBlockTimestamp` returns seconds, or null when that block's header cannot
 * be read (the transaction is then dropped rather than dated with a guess).
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

const collectTokenTransfers = async (
  rpc: HistoryRpc,
  token: TokenConfig,
  account: string,
  fromBlock: number,
  keys: readonly string[][],
): Promise<readonly TokenTransfer[]> => {
  const transfers: TokenTransfer[] = [];
  let continuationToken: string | undefined;
  for (let page = 0; page < MAX_EVENT_PAGES; page += 1) {
    const chunk = await rpc.getEvents({
      address: token.address,
      chunk_size: EVENT_CHUNK_SIZE,
      from_block: fromBlock,
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
      break;
    }
    continuationToken = chunk.continuation_token;
  }
  return transfers;
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
          ...(await collectTokenTransfers(rpc, token, canonicalAccount, fromBlock, keys)),
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
  const timestamps = new Map<number, number | null>();
  for (const { decoded } of recent) {
    if (!timestamps.has(decoded.blockNumber)) {
      timestamps.set(decoded.blockNumber, await rpc.getBlockTimestamp(decoded.blockNumber));
    }
  }
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
 */
export const scanTransactionHistory = async ({
  account,
  accountId,
  networkId,
  rpcUrls,
  tokens,
}: TransactionHistoryScan): Promise<readonly ActivityEntry[]> => {
  if (tokens.length === 0) {
    return [];
  }
  return withRpcFallback(rpcUrls, (provider) =>
    collectTransactionHistory(
      {
        async getBlockTimestamp(blockNumber) {
          try {
            const block = await provider.getBlockWithTxHashes(blockNumber);
            return typeof block.timestamp === "number" ? block.timestamp : null;
          } catch {
            return null;
          }
        },
        getEvents: (filter) =>
          provider.getEvents({
            address: filter.address,
            chunk_size: filter.chunk_size,
            from_block: { block_number: filter.from_block },
            keys: filter.keys.map((group) => [...group]),
            to_block: "latest",
            ...(filter.continuation_token === undefined
              ? {}
              : { continuation_token: filter.continuation_token }),
          }),
        getLatestBlockNumber: () => provider.getBlockNumber(),
      },
      { account, accountId, networkId, tokens },
    ),
  );
};
