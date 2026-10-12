/**
 * Wallet read adapters that combine the user's RPC endpoints with the explorer
 * gateway, each with its own explicit trust order.
 *
 * The Starkscan readers below (`getStarkscanTokenBalances`,
 * `getStarkscanTransactionHistory`) are the gateway lane and are exported for
 * the composed wiring and its tests. Production consumes the two factories:
 * {@link createRpcFirstBalances} keeps latest-state RPC authoritative and
 * reaches the gateway only after every endpoint has failed at the transport
 * layer; {@link createExplorerFirstHistory} asks the gateway first, because the
 * RPC transfer scan is bounded to a few days of blocks and an imported account
 * whose activity is older than that would otherwise show an empty feed. Both
 * consult the gateway only when the user's per-network `explorerFallback`
 * preference permits it, since the gateway learns every address it is asked
 * about. The names say which source is tried first on purpose: an earlier
 * spelling ("StarkscanPreferred") outlived the ordering it described and read
 * as an endorsement of the third party.
 */

import { isSafeDecimals } from "@bramble/core/json";
import { isTransportRpcError } from "@bramble/starknet/provider";
import {
  type BalanceInput,
  formatTokenAmount,
  getTokenBalances,
  type TokenBalance,
} from "@bramble/starknet/rpc";
import { type ActivityEntry, isActivityEntry } from "@bramble/transactions/activity";
import { canonicalFelt, type StarknetNetworkId, sameFelt } from "@bramble/wallet-model/networks";
import {
  type ExplorerLanePreferences,
  explorerFallbackAllowed,
  type TokenConfig,
} from "@bramble/wallet-model/preferences";

import type { StarkscanClient } from "./starkscan";
import type { StarkscanTransfer } from "./starkscan-types";
import {
  type HistoryLane,
  MAX_HISTORY_ENTRIES,
  onChainActivityEntry,
  type TransferDirection,
} from "./tx-history";
import { scanTransactionHistory, type TransactionHistoryScan } from "./tx-history-scan";

// The token a transfer moved, and whether the user tracks it. An untracked
// token is any contract that emitted a Transfer naming the account, so nothing
// it reports about the other party is trustworthy.
const matchingToken = (
  tokens: readonly TokenConfig[],
  transfer: StarkscanTransfer,
  networkId: TransactionHistoryScan["networkId"],
): { readonly token: TokenConfig; readonly tracked: boolean } | null => {
  const configured = tokens.find((token) => sameFelt(token.address, transfer.tokenAddress));
  if (configured !== undefined) {
    return { token: configured, tracked: true };
  }
  if (!isSafeDecimals(transfer.tokenDecimals)) {
    return null;
  }
  const address = canonicalFelt(transfer.tokenAddress) ?? transfer.tokenAddress;
  return {
    token: {
      address,
      decimals: transfer.tokenDecimals,
      id: `starkscan:${networkId}:${address}`,
      name: "Untracked token",
      networkId,
      symbol: "TOKEN",
    },
    tracked: false,
  };
};

const isZeroAmount = (value: string): boolean => {
  try {
    return BigInt(value) === 0n;
  } catch {
    return true;
  }
};

const transferDirection = (
  transfer: StarkscanTransfer,
  account: string,
): { readonly counterparty: string; readonly direction: TransferDirection } | null => {
  if (sameFelt(transfer.fromAddress, account)) {
    return { counterparty: transfer.toAddress, direction: "out" };
  }
  if (sameFelt(transfer.toAddress, account)) {
    return { counterparty: transfer.fromAddress, direction: "in" };
  }
  return null;
};

const toActivity = (
  transfer: StarkscanTransfer,
  input: TransactionHistoryScan,
): ActivityEntry | null => {
  if (transfer.standard !== "erc20") {
    return null;
  }
  const matched = matchingToken(input.tokens, transfer, input.networkId);
  const direction = transferDirection(transfer, input.account);
  const timestampMs = Date.parse(transfer.timestampIso);
  const amountRaw = transfer.amount ?? transfer.rawValue;
  // Audit #163: a zero-amount leg (either direction) and an outgoing leg of an
  // untracked token are both free for a third party to fabricate, and exist
  // only to plant a lookalike "Sent to" / "Received from" row in the feed.
  if (
    matched === null ||
    direction === null ||
    isZeroAmount(amountRaw) ||
    (!matched.tracked && direction.direction === "out") ||
    !Number.isSafeInteger(timestampMs) ||
    timestampMs < 0
  ) {
    return null;
  }
  const entry = onChainActivityEntry({
    accountId: input.accountId,
    decoded: {
      amountRaw,
      blockNumber: transfer.blockNumber,
      counterparty: canonicalFelt(direction.counterparty) ?? direction.counterparty,
      direction: direction.direction,
      hash: canonicalFelt(transfer.txHash) ?? transfer.txHash,
    },
    networkId: input.networkId,
    timestampMs,
    token: matched.token,
  });
  // An incoming untracked-token row stays visible, but without a stored
  // counterparty the feed offers no one-click copy of whatever address the
  // arbitrary contract named as the sender.
  const { counterparty: _untrusted, ...withoutCounterparty } = entry;
  const kept = matched.tracked ? entry : withoutCounterparty;
  return isActivityEntry(kept) ? kept : null;
};

