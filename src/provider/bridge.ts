/**
 * Pure provider bridge rules shared by the injected page script and content script.
 */

import { isUuid } from "../shared/ids";
import type { Json } from "../shared/json";
import { hasOnlyKnownKeys, isRecord } from "../shared/json";
import { isWalletOrigin } from "../shared/origin";
import { unknownError, type WalletRpcError } from "../shared/rpc-errors";
import { type ProviderChain, readProviderChain } from "./add-chain-params";
import {
  isRequestAccountsParams,
  type ProviderAccountsResult,
  type ProviderDeclareResult,
  type ProviderDeploymentData,
  type ProviderInvokeResult,
  type ProviderPayload,
  providerAccountsResult,
  providerDeclareResult,
  providerInvokeResult,
  providerStringArrayResult,
  providerSwitchChainId,
  readApiVersionParam,
  readTypedDataParam,
  toProviderPayload as toProviderPayloadResult,
} from "./bridge-results";
import { type ProviderDeclare, readProviderDeclare } from "./declare-params";
import { providerDeploymentResult } from "./deployment-bridge";
import { type ProviderInvokeCall, providerInvokeCalls } from "./invoke-params";
import { readProviderParams } from "./request-params";
import {
  providerStrk20Balances,
  providerStrk20CallAndProof,
  readStrk20BalancesParams,
  readStrk20InvokeParams,
  readStrk20PrepareParams,
  type Strk20Action,
  type Strk20BalanceEntry,
  type Strk20CallAndProof,
} from "./strk20-bridge";
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
  | "wallet_deploymentData"
  | "wallet_addStarknetChain"
  | "wallet_getPermissions"
  | "wallet_requestAccounts"
  | "wallet_requestChainId"
  | "wallet_signTypedData"
  | "wallet_supportedSpecs"
  | "wallet_supportedWalletApi"
  | "wallet_strk20Balances"
  | "wallet_strk20InvokeTransaction"
  | "wallet_strk20PrepareInvoke"
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
        | ProviderDeploymentData
        | ProviderDeclareResult
        | ProviderInvokeResult
        | Strk20CallAndProof
        | readonly Strk20BalanceEntry[]
        | readonly string[]
        | boolean
        | string;
      readonly target: typeof PAGE_TARGET;
    };

/**
 * Narrows an unknown value to a spec `{ code, message, data? }` error object.
 */
const isWalletRpcError = (value: unknown): value is WalletRpcError =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["code", "data", "message"]) &&
  typeof value["code"] === "number" &&
  Number.isInteger(value["code"]) &&
  typeof value["message"] === "string" &&
  value["message"].length > 0 &&
  (value["data"] === undefined || typeof value["data"] === "string");

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
      readonly apiVersion?: string;
      readonly origin: string;
      readonly type: "wallet.deploymentData";
    }
  | {
      readonly origin: string;
      readonly type: "wallet.getChainId";
    }
  | {
      readonly apiVersion?: string;
      readonly origin: string;
      readonly type: "wallet.supportedSpecs";
    }
  | {
      readonly apiVersion?: string;
      readonly origin: string;
      readonly type: "wallet.supportedWalletApi";
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
      readonly silent?: boolean;
      readonly type: "wallet.requestAccounts";
    }
  | {
      readonly origin: string;
      readonly typedData: Json;
      readonly type: "wallet.signTypedData";
    }
  | {
      readonly origin: string;
      readonly tokens: readonly string[];
      readonly type: "wallet.strk20Balances";
    }
  | {
      readonly actions: readonly Strk20Action[];
      readonly origin: string;
      readonly simulate: boolean;
      readonly type: "wallet.strk20PrepareInvoke";
    }
  | {
      readonly actions: readonly Strk20Action[];
      readonly origin: string;
      readonly type: "wallet.strk20InvokeTransaction";
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
  value === "wallet_deploymentData" ||
  value === "wallet_addStarknetChain" ||
  value === "wallet_getPermissions" ||
  value === "wallet_requestAccounts" ||
  value === "wallet_requestChainId" ||
  value === "wallet_signTypedData" ||
  value === "wallet_supportedSpecs" ||
  value === "wallet_supportedWalletApi" ||
  value === "wallet_strk20Balances" ||
  value === "wallet_strk20InvokeTransaction" ||
  value === "wallet_strk20PrepareInvoke" ||
  value === "wallet_switchStarknetChain" ||
  value === "wallet_watchAsset";

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
    isProviderMethod(value["method"])
  ) {
    const params = readProviderParams(value["method"], value["params"]);
    if (params === null) {
      return null;
    }
    return {
      method: value["method"],
      ...(params === undefined ? {} : { params }),
    };
  }
  if (
    isRecord(value) &&
    hasOnlyKnownKeys(value, ["params", "type"]) &&
    isProviderMethod(value["type"])
  ) {
    const params = readProviderParams(value["type"], value["params"]);
    if (params === null) {
      return null;
    }
    return {
      method: value["type"],
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
    value["target"] !== CONTENT_TARGET ||
    typeof value["id"] !== "string" ||
    !isUuid(value["id"]) ||
    !isProviderMethod(value["method"])
  ) {
    return null;
  }

  const params = readProviderParams(value["method"], value["params"]);
  if (params === null) {
    return null;
  }
  return {
    id: value["id"],
    method: value["method"],
    ...(params === undefined ? {} : { params }),
  };
};

