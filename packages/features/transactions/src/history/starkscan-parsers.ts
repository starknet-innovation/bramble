/**
 * Strict parsers for the Starkscan fields consumed by wallet read surfaces.
 */
import { isBaseUnitsAmount, isRecord } from "@bramble/core/json";
import { canonicalFelt, isStarkFieldElement } from "@bramble/wallet-model/networks";

import type {
  StarkscanAddressActivity,
  StarkscanAddressSummary,
  StarkscanAddressTransaction,
  StarkscanBlock,
  StarkscanContractEvent,
  StarkscanContractMetadata,
  StarkscanPage,
  StarkscanTokenBalance,
  StarkscanTransfer,
} from "./starkscan-types";

const MAX_PAGE_LIMIT = 200;
const invalidResponse = (): never => {
  throw new Error("Invalid Starkscan response");
};
const stringValue = (value: unknown, maxLength = 512): string =>
  typeof value === "string" && value.length <= maxLength ? value : invalidResponse();
const nullableString = (value: unknown, maxLength = 512): string | null =>
  value === null ? null : stringValue(value, maxLength);
const booleanValue = (value: unknown): boolean =>
  typeof value === "boolean" ? value : invalidResponse();
const nullableBoolean = (value: unknown): boolean | null =>
  value === null ? null : booleanValue(value);
const integerValue = (value: unknown): number =>
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : invalidResponse();
const nullableInteger = (value: unknown): number | null =>
  value === null ? null : integerValue(value);
const decimalValue = (value: unknown): string => {
  const parsed = stringValue(value, 256);
  return isBaseUnitsAmount(parsed) ? parsed : invalidResponse();
};
const nullableDecimal = (value: unknown): string | null =>
  value === null ? null : decimalValue(value);
const feltValue = (value: unknown): string => {
  const parsed = stringValue(value, 68);
  const canonical = canonicalFelt(parsed);
  return canonical !== null && isStarkFieldElement(canonical) ? parsed : invalidResponse();
};
const nullableFelt = (value: unknown): string | null => (value === null ? null : feltValue(value));
const recordValue = (value: unknown): Record<string, unknown> =>
  isRecord(value) ? value : invalidResponse();
const stringArray = (value: unknown, felt = false): readonly string[] => {
  if (!Array.isArray(value) || value.length > 1_024) {
    return invalidResponse();
  }
  return value.map((item) => (felt ? feltValue(item) : stringValue(item, 128)));
};

/**
 * Parses a bounded opaque-cursor page from the Starkscan boundary.
 */
export const parseStarkscanPage = <T>(
  value: unknown,
  parseItem: (item: unknown) => T,
): StarkscanPage<T> => {
  const record = recordValue(value);
  if (!Array.isArray(record["items"]) || record["items"].length > MAX_PAGE_LIMIT) {
    return invalidResponse();
  }
  return {
    items: record["items"].map(parseItem),
    nextCursor: nullableString(record["nextCursor"], 2_048),
  };
};

/**
 * Parses an indexed address summary.
 */
export const parseStarkscanAddress = (value: unknown): StarkscanAddressSummary => {
  const row = recordValue(value);
  return {
    address: feltValue(row["address"]),
    totalActivityCount: integerValue(row["totalActivityCount"]),
    latestActivityBlock: nullableInteger(row["latestActivityBlock"]),
    activityCountExact: booleanValue(row["activityCountExact"]),
    classHash: nullableFelt(row["classHash"]),
    isAccount: nullableBoolean(row["isAccount"]),
    createdOnIso: nullableString(row["createdOnIso"]),
    deployedAtTxHash: nullableFelt(row["deployedAtTxHash"]),
    deployedByAddress: nullableFelt(row["deployedByAddress"]),
  };
};

/**
 * Parses one address-attributed transaction.
 */
export const parseStarkscanAddressTransaction = (value: unknown): StarkscanAddressTransaction => {
  const row = recordValue(value);
  return {
    blockNumber: integerValue(row["blockNumber"]),
    timestampIso: stringValue(row["timestampIso"]),
    txIndex: integerValue(row["txIndex"]),
    txHash: feltValue(row["txHash"]),
    kinds: stringArray(row["kinds"]),
    counterparty: nullableFelt(row["counterparty"]),
    txType: nullableString(row["txType"]),
    executionStatus: nullableString(row["executionStatus"]),
    finalityStatus: nullableString(row["finalityStatus"]),
    transferCount: integerValue(row["transferCount"]),
    operationKind: nullableString(row["operationKind"]),
    operationLabel: nullableString(row["operationLabel"]),
  };
};

/**
 * Parses one normalized address activity leg.
 */
export const parseStarkscanAddressActivity = (value: unknown): StarkscanAddressActivity => {
  const row = recordValue(value);
  return {
    blockNumber: integerValue(row["blockNumber"]),
    timestampIso: stringValue(row["timestampIso"]),
    txIndex: integerValue(row["txIndex"]),
    logIndex: nullableInteger(row["logIndex"]),
    transferIndex: nullableInteger(row["transferIndex"]),
    txHash: feltValue(row["txHash"]),
    kind: stringValue(row["kind"], 64),
    counterparty: nullableFelt(row["counterparty"]),
    tokenAddress: nullableFelt(row["tokenAddress"]),
    amount: nullableDecimal(row["amount"]),
    tokenId: nullableDecimal(row["tokenId"]),
  };
};

