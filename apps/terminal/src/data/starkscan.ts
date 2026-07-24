import { useCallback } from "react";
import { canonicalAddress } from "../protocols/support/networks";
import { isRecord } from "../protocols/support/json";
import { fetchJson } from "./client";
import { STARKSCAN_BASE } from "./endpoints";
import { formatTokenAmount } from "./format";
import type { Resource, TokenBalance } from "./types";
import { useAsyncResource } from "./useAsyncResource";

const POLL_MS = 5_000;
const MAX_ITEMS = 200;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/;

/** Recent block summary displayed in the Discover chain pulse. */
export type ChainBlock = {
  readonly blockNumber: number;
  readonly timestampMs: number;
  readonly txCount: number;
  readonly finalityStatus: string;
};

/** Recent transaction from the newest indexed block. */
export type ChainTransaction = {
  readonly id: string;
  readonly txHash: string;
  readonly blockNumber: number;
  readonly timestampMs: number;
  readonly fromAddress: string;
  readonly toAddress: string;
  readonly executionStatus: string;
  readonly finalityStatus: string;
};

/** Decoded non-fee event surfaced by Starkscan's indexed event feed. */
export type ChainEvent = {
  readonly id: string;
  readonly txHash: string;
  readonly blockNumber: number;
  readonly timestampMs: number;
  readonly logIndex: number;
  readonly contractAddress: string;
  readonly eventName: string;
  readonly detailLabel: string | null;
  readonly detailValue: string | null;
  readonly sourceTier: "finalized" | "head";
};

/** Canonical L1 ↔ L2 message from Starknet's cross-layer message index. */
export type ChainMessage = {
  readonly id: string;
  readonly txHash: string;
  readonly blockNumber: number;
  readonly timestampMs: number;
  readonly direction: "l1_to_l2" | "l2_to_l1";
  readonly fromAddress: string;
  readonly toAddress: string;
  readonly status: string;
  readonly sourceTier: "finalized" | "head";
};

/** Latest Starknet blocks, transactions, decoded events, and L1/L2 messages. */
export type ChainPulse = {
  readonly blocks: readonly ChainBlock[];
  readonly transactions: readonly ChainTransaction[];
  readonly events: readonly ChainEvent[];
  readonly messages: readonly ChainMessage[];
};

/** One indexed transaction attributed to the connected wallet. */
export type WalletActivity = {
  readonly id: string;
  readonly blockNumber: number;
  readonly timestampMs: number;
  readonly title: string;
  readonly detail: string;
  readonly txHash: string;
  readonly finality: "final" | "pending";
};

const text = (value: unknown, maxLength: number): string | null =>
  typeof value === "string" && value.length > 0 && value.length <= maxLength ? value : null;
const integer = (value: unknown, max = Number.MAX_SAFE_INTEGER): number | null =>
  Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max ? Number(value) : null;
const decimal = (value: unknown): string | null => {
  const parsed = text(value, 256);
  return parsed !== null && DECIMAL_PATTERN.test(parsed) ? parsed : null;
};
const timestamp = (value: unknown): number | null => {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};
const pageItems = (value: unknown): readonly unknown[] | null => {
  if (!isRecord(value) || !Array.isArray(value["items"]) || value["items"].length > MAX_ITEMS) {
    return null;
  }
  return value["items"];
};

const shortAddress = (value: string): string =>
  value.length > 13 ? `${value.slice(0, 7)}…${value.slice(-5)}` : value;

const sentenceCase = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (character) => character.toUpperCase());

const stringList = (value: unknown): readonly string[] | null => {
  if (!Array.isArray(value) || value.length > 16) return null;
  const values = value.map((item) => text(item, 64));
  return values.some((item) => item === null) ? null : (values as readonly string[]);
};