// Narrows a raw success value to the first provider result shape it satisfies,
// else null. One source of truth for the response reader and the builder below.
const parseProviderResult = (raw: unknown) =>
  providerAccountsResult(raw) ??
  providerDeploymentResult(raw) ??
  providerInvokeResult(raw) ??
  providerDeclareResult(raw) ??
  providerStrk20CallAndProof(raw) ??
  providerStrk20Balances(raw) ??
  providerStringArrayResult(raw) ??
  (typeof raw === "boolean" ? raw : null) ??
  (typeof raw === "string" && raw.length > 0 ? raw : null);

// A valid page response: page target, UUID id, and EXACTLY one of error/result.
type ProviderResponseEnvelope = {
  readonly error?: WalletRpcError;
  readonly id: string;
  readonly result?: unknown;
  readonly target: typeof PAGE_TARGET;
};
const isProviderResponseEnvelope = (value: unknown): value is ProviderResponseEnvelope =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["error", "id", "result", "target"]) &&
  value["target"] === PAGE_TARGET &&
  typeof value["id"] === "string" &&
  isUuid(value["id"]) &&
  (value["error"] === undefined || isWalletRpcError(value["error"])) &&
  (value["error"] !== undefined) !== Object.hasOwn(value, "result");
const readErrorEnvelope = (id: string, error: WalletRpcError): ProviderResponse => ({
  error,
  id,
  target: PAGE_TARGET,
});
// A `false` result is rejected here (as the original did), unlike providerResponse.
const readResultEnvelope = (id: string, rawResult: unknown): ProviderResponse | null => {
  const result = parseProviderResult(rawResult);
  return result ? { id, result, target: PAGE_TARGET } : null;
};
/**
 * Parses content-script responses before resolving in-page provider requests.
 */
export const readProviderResponse = (value: unknown): ProviderResponse | null => {
  if (!isProviderResponseEnvelope(value)) return null;
  return value["error"] === undefined
    ? readResultEnvelope(value["id"], value["result"])
    : readErrorEnvelope(value["id"], value["error"]);
};

type RuntimeBuilder = (params: Json | undefined, origin: string) => RuntimeMessage | null;

// Discovery methods gate on a valid optional api_version, echoing it back when
// present; a malformed api_version is rejected as a bad payload.
const versionedMessage = <
  T extends "wallet.deploymentData" | "wallet.supportedSpecs" | "wallet.supportedWalletApi",
>(
  params: Json | undefined,
  origin: string,
  type: T,
): { apiVersion?: string; origin: string; type: T } | null => {
  const apiVersion = readApiVersionParam(params);
  return apiVersion === null ? null : { origin, type, ...(apiVersion ? { apiVersion } : {}) };
};

