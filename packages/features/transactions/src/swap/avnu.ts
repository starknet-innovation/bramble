/**
 * AVNU swap-aggregator boundary. The wallet's in-panel swap quotes and builds
 * its calldata through AVNU's public REST API (https://docs.avnu.fi), reached
 * only from the background worker through an injected fetch — this module
 * performs no signing and holds no secrets.
 *
 * Trust boundary: every AVNU response is UNTRUSTED input. Quotes are validated
 * field by field (felt addresses, hex amounts, finite USD figures) and must
 * echo the exact token pair that was requested; built calls are validated as
 * felts/entrypoint identifiers and the COMPLETE returned call set is then
 * policy-checked against the reviewed intent by the background swap handler
 * (the extension's background swap build policy) and decoded by the call verifier before anything
 * is signed — this module never decides what a build may do, but it does pin
 * WHO a build may touch: the exchange router per network (AVNU_DEPLOYMENTS) and
 * the swap selectors that router exposes (isAvnuSwapEntrypoint). Those two pins
 * are what stop an aggregator choosing both sides of the policy's equalities.
 * Failure behaviour: network errors, malformed payloads, and networks with no
 * pinned deployment all throw — the wallet fails closed and never signs
 * calldata it could not validate.
 */
import {
  type BoundedHttpFetch,
  fetchBoundedJson,
  HTTP_BODY_LIMITS,
  HTTP_REQUEST_TIMEOUT_MS,
} from "@bramble/core/http-json";
import { isRecord, isSafeDecimals } from "@bramble/core/json";
import { AVNU_MAX_CALLDATA_LENGTH } from "@bramble/wallet-model/avnu-route";
import {
  isStarkFieldElement,
  STARKNET_NETWORKS,
  type StarknetNetworkId,
  sameFelt,
} from "@bramble/wallet-model/networks";
import { AVNU_MULTI_ROUTE_SWAP } from "./avnu-route";

/**
 * Injectable network fetch used only by the background worker, and the same
 * shape every other untrusted HTTP boundary in the wallet takes: the aggregator
 * is reached through {@link fetchBoundedJson}, so its bodies are capped as they
 * stream and its exchanges carry a deadline and the shared request hardening
 * rather than a private variant of either.
 */
export type SwapHttp = BoundedHttpFetch;

/**
 * One pinned AVNU deployment: the API base the wallet talks to and the exchange
 * (router) contract that API may make this wallet approve and call. The two are
 * one value because a build is only reviewable against a counterparty the
 * wallet fixed in ADVANCE — an aggregator free to name its own spender picks
 * both sides of every equality a build policy could check, and "the approval and
 * the swap agree" then says nothing about who is being trusted.
 */
export type AvnuDeployment = {
  readonly baseUrl: string;
  readonly router: string;
};

/**
 * Pinned AVNU deployment per network, total over StarknetNetworkId so adding a
 * network forces an explicit decision rather than inheriting an unpinned
 * counterparty. `null` means AVNU is not available there (devnet runs no
 * aggregator) and every swap entry point fails closed before a request is made.
 * The router addresses are AVNU's published exchange contracts; they are a
 * trust anchor, so changing one is a security review, not a config tweak. A
 * stale pin can only fail closed — builds naming a different spender are
 * rejected unsigned by the extension's background swap build policy — never fail open.
 */
export const AVNU_DEPLOYMENTS: Readonly<Record<StarknetNetworkId, AvnuDeployment | null>> = {
  SN_DEVNET: null,
  SN_MAIN: {
    baseUrl: "https://starknet.api.avnu.fi",
    router: "0x04270219d365d6b017231b52e92b3fb5d7c8378b05e9abc97724537a80e93b0f",
  },
  SN_SEPOLIA: {
    baseUrl: "https://sepolia.api.avnu.fi",
    router: "0x02c56e8b00dbe2a71e57472685378fc8988bba947e9a99b26a00fade2b4fe7c2",
  },
};

/**
 * AVNU API base URL per supported network, derived from AVNU_DEPLOYMENTS so a
 * base URL can never exist without the router pin that makes its builds
 * reviewable. Devnet has no aggregator, so swaps are unavailable there and the
 * service throws before any request is made.
 */
export const AVNU_BASE_URLS: Readonly<Partial<Record<StarknetNetworkId, string>>> =
  Object.fromEntries(
    Object.entries(AVNU_DEPLOYMENTS).flatMap(([networkId, deployment]) =>
      deployment ? [[networkId, deployment.baseUrl] as const] : [],
    ),
  );

// AVNU's exchange exposes two swap entry points: multi_route_swap (exact-in,
// the shape /swap/v3/build returns for a quote) and swap_exact_token_to
// (exact-out). The wallet only ever asks for exact-in quotes, and the build
// policy now DECODES the admitted call's calldata against the pinned exchange
// ABI (./avnu-route.ts) — exact-out carries a different positional layout, so
// admitting it would mean either a second decoder for a shape this wallet never
// requests or a selector whose calldata nothing reads. It is deliberately not
// admitted. Everything else on that contract is not part of a swap at all, so
// this stays a positive allowlist: "not a transfer" is not a description of a
// swap and leaves every other selector (set_approval_for_all, burn, upgrade, …)
// reachable.
const AVNU_SWAP_ENTRYPOINTS: readonly string[] = [AVNU_MULTI_ROUTE_SWAP];