const walletActivityTitle = (
  operationLabel: string | null,
  operationKind: string | null,
  kinds: readonly string[],
): string => {
  if (operationLabel !== null) return operationLabel;
  if (operationKind !== null) return sentenceCase(operationKind);
  if (kinds.includes("token_in") && kinds.includes("token_out")) return "Token swap";
  if (kinds.includes("token_out")) return "Sent tokens";
  if (kinds.includes("token_in")) return "Received tokens";
  return "Contract interaction";
};

/** Parses Starkscan's address-transaction page into concise connected-wallet activity. */
export const parseWalletActivity = (value: unknown): readonly WalletActivity[] => {
  const items = pageItems(value);
  if (items === null) throw new Error("Starkscan returned invalid wallet activity");
  return items.flatMap((item): readonly WalletActivity[] => {
    if (!isRecord(item)) return [];
    const blockNumber = integer(item["blockNumber"]);
    const timestampMs = timestamp(item["timestampIso"]);
    const txHash = text(item["txHash"], 68);
    const kinds = stringList(item["kinds"]);
    const transferCount = integer(item["transferCount"], 10_000);
    if (
      blockNumber === null ||
      timestampMs === null ||
      txHash === null ||
      kinds === null ||
      transferCount === null
    ) {
      return [];
    }
    const counterparty = text(item["counterparty"], 68);
    const protocol = text(item["operationProtocolName"], 128);
    const operationLabel = text(item["operationLabel"], 128);
    const operationKind = text(item["operationKind"], 128);
    const finalityStatus = text(item["finalityStatus"], 64);
    const detailParts = [
      protocol,
      transferCount > 0 ? `${transferCount} token ${transferCount === 1 ? "movement" : "movements"}` : null,
      counterparty === null ? null : shortAddress(counterparty),
    ].filter((part): part is string => part !== null);
    return [
      {
        blockNumber,
        detail: detailParts.length > 0 ? detailParts.join(" · ") : `Block ${blockNumber}`,
        finality: finalityStatus?.includes("L1") === true ? "final" : "pending",
        id: `wallet:${txHash}`,
        timestampMs,
        title: walletActivityTitle(operationLabel, operationKind, kinds),
        txHash,
      },
    ];
  });
};

/**
 * Parses an exact, complete token-holdings snapshot into terminal balances.
 * Incomplete snapshots throw so the caller can use latest-state RPC instead of
 * turning absent rows into a misleading zero-dollar portfolio.
 */
export const parseStarkscanBalances = (
  value: unknown,
  expectedOwner: string,
): readonly TokenBalance[] => {
  if (!isRecord(value) || !Array.isArray(value["items"]) || value["items"].length > 10_000) {
    throw new Error("Starkscan returned invalid holdings");
  }
  const completeness = value["completeness"];
  if (
    value["chainId"] !== "SN_MAIN" ||
    canonicalAddress(String(value["ownerAddress"])) !== canonicalAddress(expectedOwner) ||
    value["exact"] !== true ||
    value["truncated"] !== false ||
    !isRecord(completeness) ||
    completeness["exact"] !== true ||
    completeness["truncated"] !== false ||
    completeness["complete"] !== true ||
    completeness["reasonCode"] !== "complete"
  ) {
    throw new Error("Starkscan holdings are not complete");
  }
  const balances: TokenBalance[] = [];
  for (const item of value["items"]) {
    if (!isRecord(item)) continue;
    const address = text(item["tokenAddress"], 68);
    const symbol = text(item["symbol"], 64);
    const name = text(item["name"], 128);
    const decimals = integer(item["decimals"], 36);
    const rawText = decimal(item["indexedBalanceRaw"]);
    if (address === null || symbol === null || decimals === null || rawText === null) continue;
    const raw = BigInt(rawText);
    const { amount, display } = formatTokenAmount(raw, decimals);
    balances.push({
      address,
      symbol,
      name: name ?? symbol,
      decimals,
      raw,
      display,
      amount,
    });
  }
  return balances;
};

