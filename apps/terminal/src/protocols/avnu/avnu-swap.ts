/**
 * AVNU aggregator swap primitives: the opaque route payload the AVNU `SwapQuote`
 * carries, the REST client that reads a quote and its prebuilt swap calldata from
 * the AVNU API, and the pure starknet-js builder for the ERC20 approve leg. Kept
 * separate from avnu.ts so the public protocol surface stays within the module
 * size budget. The only network access lives in the two `fetchAvnu*` functions;
 * everything else is pure parsing / calldata serialization.
 *
 * The AVNU exchange router address is verified against AVNU's published mainnet
 * Contracts & Audits reference. `parseBuildResponse` binds the server-returned
 * target and entrypoint to that constant so the approve and invoke cannot diverge.
 * The route calldata comes from the v3 build API rather than being hand-encoded.
 */
import { AVNU_MAX_CALLDATA_LENGTH, AVNU_MULTI_ROUTE_SWAP } from "@bramble/wallet-model/avnu-route";
import {
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
  sameFelt,
  STARKNET_NETWORKS,
  UINT128_LIMIT,
} from "@bramble/wallet-model/networks";
import { type Call, CallData, cairo } from "starknet";
import { WalletError } from "../support/errors";
import { boundedFetch } from "../support/bounded-network";
import { isRecord, isStringArray } from "../support/json";
import { AVNU_ADDRESSES } from "../constants";

/**
 * Basis-points denominator (100% = 10_000 bps).
 */
const BPS_DENOMINATOR = 10_000n;

/**
 * Default swap slippage tolerance (0.1%) applied when a caller omits one, matching
 * the AVNU SDK `SLIPPAGE_PERCENTAGE` default. ⚠️ Product default — confirm against
 * the terminal's chosen tolerance.
 */
export const DEFAULT_SLIPPAGE_BPS = 10;

/**
 * Number of quotes to request from the aggregator; the terminal only consumes the
 * best route (`quotes[0]`).
 */
const AVNU_QUOTE_SIZE = 1;

/**
 * AVNU quotes endpoint sub-path (best multi-venue route for a pair).
 */
export const AVNU_QUOTES_PATH = "swap/v3/quotes";

/**
 * AVNU build endpoint sub-path (prebuilt `multi_route_swap` calldata for a quote).
 */
export const AVNU_BUILD_PATH = "swap/v3/build";

/**
 * A prebuilt on-chain call as returned by the AVNU build API: the exchange router
 * contract, its entrypoint (`multi_route_swap`), and the ready calldata felts.
 */
export type AvnuExchangeCall = {
  readonly contractAddress: string;
  readonly entrypoint: string;
  readonly calldata: readonly string[];
};

/**
 * The AVNU-specific payload stashed in `SwapQuote.route`. Captures the quote id,
 * the resolved sell/buy magnitudes (decimal integer strings, smallest units), and
 * the prebuilt exchange call so `buildSwapCalls` can reproduce the quoted,
 * slippage-bounded trade without a second network round trip.
 */
export type AvnuRoute = {
  readonly protocol: "avnu";
  readonly quoteId: string;
  readonly sellToken: string;
  readonly buyToken: string;
  readonly sellAmount: string;
  readonly buyAmount: string;
  readonly exchangeCall: AvnuExchangeCall;
};

/**
 * Query inputs for a quote request against the AVNU quotes API.
 */
export type AvnuQuoteRequest = {
  readonly sellToken: string;
  readonly buyToken: string;
  readonly sellAmount: string;
  readonly takerAddress: string;
};

/**
 * The subset of a quote the terminal keeps: its id (fed back to the build API) and
 * the sell/buy magnitudes as decimal integer strings.
 */
export type AvnuQuoteResult = {
  readonly quoteId: string;
  readonly sellToken: string;
  readonly buyToken: string;
  readonly sellAmount: string;
  readonly buyAmount: string;
  readonly gasFeesInStrk: string | null;
  readonly gasFeesInUsd: number | null;
  readonly priceImpactBps: number | null;
  readonly routeLabels: readonly string[];
};

/**
 * Body for a build request: the quote to materialize, the taker (beneficiary), the
 * slippage bound as a decimal fraction, and whether AVNU should bundle the approve
 * (kept false — the wallet emits its own approve leg).
 */
export type AvnuBuildRequest = {
  readonly quoteId: string;
  readonly takerAddress: string;
  readonly slippage: number;
  readonly includeApprove: boolean;
};

