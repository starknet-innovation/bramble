/**
 * Pure provider bridge rules shared by the injected page script and content script.
 */
import { isUuid } from "../shared/ids";
import { hasOnlyKnownKeys, isJson, isRecord, type Json } from "../shared/json";
import { isWalletOrigin } from "../shared/origin";
import { type AccountRef, isAccountRef } from "../storage/vault-schema";

/**
 * Marker for page-to-content wallet provider requests.
 */
export const CONTENT_TARGET = "mc-wallet:content";
/**
 * Marker for content-to-page wallet provider responses.
 */
export const PAGE_TARGET = "mc-wallet:page";
/**
 * Maximum unresolved in-page provider requests kept in memory.
 */
export const MAX_PENDING_PROVIDER_REQUESTS = 100;

/**
 * Provider methods exposed to dapp pages.
 */
export type ProviderMethod =
  | "mc_accounts"
  | "mc_requestAccounts"
  | "wallet_addInvokeTransaction"
  | "wallet_requestAccounts"
  | "wallet_requestChainId"
  | "wallet_signTypedData"
  | "wallet_switchStarknetChain";

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

type ProviderAccountsResult = {
  readonly accounts: readonly AccountRef[];
  readonly ok: true;
};

type ProviderChainIdResult = {
  readonly chainId: string;
  readonly ok: true;
};

type ProviderInvokeResult = {
  readonly transaction_hash: string;
};

type ProviderInvokeCall = {
  readonly calldata: readonly string[];
  readonly contractAddress: string;
  readonly entrypoint: string;
};

/**
 * Page-targeted provider response shape.
 */