/**
 * Reads recent account transfers from Starkscan and converts only validated
 * ERC20 legs into the wallet's existing activity schema. Devnet stays RPC-only.
 */
export const getStarkscanTransactionHistory = async (
  client: StarkscanClient,
  input: TransactionHistoryScan,
): Promise<readonly ActivityEntry[]> => {
  if (input.networkId === "SN_DEVNET") {
    throw new Error("Starkscan does not index devnet");
  }
  const page = await client.getAddressTransfers(input.networkId, input.account, {
    limit: MAX_HISTORY_ENTRIES,
  });
  const entries = page.items
    .map((transfer) => toActivity(transfer, input))
    .filter((entry): entry is ActivityEntry => entry !== null);
  const byLeg = new Map<string, ActivityEntry>();
  for (const entry of entries) {
    const key = `${entry.hash}\u0000${entry.token ?? ""}\u0000${entry.counterparty ?? ""}\u0000${entry.amount ?? ""}`;
    if (!byLeg.has(key)) {
      byLeg.set(key, entry);
    }
  }
  return [...byLeg.values()]
    .sort((left, right) => right.submittedAt - left.submittedAt)
    .slice(0, MAX_HISTORY_ENTRIES);
};

/**
 * Serves an exact, complete indexed holdings snapshot as the wallet balance
 * response. Any incomplete or mismatched snapshot throws so callers can fall
 * back to latest-state RPC rather than silently treating missing rows as zero.
 */
export const getStarkscanTokenBalances = async (
  client: StarkscanClient,
  input: BalanceInput,
): Promise<readonly TokenBalance[]> => {
  if (input.tokens.length === 0) {
    return [];
  }
  const networkId = input.tokens[0]?.networkId;
  if (
    networkId === undefined ||
    networkId === "SN_DEVNET" ||
    input.tokens.some((token) => token.networkId !== networkId)
  ) {
    throw new Error("Starkscan balance input must contain one indexed network");
  }
  const snapshot = await client.getTokenHoldings(networkId, input.accountAddress, { limit: 200 });
  if (
    snapshot.chainId !== networkId ||
    !sameFelt(snapshot.ownerAddress, input.accountAddress) ||
    !snapshot.exact ||
    snapshot.truncated ||
    !snapshot.completeness.exact ||
    snapshot.completeness.truncated ||
    !snapshot.completeness.complete ||
    snapshot.completeness.reasonCode !== "complete"
  ) {
    throw new Error("Starkscan holdings snapshot is incomplete");
  }
  return input.tokens.map((token) => {
    const holding = snapshot.items.find((item) => sameFelt(item.tokenAddress, token.address));
    const raw = BigInt(holding?.indexedBalanceRaw ?? "0");
    return {
      ...token,
      balance: raw.toString(),
      formatted: formatTokenAmount(raw, token.decimals),
    };
  });
};

/**
 * Collaborators the composed read adapters are built from.
 *
 * `readPreferences` is the live preferences read, not a snapshot: the lane is
 * re-authorized on every request that could reach the gateway, so turning it
 * off in Settings takes effect on the next refresh without re-wiring the
 * background. `clientFor` selects the per-network configured explorer client;
 * `client` is the bundled default used when none is configured.
 */
export type ExplorerLaneReadOptions = {
  readonly client: StarkscanClient;
  readonly clientFor?: (
    networkId: StarknetNetworkId,
    preferences: ExplorerLanePreferences,
  ) => StarkscanClient;
  readonly readPreferences: () => Promise<ExplorerLanePreferences>;
};

// Fails closed in both directions that are not an explicit "yes": a request
// whose network cannot be identified, and a preferences read that throws (the
// store is unavailable, or holds a record this build refuses), leave the
// gateway unused so an infrastructure fault can never widen disclosure.
const gatewayPreferencesFor = async (
  readPreferences: () => Promise<ExplorerLanePreferences>,
  networkId: StarknetNetworkId | undefined,
): Promise<ExplorerLanePreferences | null> => {
  if (networkId === undefined) {
    return null;
  }
  try {
    const preferences = await readPreferences();
    return explorerFallbackAllowed(preferences, networkId) ? preferences : null;
  } catch {
    return null;
  }
};

