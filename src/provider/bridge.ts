/**
 * Pure provider bridge rules shared by the injected page script and content script.
 */
import { isUuid } from "../shared/ids";
import { hasOnlyKnownKeys, isJson, isRecord } from "../shared/json";
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
export type ProviderMethod = "mc_accounts" | "mc_requestAccounts";

/**
 * Page-originated provider request shape.
 */
export type ProviderRequestArguments = {
  readonly method: ProviderMethod;
};

/**
 * Content-bridge provider request shape.
 */
export type ProviderRequest = {
  readonly id: string;
  readonly method: string;
  readonly params?: unknown;
};

/**
 * Page-targeted provider response shape.
 */
export type ProviderResponse = {
  readonly error?: string;
  readonly id: string;
  readonly result?: unknown;
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
      readonly origin: string;
      readonly type: "wallet.getGrantedAccounts";
    }
  | {
      readonly origin: string;
      readonly type: "wallet.requestAccounts";
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
  value === "mc_accounts" || value === "mc_requestAccounts";

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
  if (!isRecord(value) || !hasOnlyKnownKeys(value, ["method"]) || !isProviderMethod(value.method)) {
    return null;
  }

  return {
    method: value.method,
  };
};

/**
 * Parses page provider messages without trusting arbitrary window traffic.
 */
export const readProviderRequest = (value: unknown): ProviderRequest | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["id", "method", "target"]) ||
    value.target !== CONTENT_TARGET ||
    typeof value.id !== "string" ||
    !isUuid(value.id) ||
    typeof value.method !== "string" ||
    value.method.length === 0
  ) {
    return null;
  }

  return {
    id: value.id,
    method: value.method,
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

const providerAccountsResult = (
  result: unknown,
): { readonly accounts: readonly AccountRef[]; readonly ok: true } | null => {
  if (
    !isRecord(result) ||
    !isJson(result) ||
    !hasOnlyKnownKeys(result, ["accounts", "ok"]) ||
    result.ok !== true ||
    !Array.isArray(result.accounts) ||
    !result.accounts.every(isAccountRef)
  ) {
    return null;
  }

  return { accounts: result.accounts.map(sanitizeAccountRef), ok: true };
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
    (value.error !== undefined && (typeof value.error !== "string" || value.error.length === 0)) ||
    (value.error !== undefined && "result" in value) ||
    (value.error === undefined && !("result" in value))
  ) {
    return null;
  }

  if (value.error === undefined) {
    const result = providerAccountsResult(value.result);
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
  if (request.params !== undefined || !isProviderMethod(request.method)) {
    return null;
  }
  if (request.method === "mc_accounts") {
    return { origin, type: "wallet.getGrantedAccounts" };
  }
  return { origin, type: "wallet.requestAccounts" };
};

/**
 * Converts background runtime results into provider success or rejection payloads.
 */
export const toProviderPayload = (
  result: unknown,
): { readonly error?: string; readonly result?: unknown } => {
  if (isRecord(result) && typeof result.error === "string") {
    return { error: result.error };
  }
  if (isRecord(result) && result.ok === false && isRecord(result.pending)) {
    return { error: "approval pending" };
  }
  const accounts = providerAccountsResult(result);
  return accounts ? { result: accounts } : { error: "invalid provider response" };
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
  const result = providerAccountsResult(payload.result);
  if (!result) {
    return { error: "invalid provider response", id: request.id, target: PAGE_TARGET };
  }

  return { id: request.id, result, target: PAGE_TARGET };
};