/**
 * Reports whether an entrypoint is one of the pinned router's swap entry
 * points. Trust boundary: the entrypoint is untrusted text from an aggregator
 * response, so matching is exact — no case folding, no normalization. Every
 * other selector reports false and is rejected by the background build policy
 * rather than reaching the account as an opaque "Call <selector> on 0x…" line.
 */
export const isAvnuSwapEntrypoint = (entrypoint: string): boolean =>
  AVNU_SWAP_ENTRYPOINTS.includes(entrypoint);

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

/**
 * Hard cap on the calls one build may return. A swap is an approval plus a
 * route call, so anything beyond this is a build the wallet will not review.
 * Single source of truth: the background build-policy gate in
 * the extension's background swap build policy re-checks the same bound over the calls it froze,
 * so an injected SwapService cannot widen it.
 */
export const MAX_SWAP_CALLS = 4;

const MAX_CATALOG_TOKENS = 200;

const isTokenText = (value: unknown, maxLength: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;

// Reads one catalog entry; returns null (skipped) rather than failing the
// whole list — entries are display candidates only, and anything the user
// selects is re-validated on-chain by the add-token flow.
const readCatalogToken = (value: unknown): SwapCatalogToken | null =>
  isRecord(value) &&
  isFelt(value["address"]) &&
  isSafeDecimals(value["decimals"]) &&
  isTokenText(value["name"], 64) &&
  isTokenText(value["symbol"], 20)
    ? {
        address: value["address"],
        decimals: value["decimals"],
        name: value["name"].trim(),
        symbol: value["symbol"].trim(),
      }
    : null;

const deploymentFor = (networkId: StarknetNetworkId): AvnuDeployment => {
  const deployment = AVNU_DEPLOYMENTS[networkId];
  if (!deployment) {
    throw new Error("swaps are not available on this network");
  }
  return deployment;
};

const baseUrlFor = (networkId: StarknetNetworkId): string => deploymentFor(networkId).baseUrl;

/**
 * The pinned AVNU exchange router for a network: the ONLY contract a build may
 * ask this wallet to approve as a spender or to call. Trust boundary: this is
 * wallet-side configuration, never anything an aggregator response can
 * influence. Throws "swaps are not available on this network" for a network
 * with no pinned deployment, so a caller that cannot name a counterparty
 * refuses the build instead of reviewing it against one the aggregator chose.
 */
export const avnuRouterAddress = (networkId: StarknetNetworkId): string =>
  deploymentFor(networkId).router;

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
    calldata.length > AVNU_MAX_CALLDATA_LENGTH ||
    !calldata.every(isFelt)
  ) {
    throw new Error("invalid swap call");
  }
  return { calldata, contractAddress, entrypoint };
};

/**
 * Creates the AVNU swap service over an injected fetch.
 */
export const createSwapService = ({ http }: { readonly http: SwapHttp }): SwapService => {
  // One bounded read for every aggregator endpoint. A transport failure, a
  // non-ok status, an over-budget body, and a body that never ends all arrive
  // here as a throw, which each caller turns into its own fail-closed message —
  // no route is ever built from a partially read answer.
  const read = async (url: string, request?: Omit<RequestInit, "signal">): Promise<unknown> =>
    fetchBoundedJson(http, url, HTTP_BODY_LIMITS.swap, HTTP_REQUEST_TIMEOUT_MS, request);
  return {
    async buildCalls(input) {
      if (!(input.slippage > 0 && input.slippage <= 0.05)) {
        throw new Error("invalid slippage");
      }
      const payload = await read(`${baseUrlFor(input.networkId)}/swap/v3/build`, {
        body: JSON.stringify({
          includeApprove: true,
          quoteId: input.quoteId,
          slippage: input.slippage,
          takerAddress: input.takerAddress,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }).catch(() => {
        throw new Error("swap build failed");
      });
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
      const payload = await read(
        `${baseUrlFor(networkId)}/v1/starknet/tokens?tag=Verified&size=${MAX_CATALOG_TOKENS}&page=0`,
      ).catch(() => {
        throw new Error("token list failed");
      });
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
      const payload = await read(`${baseUrlFor(input.networkId)}/swap/v3/quotes?${query}`).catch(
        () => {
          throw new Error("swap quote failed");
        },
      );
      if (!Array.isArray(payload) || payload.length === 0) {
        throw new Error("no swap route available for this pair");
      }
      return readQuote(payload[0], input);
    },
  };
};

/**
 * Fail-closed default used when the background could not construct the real
 * service (or in tests that never exercise swaps).
 */
export const unavailableSwapService: SwapService = {
  buildCalls: () => Promise.reject(new Error("swap service unavailable")),
  getQuote: () => Promise.reject(new Error("swap service unavailable")),
  listTokens: () => Promise.reject(new Error("swap service unavailable")),
};
