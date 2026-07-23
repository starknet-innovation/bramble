/**
 * AVNU swap-aggregator boundary. The wallet's in-panel swap quotes and builds
 * its calldata through AVNU's public REST API (https://docs.avnu.fi), reached
 * only from the background worker through an injected fetch — this module
 * performs no signing and holds no secrets.
 *
 * Trust boundary: every AVNU response is UNTRUSTED input. Quotes are validated
 * field by field (felt addresses, hex amounts, finite USD figures) and must
 * echo the exact token pair that was requested; built calls are validated as
 * felts/entrypoint identifiers and are additionally policy-checked by the
 * background swap handler (an `approve` may only target the sell token) and
 * decoded by the call verifier before anything is signed. Failure behaviour:
 * network errors, malformed payloads, and unsupported networks all throw —
 * the wallet fails closed and never signs calldata it could not validate.
 */
import {
  isStarkFieldElement,
  STARKNET_NETWORKS,
  type StarknetNetworkId,
  sameFelt,
} from "./networks";

/**
 * Minimal HTTP response subset consumed from the injected fetch.
 */
export type SwapHttpResponse = {
  readonly json: () => Promise<unknown>;
  readonly ok: boolean;
};

/**
 * Injectable network fetch used only by the background worker. `init` carries
 * the POST body for the build endpoint.
 */
export type SwapHttp = (
  url: string,
  init?: {
    readonly body?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly method?: string;
  },
) => Promise<SwapHttpResponse>;

/**
 * AVNU API base URL per supported network. Devnet has no aggregator, so swaps
 * are unavailable there and the service throws before any request is made.
 */
export const AVNU_BASE_URLS: Readonly<Partial<Record<StarknetNetworkId, string>>> = {
  SN_MAIN: "https://starknet.api.avnu.fi",
  SN_SEPOLIA: "https://sepolia.api.avnu.fi",
};

/**
 * One validated AVNU quote: the exact sell/buy amounts (hex base units), the
 * USD figures the confirmation screen shows, and the id used to build calls.
 */
export type SwapQuote = {
  readonly buyAmount: string;
  readonly buyAmountInUsd: number;
  readonly buyTokenAddress: string;
  readonly gasFeesInUsd: number;
  readonly quoteId: string;
  readonly sellAmount: string;
  readonly sellAmountInUsd: number;
  readonly sellTokenAddress: string;
};

/**
 * One validated catalog entry from AVNU's verified token list: enough to let
 * the user FIND a token. Selecting an untracked entry still goes through the
 * wallet's add-token path, which reads name/symbol/decimals from the contract
 * on-chain — the catalog is a directory, never the source of truth.
 */
export type SwapCatalogToken = {
  readonly address: string;
  readonly decimals: number;
  readonly name: string;
  readonly symbol: string;
};

/**
 * One validated Starknet call returned by AVNU's build endpoint.
 */
export type SwapCall = {
  readonly calldata: readonly string[];
  readonly contractAddress: string;
  readonly entrypoint: string;
};

/**
 * Validated AVNU build envelope. The returned chain id must match the network
 * requested by the wallet before any call can enter review.
 */
export type SwapBuild = {
  readonly calls: readonly SwapCall[];
  readonly chainId: string;
};

/**
 * Inputs for fetching the best quote for an exact sell amount.
 */
export type SwapQuoteInput = {
  readonly buyTokenAddress: string;
  readonly networkId: StarknetNetworkId;
  readonly sellAmount: string;
  readonly sellTokenAddress: string;
  readonly takerAddress: string;
};

/**
 * Inputs for building executable calls from a previously fetched quote.
 */
export type SwapBuildInput = {
  readonly networkId: StarknetNetworkId;
  readonly quoteId: string;
  readonly slippage: number;
  readonly takerAddress: string;
};

/**
 * Swap service surface consumed by the background swap handler. Both methods
 * throw on any validation or transport failure — fail closed, never guess.
 */