const parseBlock = (value: unknown): ChainBlock | null => {
  if (!isRecord(value)) return null;
  const blockNumber = integer(value["blockNumber"]);
  const timestampMs = timestamp(value["timestampIso"]);
  const txCount = integer(value["txCount"]);
  const finalityStatus = text(value["finalityStatus"], 64);
  return blockNumber === null ||
    timestampMs === null ||
    txCount === null ||
    finalityStatus === null
    ? null
    : { blockNumber, timestampMs, txCount, finalityStatus };
};

const parseTransaction = (
  value: unknown,
  block: ChainBlock | undefined,
): ChainTransaction | null => {
  if (!isRecord(value) || block === undefined) return null;
  const txHash = text(value["txHash"], 68);
  const fromAddress = text(value["fromAddress"], 68);
  const toAddress = text(value["toAddress"], 68);
  const executionStatus = text(value["executionStatus"], 64);
  const finalityStatus = text(value["finalityStatus"], 64);
  return txHash === null ||
    fromAddress === null ||
    toAddress === null ||
    executionStatus === null ||
    finalityStatus === null
    ? null
    : {
        blockNumber: block.blockNumber,
        executionStatus,
        finalityStatus,
        fromAddress,
        id: `tx:${txHash}`,
        timestampMs: block.timestampMs,
        toAddress,
        txHash,
      };
};

const firstEventDetail = (
  value: unknown,
): { readonly label: string; readonly value: string } | null => {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) return null;
  const fields = value.flatMap((field) => {
    if (!isRecord(field)) return [];
    const label = text(field["label"], 128);
    const displayValue = text(field["displayValue"], 256);
    return label === null || displayValue === null ? [] : [{ label, value: displayValue }];
  });
  return (
    fields.find((field) => field.label.endsWith(".variant")) ??
    fields.find((field) => field.value.length <= 48) ??
    fields[0] ??
    null
  );
};

const parseEvent = (value: unknown): ChainEvent | null => {
  if (!isRecord(value)) return null;
  const txHash = text(value["txHash"], 68);
  const blockNumber = integer(value["blockNumber"]);
  const timestampMs = timestamp(value["timestampIso"]);
  const logIndex = integer(value["logIndex"]);
  const contractAddress = text(value["address"], 68);
  const eventName = text(value["eventName"], 128);
  const sourceTier = value["sourceTier"];
  if (
    txHash === null ||
    blockNumber === null ||
    timestampMs === null ||
    logIndex === null ||
    contractAddress === null ||
    eventName === null ||
    (sourceTier !== "finalized" && sourceTier !== "head")
  ) {
    return null;
  }
  // Fee payment emits a Transfer for nearly every transaction, while account
  // contracts often emit TransactionExecuted for the same tx. Both drown out
  // the protocol activity this feed is meant to explain, so transactions are
  // sourced directly from the block and only distinct decoded events remain.
  if (eventName === "Transfer" || eventName === "TransactionExecuted") {
    return null;
  }
  const detail = firstEventDetail(value["decodedFields"]);
  return {
    blockNumber,
    contractAddress,
    detailLabel: detail?.label ?? null,
    detailValue: detail?.value ?? null,
    eventName,
    id: `event:${txHash}:${logIndex}`,
    logIndex,
    sourceTier,
    timestampMs,
    txHash,
  };
};

const parseMessage = (value: unknown): ChainMessage | null => {
  if (!isRecord(value)) return null;
  const id = text(value["id"], 256);
  const txHash = text(value["txHash"], 68);
  const blockNumber = integer(value["blockNumber"]);
  const timestampMs = timestamp(value["timestampIso"]);
  const direction = value["direction"];
  const fromAddress = text(value["fromAddress"], 68);
  const toAddress = text(value["toAddress"], 68);
  const status = text(value["status"], 64);
  const sourceTier = value["sourceTier"];
  return id === null ||
    txHash === null ||
    blockNumber === null ||
    timestampMs === null ||
    (direction !== "l1_to_l2" && direction !== "l2_to_l1") ||
    fromAddress === null ||
    toAddress === null ||
    status === null ||
    (sourceTier !== "finalized" && sourceTier !== "head")
    ? null
    : {
        blockNumber,
        direction,
        fromAddress,
        id: `message:${id}`,
        sourceTier,
        status,
        timestampMs,
        toAddress,
        txHash,
      };
};

