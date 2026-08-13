/**
 * Authenticated or relay-backed Starkscan HTTP client and endpoint surface.
 */

import { WalletError } from "@mc-wallet/core/errors";
import {
  HTTP_BODY_LIMITS,
  readBoundedText,
  UNTRUSTED_REQUEST_INIT,
} from "@mc-wallet/core/http-json";
import { isRecord } from "@mc-wallet/core/json";
import { trimTrailingSlashes } from "@mc-wallet/core/service-url";
import { canonicalFelt, isNonZeroStarkFieldElement } from "@mc-wallet/wallet-model/networks";
import {
  parseStarkscanAddress,
  parseStarkscanAddressActivity,
  parseStarkscanAddressTransaction,
  parseStarkscanBlock,
  parseStarkscanContract,
  parseStarkscanEvent,
  parseStarkscanHoldings,
  parseStarkscanPage,
  parseStarkscanTokenBalance,
  parseStarkscanTransfer,
} from "./starkscan-parsers";
import type {
  StarkscanAddressActivity,
  StarkscanAddressSummary,
  StarkscanAddressTransaction,
  StarkscanBlock,
  StarkscanChainId,
  StarkscanContractEvent,
  StarkscanContractMetadata,
  StarkscanPage,
  StarkscanPageOptions,
  StarkscanTokenBalance,
  StarkscanTokenHoldings,
  StarkscanTransfer,
} from "./starkscan-types";

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_PAGE_LIMIT = 200;
/**
 * Fetch-compatible transport injected at the Starkscan trust boundary.
 */
export type StarkscanHttp = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Construction options for a typed Starkscan client.
 */
export type StarkscanClientOptions = {
  readonly apiKey?: string;
  readonly baseUrl: string;
  readonly http?: StarkscanHttp;
  readonly timeoutMs?: number;
};

/**
 * Structured, non-secret Starkscan failure safe for caller-level fallback logic.
 */
export class StarkscanError extends Error {
  public constructor(
    message: string,
    public readonly status: number | null,
    public readonly code: string | null = null,
    public readonly requestId: string | null = null,
    public readonly retryAfter: string | null = null,
  ) {
    super(message);
    this.name = "StarkscanError";
  }
}

/**
 * Typed read-only Starkscan endpoints consumed by wallet and terminal adapters.
 */
export type StarkscanClient = {
  readonly getAddress: (
    chainId: StarkscanChainId,
    address: string,
  ) => Promise<StarkscanAddressSummary>;
  readonly getAddressTransactions: (
    chainId: StarkscanChainId,
    address: string,
    options?: StarkscanPageOptions,
  ) => Promise<StarkscanPage<StarkscanAddressTransaction>>;
  readonly getAddressActivity: (
    chainId: StarkscanChainId,
    address: string,
    options?: StarkscanPageOptions,
  ) => Promise<StarkscanPage<StarkscanAddressActivity>>;
  readonly getAddressTransfers: (
    chainId: StarkscanChainId,
    address: string,
    options?: StarkscanPageOptions,
  ) => Promise<StarkscanPage<StarkscanTransfer>>;
  readonly getTokenHoldings: (
    chainId: StarkscanChainId,
    address: string,
    options?: StarkscanPageOptions,
  ) => Promise<StarkscanTokenHoldings>;
  readonly getTokenBalance: (
    chainId: StarkscanChainId,
    tokenAddress: string,
    ownerAddress: string,
    blockTag?: string,
  ) => Promise<StarkscanTokenBalance>;
  readonly getContract: (
    chainId: StarkscanChainId,
    address: string,
  ) => Promise<StarkscanContractMetadata>;
  readonly getContractEvents: (
    chainId: StarkscanChainId,
    address: string,
    options?: StarkscanPageOptions,
  ) => Promise<StarkscanPage<StarkscanContractEvent>>;
  readonly getBlocks: (
    chainId: StarkscanChainId,
    options?: StarkscanPageOptions,
  ) => Promise<StarkscanPage<StarkscanBlock>>;
  readonly getEvents: (
    chainId: StarkscanChainId,
    options?: StarkscanPageOptions,
  ) => Promise<StarkscanPage<StarkscanContractEvent>>;
};

const inputAddress = (value: string): string => {
  const canonical = canonicalFelt(value);
  if (canonical === null || !isNonZeroStarkFieldElement(canonical)) {
    throw new StarkscanError("Invalid Starkscan address", null);
  }
  return canonical;
};

const pageQuery = (options: StarkscanPageOptions = {}): URLSearchParams => {
  const limit = options.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
    throw new StarkscanError("Invalid Starkscan page limit", null);
  }
  const query = new URLSearchParams({ limit: String(limit) });
  if (options.cursor !== undefined) {
    if (options.cursor.length === 0 || options.cursor.length > 2_048) {
      throw new StarkscanError("Invalid Starkscan cursor", null);
    }
    query.set("cursor", options.cursor);
  }
  return query;
};

const readError = async (response: Response, deadline: AbortSignal): Promise<StarkscanError> => {
  const retryAfter = response.headers.get("retry-after");
  const requestIdHeader = response.headers.get("x-request-id");
  try {
    const value = JSON.parse(
      await readBoundedText(response, HTTP_BODY_LIMITS.errorDetail, deadline),
    ) as unknown;
    if (isRecord(value)) {
      const message =
        typeof value["message"] === "string" ? value["message"] : "Starkscan request failed";
      return new StarkscanError(
        message.slice(0, 512),
        response.status,
        typeof value["code"] === "string" ? value["code"].slice(0, 128) : null,
        typeof value["requestId"] === "string" ? value["requestId"].slice(0, 256) : requestIdHeader,
        retryAfter,
      );
    }
  } catch {
    // Fall through to a status-only error without reflecting hostile body text.
  }
  return new StarkscanError(
    "Starkscan request failed",
    response.status,
    null,
    requestIdHeader,
    retryAfter,
  );
};

