/**
 * Token-management operations dispatched from the background message handler:
 * custom-token add via on-chain metadata, curated auto-detection, spam
 * hide/reveal, fiat prices, and 7-day price charts. All are privileged
 * extension-page messages.
 */

import { isTokenName, isTokenSymbol, normalizeTokenSymbol } from "@bramble/core/json";
import { NETWORK_RETRY_MESSAGE } from "@bramble/core/network-error";
import type { PriceService } from "@bramble/portfolio/prices";
import { isLikelySpam, knownTokensForNetwork } from "@bramble/portfolio/token-registry";
import type { TokenConfig, WalletPreferencesStore } from "@bramble/settings/preferences";
import { isTransportRpcError, type TokenMetadata } from "@bramble/starknet/rpc";
import {
  STARKNET_NETWORKS,
  type StarknetNetworkId,
  sameFelt,
} from "@bramble/wallet-model/networks";
import { withTokenId } from "@bramble/wallet-model/preferences";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import { readPricesInput, readTypeOnlyInput } from "../routing/message-inputs";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import { activeAccountContext, networkRpcUrls } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import type { UnlockSession } from "../runtime/session";
import {
  readAddTokenInput,
  readRemoveTokenInput,
  readSetTokenHiddenInput,
  readTokenChartInput,
} from "./token-inputs";

/**
 * Dependencies shared by the token operation handlers.
 */
export type TokenOpsDeps = {
  readonly preferencesStore: WalletPreferencesStore;
  readonly prices: PriceService;
  readonly runtimeRpc: RuntimeRpc;
  readonly session: UnlockSession;
  readonly wallet: WalletStatusReader;
};

/** Token record (sans generated id) as stored, before spam classification. */
type TokenRecord = Omit<TokenConfig, "id">;

/**
 * Reads on-chain ERC20 metadata, mapping the two failure modes to their user
 * error. A transport-level failure (node unreachable) is not the same as the
 * contract simply not exposing readable ERC20 metadata; the former is surfaced
 * as a retryable network error instead of "not a token".
 */
const fetchTokenMetadata = async (
  runtimeRpc: RuntimeRpc,
  address: string,
  rpcUrls: readonly string[],
): Promise<TokenMetadata | { readonly error: string }> => {
  try {
    return await runtimeRpc.getTokenMetadata({ address, rpcUrls });
  } catch (error) {
    return {
      error: isTransportRpcError(error) ? NETWORK_RETRY_MESSAGE : "could not read token metadata",
    };
  }
};

/**
 * Parses ERC20 metadata into a storable token record, or null when the symbol
 * is unsupported. Parse-don't-validate: a caller with a record has a token
 * whose symbol already passed the on-chain symbol grammar.
 */
const buildTokenRecord = (
  address: string,
  networkId: StarknetNetworkId,
  metadata: TokenMetadata,
): TokenRecord | null => {
  const symbol = normalizeTokenSymbol(metadata.symbol);
  if (!isTokenSymbol(symbol)) {
    return null;
  }
  const trimmedName = metadata.name.trim().slice(0, 64);
  return {
    address,
    decimals: metadata.decimals,
    name: isTokenName(trimmedName) ? trimmedName : symbol,
    networkId,
    symbol,
  };
};

/**
 * Per-message-type token handler. Absent keys are non-token messages handled
 * by the caller.
 */
type TokenHandler = (deps: TokenOpsDeps, message: unknown) => Promise<RuntimeResponse>;

const handleAddToken: TokenHandler = async (deps, message) => {
  const { preferencesStore, runtimeRpc } = deps;
  const input = readAddTokenInput(message);
  if (!input) {
    return { error: "invalid add token request" };
  }
  const preferences = await preferencesStore.read();
  const network = STARKNET_NETWORKS[preferences.activeNetworkId];
  // An address already tracked stays one record, whatever symbol the contract
  // reports now; re-adding it is a no-op rather than a second balance row. A
  // record a dapp supplied (audit 171) goes on, so the store replaces it with
  // the chain's metadata and the user's add is what makes it trusted.
  const tracked = preferences.tokens.find(
    (token) => token.networkId === network.id && sameFelt(token.address, input.address),
  );
  if (tracked && !(preferences.dappTokenIds ?? []).includes(tracked.id)) {
    return { ok: true, preferences };
  }
  const metadata = await fetchTokenMetadata(
    runtimeRpc,
    input.address,
    networkRpcUrls(network, preferences),
  );
  if ("error" in metadata) {
    return metadata;
  }
  const record = buildTokenRecord(input.address, network.id, metadata);
  if (!record) {
    return { error: "unsupported token symbol" };
  }
  const preferencesWithToken = await preferencesStore.upsertToken(record, "user");
  // Run the full spam heuristics (not just the symbol regex) so a spoofed or
  // malformed token is still added but hidden by default rather than
  // presented as trusted; the user can always reveal it later.
  if (!isLikelySpam(record)) {
    return { ok: true, preferences: preferencesWithToken };
  }
  return {
    ok: true,
    preferences: await preferencesStore.setTokenHidden({
      hidden: true,
      // The id the store derived, never a second interpolation of the same
      // three fields: a locally re-derived id that drifted from `withTokenId`
      // hides nothing while reporting success.
      tokenId: withTokenId(record).id,
    }),
  };
};