/** Parses the live Starkscan pages used by the Discover activity surface. */
export const parseChainPulse = (
  blocks: unknown,
  transactions: unknown,
  events: unknown,
  messages: unknown,
): ChainPulse => {
  const blockItems = pageItems(blocks);
  const transactionItems = pageItems(transactions);
  const eventItems = pageItems(events);
  const messageItems = pageItems(messages);
  if (
    blockItems === null ||
    transactionItems === null ||
    eventItems === null ||
    messageItems === null
  ) {
    throw new Error("Starkscan returned invalid chain activity");
  }
  const parsedBlocks = blockItems
    .map(parseBlock)
    .filter((row): row is ChainBlock => row !== null);
  return {
    blocks: parsedBlocks,
    events: eventItems.map(parseEvent).filter((row): row is ChainEvent => row !== null),
    messages: messageItems
      .map(parseMessage)
      .filter((row): row is ChainMessage => row !== null),
    transactions: transactionItems
      .map((value) => parseTransaction(value, parsedBlocks[0]))
      .filter((row): row is ChainTransaction => row !== null),
  };
};

/** Fetches an exact indexed portfolio snapshot for one connected owner. */
export const fetchStarkscanBalances = async (
  owner: string,
  signal: AbortSignal,
): Promise<readonly TokenBalance[]> =>
  parseStarkscanBalances(
    await fetchJson<unknown>(
      `${STARKSCAN_BASE}/address/${encodeURIComponent(owner)}/token-holdings`,
      { signal },
    ),
    owner,
  );

/** Fetches the newest indexed transactions attributed to one connected wallet. */
export const fetchWalletActivity = async (
  owner: string,
  signal: AbortSignal,
): Promise<readonly WalletActivity[]> =>
  parseWalletActivity(
    await fetchJson<unknown>(
      `${STARKSCAN_BASE}/address/${encodeURIComponent(owner)}/transactions?limit=30`,
      { signal },
    ),
  );

const fetchChainPulse = async (signal: AbortSignal): Promise<ChainPulse> => {
  const [blocks, events, messages] = await Promise.all([
    fetchJson<unknown>(`${STARKSCAN_BASE}/blocks?limit=6`, { signal }),
    fetchJson<unknown>(`${STARKSCAN_BASE}/events?limit=80`, { signal }),
    fetchJson<unknown>(`${STARKSCAN_BASE}/messages?limit=8`, { signal }),
  ]);
  const parsedBlocks = pageItems(blocks)
    ?.map(parseBlock)
    .filter((row): row is ChainBlock => row !== null);
  const headBlock = parsedBlocks?.[0];
  const transactions =
    headBlock === undefined
      ? { items: [] }
      : await fetchJson<unknown>(
          `${STARKSCAN_BASE}/block/${headBlock.blockNumber}/txs?limit=24`,
          { signal },
        );
  return parseChainPulse(blocks, transactions, events, messages);
};

/** Polls recent blocks and transfers while retaining the last good snapshot. */
export const useChainPulse = (): Resource<ChainPulse> => {
  const fetcher = useCallback((signal: AbortSignal) => fetchChainPulse(signal), []);
  return useAsyncResource(fetcher, [], POLL_MS);
};

/** Polls connected-wallet activity while retaining the last good indexed page. */
export const useWalletActivity = (owner: string | null): Resource<readonly WalletActivity[]> =>
  useAsyncResource(
    (signal) => (owner === null ? Promise.resolve([]) : fetchWalletActivity(owner, signal)),
    [owner],
    owner === null ? 0 : 15_000,
  );