export type SwapService = {
  readonly buildCalls: (input: SwapBuildInput) => Promise<SwapBuild>;
  readonly getQuote: (input: SwapQuoteInput) => Promise<SwapQuote>;
  readonly listTokens: (networkId: StarknetNetworkId) => Promise<readonly SwapCatalogToken[]>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// isStarkFieldElement takes an already-string value; this lifts it into a
// type guard usable on unknown JSON fields.
const isFelt = (value: unknown): value is string =>
  typeof value === "string" && isStarkFieldElement(value);

const isHexAmount = (value: unknown): value is string =>
  typeof value === "string" && /^0x[0-9a-fA-F]{1,64}$/.test(value);

const isUsdFigure = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const isQuoteId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 120;

const isEntrypoint = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(value);

const MAX_CALLDATA_LENGTH = 2000;
const MAX_SWAP_CALLS = 4;
const MAX_CATALOG_TOKENS = 200;

const isTokenText = (value: unknown, maxLength: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;

// Reads one catalog entry; returns null (skipped) rather than failing the
// whole list — entries are display candidates only, and anything the user
// selects is re-validated on-chain by the add-token flow.
const readCatalogToken = (value: unknown): SwapCatalogToken | null =>
  isRecord(value) &&
  isFelt(value["address"]) &&
  typeof value["decimals"] === "number" &&
  Number.isInteger(value["decimals"]) &&
  value["decimals"] >= 0 &&
  value["decimals"] <= 36 &&
  isTokenText(value["name"], 64) &&
  isTokenText(value["symbol"], 20)
    ? {
        address: value["address"],
        decimals: value["decimals"],
        name: value["name"].trim(),
        symbol: value["symbol"].trim(),
      }
    : null;

const baseUrlFor = (networkId: StarknetNetworkId): string => {
  const base = AVNU_BASE_URLS[networkId];
  if (!base) {
    throw new Error("swaps are not available on this network");
  }
  return base;
};

// Validates one untrusted quote object and pins it to the requested pair, so a
// response for a different token pair (or a tampered aggregator) can never
// flow into the confirmation screen or the build step.
const readQuote = (value: unknown, input: SwapQuoteInput): SwapQuote => {
  if (
    !isRecord(value) ||
    !isQuoteId(value["quoteId"]) ||
    !isFelt(value["sellTokenAddress"]) ||
    !isFelt(value["buyTokenAddress"]) ||
    !isHexAmount(value["sellAmount"]) ||
    !isHexAmount(value["buyAmount"]) ||
    !isUsdFigure(value["sellAmountInUsd"]) ||
    !isUsdFigure(value["buyAmountInUsd"]) ||
    !isUsdFigure(value["gasFeesInUsd"])
  ) {
    throw new Error("invalid swap quote");
  }
  if (
    !sameFelt(value["sellTokenAddress"], input.sellTokenAddress) ||
    !sameFelt(value["buyTokenAddress"], input.buyTokenAddress) ||
    !sameFelt(value["sellAmount"], input.sellAmount)
  ) {
    throw new Error("swap quote does not match the requested pair");
  }
  return {
    buyAmount: value["buyAmount"],
    buyAmountInUsd: value["buyAmountInUsd"],
    buyTokenAddress: value["buyTokenAddress"],
    gasFeesInUsd: value["gasFeesInUsd"],
    quoteId: value["quoteId"],
    sellAmount: value["sellAmount"],
    sellAmountInUsd: value["sellAmountInUsd"],
    sellTokenAddress: value["sellTokenAddress"],
  };
};

const readCall = (value: unknown): SwapCall => {
  if (!isRecord(value)) {
    throw new Error("invalid swap call");
  }
  const contractAddress = value["contractAddress"];
  const entrypoint = value["entrypoint"];
  const calldata = value["calldata"];
  if (
    !isFelt(contractAddress) ||
    !isEntrypoint(entrypoint) ||
    !Array.isArray(calldata) ||
    calldata.length > MAX_CALLDATA_LENGTH ||
    !calldata.every(isFelt)
  ) {
    throw new Error("invalid swap call");
  }
  return { calldata, contractAddress, entrypoint };
};

/**
 * Creates the AVNU swap service over an injected fetch.
 */
export const createSwapService = ({ http }: { readonly http: SwapHttp }): SwapService => ({
  async buildCalls(input) {
    if (!(input.slippage > 0 && input.slippage <= 0.05)) {
      throw new Error("invalid slippage");
    }
    const response = await http(`${baseUrlFor(input.networkId)}/swap/v3/build`, {
      body: JSON.stringify({
        includeApprove: true,
        quoteId: input.quoteId,
        slippage: input.slippage,
        takerAddress: input.takerAddress,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    if (!response.ok) {
      throw new Error("swap build failed");
    }
    const payload = await response.json();
    if (
      !isRecord(payload) ||
      !isFelt(payload["chainId"]) ||
      !sameFelt(payload["chainId"], STARKNET_NETWORKS[input.networkId].chainId) ||
      !Array.isArray(payload["calls"]) ||
      payload["calls"].length === 0 ||
      payload["calls"].length > MAX_SWAP_CALLS
    ) {
      throw new Error("invalid swap build response");
    }
    return {
      calls: payload["calls"].map(readCall),
      chainId: payload["chainId"],
    };
  },
  async listTokens(networkId) {
    const response = await http(
      `${baseUrlFor(networkId)}/v1/starknet/tokens?tag=Verified&size=${MAX_CATALOG_TOKENS}&page=0`,
    );
    if (!response.ok) {
      throw new Error("token list failed");
    }
    const payload = await response.json();
    if (
      !isRecord(payload) ||
      !Array.isArray(payload["content"]) ||
      payload["content"].length > MAX_CATALOG_TOKENS
    ) {
      throw new Error("invalid token list response");
    }
    return payload["content"]
      .map(readCatalogToken)
      .filter((token): token is SwapCatalogToken => token !== null);
  },
  async getQuote(input) {
    const query = new URLSearchParams({
      buyTokenAddress: input.buyTokenAddress,
      sellAmount: input.sellAmount,
      sellTokenAddress: input.sellTokenAddress,
      size: "1",
      takerAddress: input.takerAddress,
    });
    const response = await http(`${baseUrlFor(input.networkId)}/swap/v3/quotes?${query}`);
    if (!response.ok) {
      throw new Error("swap quote failed");
    }
    const payload = await response.json();
    if (!Array.isArray(payload) || payload.length === 0) {
      throw new Error("no swap route available for this pair");
    }
    return readQuote(payload[0], input);
  },
});

/**
 * Fail-closed default used when the background could not construct the real
 * service (or in tests that never exercise swaps).
 */
export const unavailableSwapService: SwapService = {
  buildCalls: () => Promise.reject(new Error("swap service unavailable")),
  getQuote: () => Promise.reject(new Error("swap service unavailable")),
  listTokens: () => Promise.reject(new Error("swap service unavailable")),
};
