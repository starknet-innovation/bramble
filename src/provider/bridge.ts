/**
 * Pure provider bridge rules shared by the injected page script and content script.
 */
import { unknownError, type WalletRpcError } from "../background/wallet-rpc-errors";
import { isUuid } from "../shared/ids";
import { hasOnlyKnownKeys, isJson, isRecord, type Json } from "../shared/json";
import { isWalletOrigin } from "../shared/origin";
import { type ProviderChain, readProviderChain } from "./add-chain-params";
import {
  type ProviderAccountsResult,
  type ProviderDeclareResult,
  type ProviderInvokeCall,
  type ProviderInvokeResult,
  type ProviderPayload,
  providerAccountsResult,
  providerDeclareResult,
  providerInvokeCalls,
  providerInvokeResult,
  providerStringArrayResult,
  providerSwitchChainId,
  readTypedDataParam,
  toProviderPayload as toProviderPayloadResult,
} from "./bridge-results";
import { type ProviderDeclare, readProviderDeclare } from "./declare-params";
import { type ProviderWatchAsset, readProviderWatchAsset } from "./watch-asset-params";

/** Marker for page-to-content wallet provider requests.
 */
export const CONTENT_TARGET = "mc-wallet:content";
/** Marker for content-to-page wallet provider responses.
 */
export const PAGE_TARGET = "mc-wallet:page";
/** Maximum unresolved in-page provider requests kept in memory.
 */
export const MAX_PENDING_PROVIDER_REQUESTS = 100;

/**
 * Re-exported so the content script maps background results in one import.
 */
export const toProviderPayload = toProviderPayloadResult;

/** Provider methods exposed to dapp pages.
 */
export type ProviderMethod =
  | "mc_accounts"
  | "mc_requestAccounts"
  | "wallet_addDeclareTransaction"
  | "wallet_addInvokeTransaction"
  | "wallet_addStarknetChain"
  | "wallet_getPermissions"
  | "wallet_requestAccounts"
  | "wallet_requestChainId"
  | "wallet_signTypedData"
  | "wallet_switchStarknetChain"
  | "wallet_watchAsset";

/**
 * Page-originated provider request shape.
 */
export type ProviderRequestArguments = {
  readonly method: ProviderMethod;
  readonly params?: Json;
};

/**
 * Content-bridge provider request shape.
 */
export type ProviderRequest = {
  readonly id: string;
  readonly method: ProviderMethod;
  readonly params?: Json;
};

/**
 * Page-targeted provider response shape. Rejections carry a spec error object.
 */
export type ProviderResponse =
  | {
      readonly error: WalletRpcError;
      readonly id: string;
      readonly result?: never;
      readonly target: typeof PAGE_TARGET;
    }
  | {
      readonly error?: never;
      readonly id: string;
      readonly result:
        | ProviderAccountsResult
        | ProviderDeclareResult
        | ProviderInvokeResult
        | readonly string[]
        | boolean
        | string;
      readonly target: typeof PAGE_TARGET;
    };

/**
 * Narrows an unknown value to a spec `{ code, message, data? }` error object.
 */
export const isWalletRpcError = (value: unknown): value is WalletRpcError =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["code", "data", "message"]) &&
  typeof value.code === "number" &&
  Number.isInteger(value.code) &&
  typeof value.message === "string" &&
  value.message.length > 0 &&
  (value.data === undefined || typeof value.data === "string");

/**
 * Rebuilds a coded Error from a spec wallet error so a dapp can branch on
 * `.code`/`.data`; passing the object to Error() would stringify it to
 * "[object Object]" and drop the code.
 */
export const walletRpcException = (error: WalletRpcError): Error => {
  const exception = new Error(error.message);
  (exception as { code?: number }).code = error.code;
  if (error.data !== undefined) {
    (exception as { data?: string }).data = error.data;
  }
  return exception;
};

/**
 * Minimal message-event fields needed for page trust checks.
 */
export type PageMessageSource = Pick<MessageEvent<unknown>, "origin" | "source">;