const gatewayClientFor = (
  options: Pick<ExplorerLaneReadOptions, "client" | "clientFor">,
  networkId: StarknetNetworkId,
  preferences: ExplorerLanePreferences,
): StarkscanClient => options.clientFor?.(networkId, preferences) ?? options.client;

/**
 * Serves balances from the user's configured Starknet RPC and falls back to the
 * public explorer gateway only when every configured endpoint has a transport
 * outage and the user's `explorerFallback` preference permits that lane.
 *
 * The configured endpoints are the user's own trust and privacy choice, and
 * latest-state RPC is authoritative; the gateway is a third party that learns
 * every address it is asked about and whose numbers the wallet cannot verify.
 * Asking it first disclosed each account on every refresh and let it shape what
 * the balance screen showed, so it is reached only when the wallet would
 * otherwise have no balances at all — and only with permission (MCW-V09-129).
 * A user on the built-in RPCs keeps the outage rescue by default; a user who
 * configured an `rpcOverride` for the network gets the RPC failure instead, and
 * can re-enable the lane in Settings. When both sources run and both fail, the
 * RPC failure is what propagates — the gateway must never explain away the
 * user's own endpoint. Neither source participates in signing or submission.
 */
export const createRpcFirstBalances =
  (options: ExplorerLaneReadOptions): typeof getTokenBalances =>
  async (input, makeProvider) => {
    try {
      return await getTokenBalances(input, makeProvider);
    } catch (rpcFailure) {
      const networkId = input.tokens[0]?.networkId;
      const preferences = isTransportRpcError(rpcFailure)
        ? await gatewayPreferencesFor(options.readPreferences, networkId)
        : null;
      if (networkId === undefined || preferences === null) {
        throw rpcFailure;
      }
      try {
        return await getStarkscanTokenBalances(
          gatewayClientFor(options, networkId, preferences),
          input,
        );
      } catch {
        throw rpcFailure;
      }
    }
  };

/**
 * Discovered history rows and the lane that produced them. The lane travels
 * with the rows because only the wallet's own event scan may settle the status
 * of a transaction it is still observing (see `mergeActivity`).
 */
export type DiscoveredHistory = {
  readonly entries: readonly ActivityEntry[];
  readonly lane: HistoryLane;
};

/**
 * Serves activity from the explorer gateway first and falls back to the RPC
 * transfer scan when the gateway cannot be used or does not answer.
 *
 * The gateway leads here — the opposite of {@link createRpcFirstBalances} — for
 * a reason that is about coverage, not trust: the RPC scan is bounded to a
 * block window that spans only a few days at current block times, so an
 * account imported into this wallet after a quiet week would show nothing at
 * all, while the gateway indexes the account's whole history. The gateway is
 * still a third party that learns the address, so it is asked only when the
 * user's per-network `explorerFallback` preference permits (an explicit
 * refusal, a configured `rpcOverride` with no opt-in, and an unreadable
 * preferences store all keep the address on the user's own endpoints), and
 * never for the local devnet, which no explorer indexes. Its rows are
 * validated like any other untrusted response before they enter the feed.
 *
 * A gateway that answers is authoritative for that refresh, including an
 * empty page: the RPC scan cannot see further back than the gateway does, so a
 * second opinion would add seconds of latency to every empty account without
 * adding rows. A gateway that is not permitted or fails — transport error,
 * rate limit or its cooldown, malformed body — is silently replaced by the RPC
 * scan, whose own failure propagates so the caller degrades to the local log
 * with an honest "history unavailable" indicator. The feed is therefore marked
 * unavailable only when no permitted lane answered. The result names the lane
 * that answered.
 */
export const createExplorerFirstHistory =
  (
    options: ExplorerLaneReadOptions,
  ): ((
    input: TransactionHistoryScan,
    makeProvider?: Parameters<typeof scanTransactionHistory>[1],
  ) => Promise<DiscoveredHistory>) =>
  async (input, makeProvider) => {
    if (input.networkId !== "SN_DEVNET") {
      const preferences = await gatewayPreferencesFor(options.readPreferences, input.networkId);
      if (preferences !== null) {
        try {
          const entries = await getStarkscanTransactionHistory(
            gatewayClientFor(options, input.networkId, preferences),
            input,
          );
          return { entries, lane: "explorer" };
        } catch {
          // The gateway's failure is not the user's endpoint's failure: fall
          // through to the RPC scan and let its outcome speak.
        }
      }
    }
    return { entries: await scanTransactionHistory(input, makeProvider), lane: "chain-events" };
  };