// Coerces a decimal integer string into the `0x`-hex felt the quotes API expects.
const toHexAmount = (decimal: string): string => `0x${BigInt(decimal).toString(16)}`;

/**
 * Parses bounded API or review amounts as uint256 decimal strings. Rejects
 * malformed, negative, or over-wide input before bigint conversion.
 */
export const parseAmount = (value: unknown): string | null => {
  if (typeof value !== "string" || !/^(?:0x[0-9a-fA-F]{1,64}|[0-9]{1,78})$/.test(value)) {
    return null;
  }
  try {
    const amount = BigInt(value);
    return amount < UINT128_LIMIT * UINT128_LIMIT ? amount.toString(10) : null;
  } catch {
    return null;
  }
};

/**
 * Converts a basis-points slippage tolerance into the decimal fraction the AVNU
 * build API expects (10 bps -> 0.001). Throws for invalid or unbounded slippage.
 */
export const slippageToFraction = (slippageBps: number): number => {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= Number(BPS_DENOMINATOR)) {
    throw new WalletError("Invalid AVNU slippage");
  }
  return slippageBps / Number(BPS_DENOMINATOR);
};

/**
 * Builds the AVNU quotes GET URL for a pair, hex-encoding the sell amount and
 * pinning the request to a single best route. Tolerates a trailing slash on base.
 */
export const buildQuotesUrl = (base: string, request: AvnuQuoteRequest): string => {
  const query = new URLSearchParams({
    buyTokenAddress: request.buyToken,
    sellAmount: toHexAmount(request.sellAmount),
    sellTokenAddress: request.sellToken,
    size: String(AVNU_QUOTE_SIZE),
    takerAddress: request.takerAddress,
  });
  return `${base.replace(/\/+$/, "")}/${AVNU_QUOTES_PATH}?${query.toString()}`;
};

// Fetches `url` through the bounded terminal network boundary and returns the
// parsed JSON body, throwing `onFailure` on a transport error, a non-ok
// response, an oversized body, a deadline, or an unparseable body so callers
// surface a stable wallet error instead of leaking transport detail.
const fetchJson = async (
  url: string,
  init: RequestInit | undefined,
  onFailure: string,
): Promise<unknown> => {
  let response: Response;
  try {
    response = await boundedFetch(url, init);
  } catch {
    throw new WalletError(onFailure);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new WalletError(onFailure);
  }
  try {
    return await response.json();
  } catch {
    throw new WalletError(onFailure);
  }
};

/**
 * Parses an AVNU quotes response (an array of quotes), taking the best route and
 * normalizing its amounts. Throws when the aggregator returns no route.
 */
export const parseQuoteResponse = (payload: unknown): AvnuQuoteResult => {
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new WalletError("AVNU returned no route for this pair");
  }
  const quote = payload[0];
  if (!isRecord(quote) || typeof quote.quoteId !== "string" || quote.quoteId.length === 0) {
    throw new WalletError("Invalid AVNU quote response");
  }
  const sellAmount = parseAmount(quote.sellAmount);
  const buyAmount = parseAmount(quote.buyAmount);
  if (
    sellAmount === null ||
    buyAmount === null ||
    sellAmount === "0" ||
    buyAmount === "0" ||
    typeof quote.sellTokenAddress !== "string" ||
    !isNonZeroStarkFieldElement(quote.sellTokenAddress) ||
    typeof quote.buyTokenAddress !== "string" ||
    !isNonZeroStarkFieldElement(quote.buyTokenAddress)
  ) {
    throw new WalletError("Invalid AVNU quote response");
  }
  const gasFeesInUsd =
    typeof quote.gasFeesInUsd === "number" && Number.isFinite(quote.gasFeesInUsd)
      ? quote.gasFeesInUsd
      : null;
  const gasFeesInStrk = parseAmount(quote.gasFees);
  const priceImpactBps =
    typeof quote.priceImpact === "number" && Number.isFinite(quote.priceImpact)
      ? quote.priceImpact
      : null;
  const routeLabels = Array.isArray(quote.routes)
    ? quote.routes.flatMap((route) => {
        if (!isRecord(route) || typeof route.name !== "string" || route.name.trim() === "") {
          return [];
        }
        const percent =
          typeof route.percent === "number" && Number.isFinite(route.percent)
            ? ` ${Math.round(route.percent * 1_000) / 10}%`
            : "";
        return [`${route.name.trim()}${percent}`];
      })
    : [];
  return {
    buyAmount,
    buyToken: quote.buyTokenAddress,
    gasFeesInStrk,
    gasFeesInUsd,
    priceImpactBps,
    quoteId: quote.quoteId,
    routeLabels,
    sellAmount,
    sellToken: quote.sellTokenAddress,
  };
};