// The legacy mc_requestAccounts alias shares wallet_requestAccounts' param gate.
const requestAccountsMessage: RuntimeBuilder = (params, origin) => {
  if (!isRequestAccountsParams(params)) {
    return null;
  }
  return {
    origin,
    ...(isRecord(params) && params["silent_mode"] === true ? { silent: true } : {}),
    type: "wallet.requestAccounts",
  };
};

// One builder per method, mirroring the original if-chain's normalize-then-wrap;
// exhaustive over ProviderMethod, so a new method cannot be routed without one.
const RUNTIME_BUILDERS: Record<ProviderMethod, RuntimeBuilder> = {
  mc_accounts: (_params, origin) => ({ origin, type: "wallet.getGrantedAccounts" }),
  mc_requestAccounts: requestAccountsMessage,
  wallet_requestAccounts: requestAccountsMessage,
  wallet_getPermissions: (params, origin) =>
    readApiVersionParam(params) === null ? null : { origin, type: "wallet.getPermissions" },
  wallet_requestChainId: (params, origin) =>
    readApiVersionParam(params) === null ? null : { origin, type: "wallet.getChainId" },
  wallet_supportedSpecs: (params, origin) =>
    versionedMessage(params, origin, "wallet.supportedSpecs"),
  wallet_supportedWalletApi: (params, origin) =>
    versionedMessage(params, origin, "wallet.supportedWalletApi"),
  wallet_deploymentData: (params, origin) =>
    versionedMessage(params, origin, "wallet.deploymentData"),
  wallet_watchAsset: (params, origin) => {
    const asset = readProviderWatchAsset(params);
    return asset ? { asset, origin, type: "wallet.watchAsset" } : null;
  },
  wallet_addInvokeTransaction: (params, origin) => {
    const calls = providerInvokeCalls(params);
    return calls ? { calls, origin, type: "wallet.addInvokeTransaction" } : null;
  },
  wallet_addStarknetChain: (params, origin) => {
    const chain = readProviderChain(params);
    return chain ? { chain, origin, type: "wallet.addStarknetChain" } : null;
  },
  wallet_addDeclareTransaction: (params, origin) => {
    const declare = readProviderDeclare(params);
    return declare ? { declare, origin, type: "wallet.addDeclareTransaction" } : null;
  },
  wallet_signTypedData: (params, origin) => {
    const typedData = readTypedDataParam(params);
    return typedData === null ? null : { origin, typedData, type: "wallet.signTypedData" };
  },
  wallet_strk20Balances: (params, origin) => {
    const tokens = readStrk20BalancesParams(params);
    return tokens ? { origin, tokens, type: "wallet.strk20Balances" } : null;
  },
  wallet_strk20PrepareInvoke: (params, origin) => {
    const prepared = readStrk20PrepareParams(params);
    return prepared
      ? {
          actions: prepared.actions,
          origin,
          simulate: prepared.simulate,
          type: "wallet.strk20PrepareInvoke",
        }
      : null;
  },
  wallet_strk20InvokeTransaction: (params, origin) => {
    const actions = readStrk20InvokeParams(params);
    return actions ? { actions, origin, type: "wallet.strk20InvokeTransaction" } : null;
  },
  wallet_switchStarknetChain: (params, origin) => {
    const chainId = providerSwitchChainId(params);
    return chainId ? { chainId, origin, type: "wallet.switchChain" } : null;
  },
};

/**
 * Maps supported provider methods to safe background messages.
 */
export const toRuntimeMessage = (
  request: ProviderRequest,
  origin: string,
): RuntimeMessage | null =>
  isProviderMethod(request.method) && isWalletOrigin(origin)
    ? RUNTIME_BUILDERS[request.method](request.params, origin)
    : null;

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
  const result = parseProviderResult(payload.result);
  return result === null
    ? { error: unknownError(), id: request.id, target: PAGE_TARGET }
    : { id: request.id, result, target: PAGE_TARGET };
};