/**
 * Background runtime messages exposed through the dapp provider bridge.
 */
export type RuntimeMessage =
  | {
      readonly chain: ProviderChain;
      readonly origin: string;
      readonly type: "wallet.addStarknetChain";
    }
  | {
      readonly declare: ProviderDeclare;
      readonly origin: string;
      readonly type: "wallet.addDeclareTransaction";
    }
  | {
      readonly calls: readonly ProviderInvokeCall[];
      readonly origin: string;
      readonly type: "wallet.addInvokeTransaction";
    }
  | {
      readonly origin: string;
      readonly type: "wallet.getChainId";
    }
  | {
      readonly origin: string;
      readonly type: "wallet.getGrantedAccounts";
    }
  | {
      readonly origin: string;
      readonly type: "wallet.getPermissions";
    }
  | {
      readonly origin: string;
      readonly type: "wallet.requestAccounts";
    }
  | {
      readonly origin: string;
      readonly typedData: Json;
      readonly type: "wallet.signTypedData";
    }
  | {
      readonly chainId: string;
      readonly origin: string;
      readonly type: "wallet.switchChain";
    }
  | {
      readonly asset: ProviderWatchAsset;
      readonly origin: string;
      readonly type: "wallet.watchAsset";
    };

/**
 * Checks that a window message came from the same page and origin.
 */
export const isTrustedPageMessage = (
  event: PageMessageSource,
  pageWindow: Window,
  origin: string,
): boolean => event.source === pageWindow && event.origin === origin;

const isProviderMethod = (value: unknown): value is ProviderMethod =>
  value === "mc_accounts" ||
  value === "mc_requestAccounts" ||
  value === "wallet_addDeclareTransaction" ||
  value === "wallet_addInvokeTransaction" ||
  value === "wallet_addStarknetChain" ||
  value === "wallet_getPermissions" ||
  value === "wallet_requestAccounts" ||
  value === "wallet_requestChainId" ||
  value === "wallet_signTypedData" ||
  value === "wallet_switchStarknetChain" ||
  value === "wallet_watchAsset";

const readProviderParams = (method: ProviderMethod, params: unknown): Json | null | undefined => {
  if (params === undefined) {
    return undefined;
  }
  return (method === "wallet_addDeclareTransaction" ||
    method === "wallet_addInvokeTransaction" ||
    method === "wallet_addStarknetChain" ||
    method === "wallet_signTypedData" ||
    method === "wallet_switchStarknetChain" ||
    method === "wallet_watchAsset") &&
    isJson(params)
    ? params
    : null;
};

/**
 * Checks whether the in-page provider can queue another unresolved request.
 */
export const canQueueProviderRequest = (pendingCount: number): boolean =>
  Number.isSafeInteger(pendingCount) &&
  pendingCount >= 0 &&
  pendingCount < MAX_PENDING_PROVIDER_REQUESTS;

/**
 * Parses direct dapp calls to the injected provider request function.
 */
export const readProviderRequestArguments = (value: unknown): ProviderRequestArguments | null => {
  if (
    isRecord(value) &&
    hasOnlyKnownKeys(value, ["method", "params"]) &&
    isProviderMethod(value.method)
  ) {
    const params = readProviderParams(value.method, value.params);
    if (params === null) {
      return null;
    }
    return {
      method: value.method,
      ...(params === undefined ? {} : { params }),
    };
  }
  if (
    isRecord(value) &&
    hasOnlyKnownKeys(value, ["params", "type"]) &&
    isProviderMethod(value.type)
  ) {
    const params = readProviderParams(value.type, value.params);
    if (params === null) {
      return null;
    }
    return {
      method: value.type,
      ...(params === undefined ? {} : { params }),
    };
  }
  return null;
};

/**
 * Parses page provider messages without trusting arbitrary window traffic.
 */
export const readProviderRequest = (value: unknown): ProviderRequest | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["id", "method", "params", "target"]) ||
    value.target !== CONTENT_TARGET ||
    typeof value.id !== "string" ||
    !isUuid(value.id) ||
    !isProviderMethod(value.method)
  ) {
    return null;
  }

  const params = readProviderParams(value.method, value.params);
  if (params === null) {
    return null;
  }
  return {
    id: value.id,
    method: value.method,
    ...(params === undefined ? {} : { params }),
  };
};