// One deadline per exchange, created before the request and carried into the
// body read, so connect, headers, and every body chunk share a single budget.
// Returning it alongside the response is what lets the reader cancel a stalled
// stream instead of only aborting the socket.
const fetchResponse = async (
  http: StarkscanHttp,
  url: string,
  apiKey: string | undefined,
  timeoutMs: number,
): Promise<{ readonly deadline: AbortSignal; readonly response: Response }> => {
  const deadline = AbortSignal.timeout(timeoutMs);
  try {
    return {
      deadline,
      response: await http(url, {
        ...UNTRUSTED_REQUEST_INIT,
        headers: {
          accept: "application/json",
          ...(apiKey === undefined ? {} : { "X-Starkscan-Api-Key": apiKey }),
        },
        method: "GET",
        signal: deadline,
      }),
    };
  } catch {
    throw new StarkscanError("Starkscan unavailable", null);
  }
};

// The cap is spent as the bytes arrive, never after them: a hostile explorer
// that answers `200` and streams forever is cut off at the budget rather than
// buffered whole and then measured, which is what a `text()`-then-check does.
const parseResponse = async <T>(
  { deadline, response }: { readonly deadline: AbortSignal; readonly response: Response },
  parse: (value: unknown) => T,
): Promise<T> => {
  if (!response.ok) {
    throw await readError(response, deadline);
  }
  let text: string;
  try {
    text = await readBoundedText(response, HTTP_BODY_LIMITS.starkscan, deadline);
  } catch (error) {
    // The reader's own reason — over budget, or out of time — is a curated,
    // non-reflective string, so it is safe to keep and more useful than one
    // message covering both.
    throw new StarkscanError(
      error instanceof WalletError ? error.message : "Starkscan response unavailable",
      response.status,
    );
  }
  try {
    return parse(JSON.parse(text) as unknown);
  } catch (error) {
    if (error instanceof StarkscanError) throw error;
    throw new StarkscanError("Invalid Starkscan response", response.status);
  }
};

/**
 * Creates a read-only Starkscan client. It validates every consumed field,
 * never logs the API key, and surfaces rate-limit metadata so callers can fall
 * back without blind retries.
 *
 * Responses are read through the shared bounded reader (`../shared/http-json`):
 * one deadline covers the whole exchange and the body is cut off at
 * `HTTP_BODY_LIMITS.starkscan` as it streams, so neither an endless body nor a
 * stalled one can be buffered into the worker. Requests carry the same
 * hardening as the wallet's other untrusted boundaries — no cookies, no
 * referrer, redirects refused. Every failure is a {@link StarkscanError}.
 */
export const createStarkscanClient = ({
  apiKey,
  baseUrl,
  http = (url, init) => fetch(url, init),
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: StarkscanClientOptions): StarkscanClient => {
  const base = trimTrailingSlashes(baseUrl);
  const request = async <T>(
    chainId: StarkscanChainId,
    route: string,
    parse: (value: unknown) => T,
    query?: URLSearchParams,
  ): Promise<T> => {
    const url = `${base}/${chainId}/${route}${query === undefined ? "" : `?${query.toString()}`}`;
    return parseResponse(await fetchResponse(http, url, apiKey, timeoutMs), parse);
  };

  return {
    getAddress: (chainId, address) =>
      request(chainId, `address/${inputAddress(address)}`, parseStarkscanAddress),
    getAddressTransactions: (chainId, address, options) =>
      request(
        chainId,
        `address/${inputAddress(address)}/transactions`,
        (value) => parseStarkscanPage(value, parseStarkscanAddressTransaction),
        pageQuery(options),
      ),
    getAddressActivity: (chainId, address, options) =>
      request(
        chainId,
        `address/${inputAddress(address)}/activity`,
        (value) => parseStarkscanPage(value, parseStarkscanAddressActivity),
        pageQuery(options),
      ),
    getAddressTransfers: (chainId, address, options) => {
      const query = pageQuery(options);
      query.set("address", inputAddress(address));
      return request(
        chainId,
        "transfers",
        (value) => parseStarkscanPage(value, parseStarkscanTransfer),
        query,
      );
    },
    getTokenHoldings: (chainId, address, options) =>
      request(
        chainId,
        `address/${inputAddress(address)}/token-holdings`,
        parseStarkscanHoldings,
        pageQuery(options),
      ),
    getTokenBalance: (chainId, tokenAddress, ownerAddress, blockTag = "latest") => {
      if (blockTag.length === 0 || blockTag.length > 80) {
        throw new StarkscanError("Invalid Starkscan block tag", null);
      }
      const query = new URLSearchParams({ block_tag: blockTag });
      return request(
        chainId,
        `token/${inputAddress(tokenAddress)}/balance-of/${inputAddress(ownerAddress)}`,
        parseStarkscanTokenBalance,
        query,
      );
    },
    getContract: (chainId, address) =>
      request(chainId, `contract/${inputAddress(address)}`, parseStarkscanContract),
    getContractEvents: (chainId, address, options) =>
      request(
        chainId,
        `contract/${inputAddress(address)}/events`,
        (value) => parseStarkscanPage(value, parseStarkscanEvent),
        pageQuery(options),
      ),
    getBlocks: (chainId, options) =>
      request(
        chainId,
        "blocks",
        (value) => parseStarkscanPage(value, parseStarkscanBlock),
        pageQuery(options),
      ),
    getEvents: (chainId, options) =>
      request(
        chainId,
        "events",
        (value) => parseStarkscanPage(value, parseStarkscanEvent),
        pageQuery(options),
      ),
  };
};