/**
 * Parses a mainnet AVNU build into a copied, bounded exchange call. Rejects
 * unknown chains, targets, selectors, and invalid felts. Callers must also bind
 * the decoded trade to reviewed intent before displaying or submitting it.
 */
export const parseBuildResponse = (payload: unknown): AvnuExchangeCall => {
  if (
    !isRecord(payload) ||
    !sameFelt(payload.chainId, STARKNET_NETWORKS.SN_MAIN.chainId) ||
    !Array.isArray(payload.calls) ||
    payload.calls.length !== 1
  ) {
    throw new WalletError("Invalid AVNU build response");
  }
  const call = payload.calls[0];
  if (!isRecord(call)) {
    throw new WalletError("Invalid AVNU build response");
  }
  const { calldata, contractAddress, entrypoint } = call;
  if (typeof contractAddress !== "string" || !isNonZeroStarkFieldElement(contractAddress)) {
    throw new WalletError("Invalid AVNU build response");
  }
  if (entrypoint !== AVNU_MULTI_ROUTE_SWAP) {
    throw new WalletError("Invalid AVNU build response");
  }
  if (
    !isStringArray(calldata) ||
    calldata.length > AVNU_MAX_CALLDATA_LENGTH ||
    !calldata.every(isStarkFieldElement)
  ) {
    throw new WalletError("Invalid AVNU build response");
  }
  if (!sameFelt(contractAddress, AVNU_ADDRESSES.exchange)) {
    throw new WalletError("AVNU build returned an unexpected exchange address");
  }
  return { calldata: [...calldata], contractAddress, entrypoint };
};

/**
 * Reads the best swap route for a pair from the AVNU quotes API.
 */
export const fetchAvnuQuote = async (
  base: string,
  request: AvnuQuoteRequest,
): Promise<AvnuQuoteResult> =>
  parseQuoteResponse(
    await fetchJson(buildQuotesUrl(base, request), undefined, "AVNU quote request failed"),
  );

/**
 * Materializes the prebuilt `multi_route_swap` call for a quote via the AVNU build
 * API (approve excluded — the wallet emits its own approve leg).
 */
export const fetchAvnuExchangeCall = async (
  base: string,
  request: AvnuBuildRequest,
): Promise<AvnuExchangeCall> =>
  parseBuildResponse(
    await fetchJson(
      `${base.replace(/\/+$/, "")}/${AVNU_BUILD_PATH}`,
      {
        body: JSON.stringify(request),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
      "AVNU build request failed",
    ),
  );

/**
 * Builds the ERC20 `approve(exchange, amount)` call authorizing the AVNU router to
 * pull the sell token before `multi_route_swap` executes.
 */
export const buildApproveCall = (sellToken: string, amountRaw: bigint): Call => {
  if (!isNonZeroStarkFieldElement(sellToken)) {
    throw new WalletError("Invalid AVNU sell token");
  }
  return {
    calldata: CallData.compile([AVNU_ADDRESSES.exchange, cairo.uint256(amountRaw)]),
    contractAddress: sellToken,
    entrypoint: "approve",
  };
};

/**
 * Materializes the stored AVNU exchange payload as an executable starknet-js Call.
 */
export const toExchangeCall = (route: AvnuRoute): Call => ({
  calldata: [...route.exchangeCall.calldata],
  contractAddress: route.exchangeCall.contractAddress,
  entrypoint: route.exchangeCall.entrypoint,
});

/**
 * Narrows the opaque `SwapQuote.route` to an AvnuRoute, rejecting foreign or
 * malformed payloads before buildSwapCalls consumes them.
 */
export const isAvnuRoute = (value: unknown): value is AvnuRoute => {
  if (!isRecord(value) || value.protocol !== "avnu") {
    return false;
  }
  const call = value.exchangeCall;
  if (
    !isRecord(call) ||
    typeof call.contractAddress !== "string" ||
    typeof call.entrypoint !== "string" ||
    !isStringArray(call.calldata)
  ) {
    return false;
  }
  return [value.quoteId, value.sellToken, value.buyToken, value.sellAmount, value.buyAmount].every(
    (field) => typeof field === "string",
  );
};
