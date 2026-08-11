/**
 * Wallet adapters that prefer exact Starkscan reads and preserve RPC fallback.
 */

import {
  type BalanceInput,
  formatTokenAmount,
  getTokenBalances,
  type TokenBalance,
} from "@mc-wallet/starknet/rpc";
import { type ActivityEntry, isActivityEntry } from "@mc-wallet/transactions/activity";
import { canonicalFelt, sameFelt } from "@mc-wallet/wallet-model/networks";
import type { TokenConfig } from "@mc-wallet/wallet-model/preferences";
import type { StarkscanClient } from "./starkscan";
import type { StarkscanTransfer } from "./starkscan-types";
import { MAX_HISTORY_ENTRIES, onChainActivityEntry, type TransferDirection } from "./tx-history";
import { scanTransactionHistory, type TransactionHistoryScan } from "./tx-history-scan";

const usableDecimals = (value: number | null): value is number =>
  value !== null && Number.isSafeInteger(value) && value >= 0 && value <= 36;

const usableSymbol = (value: string | null): value is string =>
  value !== null && value.trim().length > 0 && value.length <= 64;

const matchingToken = (
  tokens: readonly TokenConfig[],
  transfer: StarkscanTransfer,
  networkId: TransactionHistoryScan["networkId"],
): TokenConfig | null => {
  const configured = tokens.find((token) => sameFelt(token.address, transfer.tokenAddress));
  if (configured !== undefined) {
    return configured;
  }
  if (!usableDecimals(transfer.tokenDecimals) || !usableSymbol(transfer.tokenSymbol)) {
    return null;
  }
  return {
    address: canonicalFelt(transfer.tokenAddress) ?? transfer.tokenAddress,
    decimals: transfer.tokenDecimals,
    id: `starkscan:${networkId}:${canonicalFelt(transfer.tokenAddress) ?? transfer.tokenAddress}`,
    name: transfer.tokenName?.slice(0, 128) || transfer.tokenSymbol,
    networkId,
    symbol: transfer.tokenSymbol,
  };
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
  const token = matchingToken(input.tokens, transfer, input.networkId);
  const direction = transferDirection(transfer, input.account);
  const timestampMs = Date.parse(transfer.timestampIso);
  if (
    token === null ||
    direction === null ||
    !Number.isSafeInteger(timestampMs) ||
    timestampMs < 0
  ) {
    return null;
  }
  const entry = onChainActivityEntry({
    accountId: input.accountId,
    decoded: {
      amountRaw: transfer.amount ?? transfer.rawValue,
      blockNumber: transfer.blockNumber,
      counterparty: canonicalFelt(direction.counterparty) ?? direction.counterparty,
      direction: direction.direction,
      hash: canonicalFelt(transfer.txHash) ?? transfer.txHash,
    },
    networkId: input.networkId,
    timestampMs,
    token,
  });
  return isActivityEntry(entry) ? entry : null;
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
 * Makes indexed holdings the fast path and latest-state Starknet RPC the
 * bounded fallback. The indexer never participates in signing or submission.
 */
export const createStarkscanPreferredBalances =
  (client: StarkscanClient): typeof getTokenBalances =>
  async (input, makeProvider) => {
    try {
      return await getStarkscanTokenBalances(client, input);
    } catch {
      return getTokenBalances(input, makeProvider);
    }
  };

/**
 * Makes indexed transfers the fast activity path while preserving the existing
 * RPC scanner as a fail-closed availability fallback.
 */
export const createStarkscanPreferredHistory =
  (client: StarkscanClient): typeof scanTransactionHistory =>
  async (input, makeProvider) => {
    try {
      return await getStarkscanTransactionHistory(client, input);
    } catch {
      return scanTransactionHistory(input, makeProvider);
    }
  };