/**
 * Parses one normalized transfer.
 */
export const parseStarkscanTransfer = (value: unknown): StarkscanTransfer => {
  const row = recordValue(value);
  const standard = stringValue(row["standard"], 16);
  const sourceTier = stringValue(row["sourceTier"], 16);
  if (standard !== "erc20" && standard !== "erc721" && standard !== "erc1155") {
    return invalidResponse();
  }
  if (sourceTier !== "finalized" && sourceTier !== "head") {
    return invalidResponse();
  }
  return {
    blockNumber: integerValue(row["blockNumber"]),
    timestampIso: stringValue(row["timestampIso"]),
    txIndex: integerValue(row["txIndex"]),
    logIndex: integerValue(row["logIndex"]),
    transferIndex: integerValue(row["transferIndex"]),
    txHash: feltValue(row["txHash"]),
    tokenAddress: feltValue(row["tokenAddress"]),
    fromAddress: feltValue(row["fromAddress"]),
    toAddress: feltValue(row["toAddress"]),
    amount: nullableDecimal(row["amount"]),
    rawValue: decimalValue(row["rawValue"]),
    tokenId: nullableDecimal(row["tokenId"]),
    standard,
    tokenSymbol: nullableString(row["tokenSymbol"], 64),
    tokenName: nullableString(row["tokenName"], 128),
    tokenDecimals: nullableInteger(row["tokenDecimals"]),
    sourceTier,
    actionContext: nullableString(row["actionContext"], 128),
  };
};

/**
 * Parses an exact token balance response.
 */
export const parseStarkscanTokenBalance = (value: unknown): StarkscanTokenBalance => {
  const row = recordValue(value);
  const chainId = stringValue(row["chainId"], 16);
  if (chainId !== "SN_MAIN" && chainId !== "SN_SEPOLIA") {
    return invalidResponse();
  }
  return {
    chainId,
    tokenAddress: feltValue(row["tokenAddress"]),
    ownerAddress: feltValue(row["ownerAddress"]),
    blockTag: stringValue(row["blockTag"], 80),
    balanceRaw: decimalValue(row["balanceRaw"]),
  };
};

/**
 * Parses indexed contract metadata.
 */
export const parseStarkscanContract = (value: unknown): StarkscanContractMetadata => {
  const row = recordValue(value);
  const chainId = stringValue(row["chainId"], 16);
  if (chainId !== "SN_MAIN" && chainId !== "SN_SEPOLIA") {
    return invalidResponse();
  }
  return {
    chainId,
    address: feltValue(row["address"]),
    classHash: nullableFelt(row["classHash"]),
    deployedAtBlock: nullableInteger(row["deployedAtBlock"]),
    deployedAtTx: nullableFelt(row["deployedAtTx"]),
    createdOnIso: nullableString(row["createdOnIso"]),
    deployedByAddress: nullableFelt(row["deployedByAddress"]),
    isAccount: nullableBoolean(row["isAccount"]),
    isToken: nullableBoolean(row["isToken"]),
    tokenKind: nullableString(row["tokenKind"], 64),
    alias: nullableString(row["alias"], 128),
    metadataCompleteness: booleanValue(row["metadataCompleteness"]),
    source: stringValue(row["source"], 64),
  };
};

/**
 * Parses a raw or ABI-decoded contract event.
 */
export const parseStarkscanEvent = (value: unknown): StarkscanContractEvent => {
  const row = recordValue(value);
  const sourceTier = row["sourceTier"];
  if (
    sourceTier !== undefined &&
    sourceTier !== null &&
    sourceTier !== "finalized" &&
    sourceTier !== "head"
  ) {
    return invalidResponse();
  }
  return {
    blockNumber: integerValue(row["blockNumber"]),
    timestampIso: stringValue(row["timestampIso"]),
    txHash: feltValue(row["txHash"]),
    txIndex: integerValue(row["txIndex"]),
    logIndex: integerValue(row["logIndex"]),
    address: feltValue(row["address"]),
    keys: stringArray(row["keys"], true),
    data: stringArray(row["data"], true),
    decodingStatus: stringValue(row["decodingStatus"], 64),
    eventName: nullableString(row["eventName"], 128),
    sourceTier: sourceTier === undefined ? null : sourceTier,
  };
};

/**
 * Parses a recent block summary.
 */
export const parseStarkscanBlock = (value: unknown): StarkscanBlock => {
  const row = recordValue(value);
  return {
    blockNumber: integerValue(row["blockNumber"]),
    blockHash: feltValue(row["blockHash"]),
    parentHash: feltValue(row["parentHash"]),
    timestampIso: stringValue(row["timestampIso"]),
    txCount: integerValue(row["txCount"]),
    finalityStatus: stringValue(row["finalityStatus"], 64),
  };
};