/**
 * Parses content-script responses before resolving in-page provider requests.
 */
export const readProviderResponse = (value: unknown): ProviderResponse | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["error", "id", "result", "target"]) ||
    value.target !== PAGE_TARGET ||
    typeof value.id !== "string" ||
    !isUuid(value.id) ||
    (value.error !== undefined && !isWalletRpcError(value.error)) ||
    (value.error !== undefined && Object.hasOwn(value, "result")) ||
    (value.error === undefined && !Object.hasOwn(value, "result"))
  ) {
    return null;
  }

  if (value.error === undefined) {
    const result =
      providerAccountsResult(value.result) ??
      providerInvokeResult(value.result) ??
      providerDeclareResult(value.result) ??
      providerStringArrayResult(value.result) ??
      (typeof value.result === "boolean" ? value.result : null) ??
      (typeof value.result === "string" && value.result.length > 0 ? value.result : null);
    return result ? { id: value.id, result, target: PAGE_TARGET } : null;
  }

  return {
    id: value.id,
    error: value.error,
    target: PAGE_TARGET,
  };
};

/**
 * Maps supported provider methods to safe background messages.
 */
export const toRuntimeMessage = (
  request: ProviderRequest,
  origin: string,
): RuntimeMessage | null => {
  if (!isProviderMethod(request.method) || !isWalletOrigin(origin)) {
    return null;
  }
  if (request.method === "mc_accounts") {
    return { origin, type: "wallet.getGrantedAccounts" };
  }
  if (request.method === "wallet_getPermissions") {
    return { origin, type: "wallet.getPermissions" };
  }
  if (request.method === "wallet_watchAsset") {
    const asset = readProviderWatchAsset(request.params);
    return asset ? { asset, origin, type: "wallet.watchAsset" } : null;
  }
  if (request.method === "wallet_addInvokeTransaction") {
    const calls = providerInvokeCalls(request.params);
    return calls ? { calls, origin, type: "wallet.addInvokeTransaction" } : null;
  }
  if (request.method === "wallet_addStarknetChain") {
    const chain = readProviderChain(request.params);
    return chain ? { chain, origin, type: "wallet.addStarknetChain" } : null;
  }
  if (request.method === "wallet_addDeclareTransaction") {
    const declare = readProviderDeclare(request.params);
    return declare ? { declare, origin, type: "wallet.addDeclareTransaction" } : null;
  }
  if (request.method === "wallet_requestChainId") {
    return { origin, type: "wallet.getChainId" };
  }
  if (request.method === "wallet_signTypedData") {
    const typedData = readTypedDataParam(request.params);
    return typedData === null ? null : { origin, typedData, type: "wallet.signTypedData" };
  }
  if (request.method === "wallet_switchStarknetChain") {
    const chainId = providerSwitchChainId(request.params);
    return chainId ? { chainId, origin, type: "wallet.switchChain" } : null;
  }
  return { origin, type: "wallet.requestAccounts" };
};

/**
 * Builds a page-targeted provider response for the in-page script.
 */
export const providerResponse = (
  request: ProviderRequest,
  payload: ProviderPayload,
): ProviderResponse => {
  if (payload.error !== undefined) {
    return { error: payload.error, id: request.id, target: PAGE_TARGET };
  }
  const result =
    providerAccountsResult(payload.result) ??
    providerInvokeResult(payload.result) ??
    providerDeclareResult(payload.result) ??
    providerStringArrayResult(payload.result) ??
    (typeof payload.result === "boolean" ? payload.result : null) ??
    (typeof payload.result === "string" && payload.result.length > 0 ? payload.result : null);
  if (result === null || result === undefined) {
    return { error: unknownError(), id: request.id, target: PAGE_TARGET };
  }

  return { id: request.id, result, target: PAGE_TARGET };
};