const handleDetectTokens: TokenHandler = async (deps, message) => {
  const { preferencesStore, runtimeRpc } = deps;
  if (!readTypeOnlyInput(message, "wallet.detectTokens")) {
    return { error: "invalid detect tokens request" };
  }
  const context = await activeAccountContext(deps.wallet, deps.session, preferencesStore);
  if (context.error !== undefined) {
    return { error: context.error };
  }
  const preferences = await preferencesStore.read();
  const tracked = preferences.tokens.filter((token) => token.networkId === context.networkId);
  const candidates = knownTokensForNetwork(context.networkId).filter(
    (known) => !tracked.some((token) => sameFelt(token.address, known.address)),
  );
  if (candidates.length === 0) {
    return { ok: true, suggestions: [] };
  }
  // A live scan needs a working RPC: never swallow a failure into an empty
  // result, or "couldn't reach the network" becomes indistinguishable from a
  // genuine "no tokens found". Report the failure so the UI can prompt a retry.
  try {
    const balances = await runtimeRpc.getTokenBalances({
      accountAddress: context.account.address,
      rpcUrls: networkRpcUrls(STARKNET_NETWORKS[context.networkId], preferences),
      tokens: candidates,
    });
    return { ok: true, suggestions: balances.filter((balance) => balance.balance !== "0") };
  } catch (error) {
    return {
      error: isTransportRpcError(error) ? NETWORK_RETRY_MESSAGE : "Token scan failed, try again",
    };
  }
};

const handleSetTokenHidden: TokenHandler = async (deps, message) => {
  const input = readSetTokenHiddenInput(message);
  if (!input) {
    return { error: "invalid token visibility request" };
  }
  return { ok: true, preferences: await deps.preferencesStore.setTokenHidden(input) };
};

// Recovery for a token a dapp added (Sherlock audit 134). The store refuses built-in
// defaults and unknown ids; the router reports that refusal to the page.
const handleRemoveToken: TokenHandler = async (deps, message) => {
  const input = readRemoveTokenInput(message);
  if (!input) {
    return { error: "invalid remove token request" };
  }
  return { ok: true, preferences: await deps.preferencesStore.removeToken(input) };
};

const handlePrices: TokenHandler = async (deps, message) => {
  const { preferencesStore, prices } = deps;
  const input = readPricesInput(message);
  if (!input) {
    return { error: "invalid prices request" };
  }
  const preferences = await preferencesStore.read();
  const currency = preferences.displayCurrency ?? "usd";
  const addresses = preferences.tokens
    .filter((token) => token.networkId === preferences.activeNetworkId)
    .map((token) => token.address);
  return {
    ok: true,
    ...(await prices.getPrices({
      addresses,
      ...(input.cached ? { cached: true } : {}),
      currency,
      networkId: preferences.activeNetworkId,
    })),
  };
};

const handleTokenChart: TokenHandler = async (deps, message) => {
  const { preferencesStore, prices } = deps;
  const input = readTokenChartInput(message);
  if (!input) {
    return { error: "invalid token chart request" };
  }
  const preferences = await preferencesStore.read();
  const currency = preferences.displayCurrency ?? "usd";
  return {
    ok: true,
    ...(await prices.getTokenChart({
      address: input.address,
      currency,
      networkId: preferences.activeNetworkId,
    })),
  };
};

/**
 * Maps a token message type to its handler. Absent keys return null from
 * {@link handleTokenOps} so other operation groups can handle the message.
 */
const TOKEN_HANDLERS: Readonly<Record<string, TokenHandler>> = {
  "wallet.addToken": handleAddToken,
  "wallet.detectTokens": handleDetectTokens,
  "wallet.prices": handlePrices,
  "wallet.removeToken": handleRemoveToken,
  "wallet.setTokenHidden": handleSetTokenHidden,
  "wallet.tokenChart": handleTokenChart,
};

/**
 * Handles token-management messages; returns null for other message types.
 */
export const handleTokenOps = async (
  deps: TokenOpsDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  const handler = Object.hasOwn(TOKEN_HANDLERS, messageType)
    ? TOKEN_HANDLERS[messageType]
    : undefined;
  return handler ? handler(deps, message) : null;
};