export type ProviderResponse =
  | {
      readonly error: string;
      readonly id: string;
      readonly result?: never;
      readonly target: typeof PAGE_TARGET;
    }
  | {
      readonly error?: never;
      readonly id: string;
      readonly result:
        | ProviderAccountsResult
        | ProviderInvokeResult
        | readonly string[]
        | boolean
        | string;
      readonly target: typeof PAGE_TARGET;
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
  value === "wallet_addInvokeTransaction" ||
  value === "wallet_requestAccounts" ||
  value === "wallet_requestChainId" ||
  value === "wallet_signTypedData" ||
  value === "wallet_switchStarknetChain";

const readProviderParams = (method: ProviderMethod, params: unknown): Json | null | undefined => {
  if (params === undefined) {
    return undefined;
  }
  return (method === "wallet_addInvokeTransaction" ||
    method === "wallet_signTypedData" ||
    method === "wallet_switchStarknetChain") &&
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

const providerChainIdResult = (result: unknown): ProviderChainIdResult | null => {
  if (
    !isRecord(result) ||
    !isJson(result) ||
    !hasOnlyKnownKeys(result, ["chainId", "ok"]) ||
    result.ok !== true ||
    typeof result.chainId !== "string" ||
    !/^0x[0-9a-f]+$/.test(result.chainId)
  ) {
    return null;
  }

  return {
    chainId: result.chainId,
    ok: true,
  };
};

const providerInvokeResult = (result: unknown): ProviderInvokeResult | null =>
  isRecord(result) &&
  isJson(result) &&
  hasOnlyKnownKeys(result, ["transaction_hash"]) &&
  typeof result.transaction_hash === "string" &&
  /^0x[0-9a-f]+$/.test(result.transaction_hash)
    ? { transaction_hash: result.transaction_hash }
    : null;

const providerInvokeCalls = (params: Json | undefined): readonly ProviderInvokeCall[] | null => {
  if (!isRecord(params) || !hasOnlyKnownKeys(params, ["calls"]) || !Array.isArray(params.calls)) {
    return null;
  }
  const calls = params.calls.filter(
    (call): call is ProviderInvokeCall =>
      isRecord(call) &&
      hasOnlyKnownKeys(call, ["calldata", "contractAddress", "entrypoint"]) &&
      typeof call.contractAddress === "string" &&
      typeof call.entrypoint === "string" &&
      Array.isArray(call.calldata) &&
      call.calldata.every((item) => typeof item === "string"),
  );
  return calls.length === params.calls.length && calls.length > 0 ? calls : null;
};

const providerSwitchChainId = (params: Json | undefined): string | null =>
  isRecord(params) &&
  hasOnlyKnownKeys(params, ["chainId"]) &&
  typeof params.chainId === "string" &&
  /^0x[0-9a-f]+$/.test(params.chainId)
    ? params.chainId
    : null;

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

const sanitizeAccountRef = (account: AccountRef): AccountRef => ({
  address: account.address,
  classHash: account.classHash,
  derivation: {
    accountIndex: account.derivation.accountIndex,
    addressIndex: account.derivation.addressIndex,
    kind: account.derivation.kind,
  },
  id: account.id,
  networkId: account.networkId,
  publicKeyX: account.publicKeyX,
  publicKeyY: account.publicKeyY,
});

const hasUniqueStrings = (values: readonly string[]): boolean =>
  new Set(values).size === values.length;

const providerAccountsResult = (result: unknown): ProviderAccountsResult | null => {
  if (
    !isRecord(result) ||
    !isJson(result) ||
    !hasOnlyKnownKeys(result, ["accounts", "ok"]) ||
    result.ok !== true ||
    !Array.isArray(result.accounts) ||
    !result.accounts.every(isAccountRef) ||
    !hasUniqueStrings(result.accounts.map((account) => account.id))
  ) {
    return null;
  }

  return { accounts: result.accounts.map(sanitizeAccountRef), ok: true };
};

const providerStringArrayResult = (result: unknown): readonly string[] | null =>
  Array.isArray(result) &&
  isJson(result) &&
  result.every((item) => typeof item === "string" && item.length > 0)
    ? result
    : null;

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
    (value.error !== undefined && (typeof value.error !== "string" || value.error.length === 0)) ||
    (value.error !== undefined && Object.hasOwn(value, "result")) ||
    (value.error === undefined && !Object.hasOwn(value, "result"))
  ) {
    return null;
  }

  if (value.error === undefined) {
    const result =
      providerAccountsResult(value.result) ??
      providerInvokeResult(value.result) ??
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
  if (request.method === "wallet_addInvokeTransaction") {
    const calls = providerInvokeCalls(request.params);
    return calls ? { calls, origin, type: "wallet.addInvokeTransaction" } : null;
  }
  if (request.method === "wallet_requestChainId") {
    return { origin, type: "wallet.getChainId" };
  }
  if (request.method === "wallet_signTypedData") {
    return request.params === undefined
      ? null
      : { origin, typedData: request.params, type: "wallet.signTypedData" };
  }
  if (request.method === "wallet_switchStarknetChain") {
    const chainId = providerSwitchChainId(request.params);
    return chainId ? { chainId, origin, type: "wallet.switchChain" } : null;
  }
  return { origin, type: "wallet.requestAccounts" };
};

/**
 * Converts background runtime results into provider success or rejection payloads.
 */
export const toProviderPayload = (
  result: unknown,
  method: ProviderMethod = "mc_accounts",
): { readonly error?: string; readonly result?: unknown } => {
  if (isRecord(result) && typeof result.error === "string") {
    return { error: result.error };
  }
  if (isRecord(result) && result.ok === false && isRecord(result.pending)) {
    return { error: "approval pending" };
  }
  if (method === "wallet_signTypedData") {
    const signature = isRecord(result) && result.ok === true ? result.signature : null;
    return isRecord(signature) &&
      typeof signature.r === "string" &&
      typeof signature.s === "string" &&
      /^0x[0-9a-f]+$/.test(signature.r) &&
      /^0x[0-9a-f]+$/.test(signature.s)
      ? { result: [signature.r, signature.s] }
      : { error: "invalid provider response" };
  }
  const chainId = providerChainIdResult(result);
  if (method === "wallet_switchStarknetChain" && chainId) {
    return { result: true };
  }
  if (chainId) {
    return { result: chainId.chainId };
  }
  if (
    method === "wallet_addInvokeTransaction" &&
    isRecord(result) &&
    typeof result.transactionHash === "string"
  ) {
    return { result: { transaction_hash: result.transactionHash } };
  }
  const accounts = providerAccountsResult(result);
  if (!accounts) {
    return { error: "invalid provider response" };
  }
  if (method === "wallet_requestAccounts") {
    return { result: accounts.accounts.map((account) => account.address) };
  }
  return { result: accounts };
};

/**
 * Builds a page-targeted provider response for the in-page script.
 */
export const providerResponse = (
  request: ProviderRequest,
  payload: { readonly error?: string; readonly result?: unknown },
): ProviderResponse => {
  if (payload.error !== undefined) {
    const error = payload.error.length === 0 ? "invalid provider response" : payload.error;
    return { error, id: request.id, target: PAGE_TARGET };
  }
  const result =
    providerAccountsResult(payload.result) ??
    providerInvokeResult(payload.result) ??
    providerStringArrayResult(payload.result) ??
    (typeof payload.result === "boolean" ? payload.result : null) ??
    (typeof payload.result === "string" && payload.result.length > 0 ? payload.result : null);
  if (!result) {
    return { error: "invalid provider response", id: request.id, target: PAGE_TARGET };
  }

  return { id: request.id, result, target: PAGE_TARGET };
};
