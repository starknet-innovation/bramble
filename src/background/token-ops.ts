/**
 * Token-management operations dispatched from the background message handler:
 * custom-token add via on-chain metadata, curated auto-detection, spam
 * hide/reveal, fiat prices, and 7-day price charts. All are privileged
 * extension-page messages.
 */

import { STARKNET_NETWORKS } from "../starknet/networks";
import type { PriceService } from "../starknet/prices";
import { isLikelySpam, knownTokensForNetwork } from "../starknet/token-registry";
import type { WalletPreferencesStore } from "../storage/preferences-store";
import { readTypeOnlyInput } from "./message-inputs";
import type { RuntimeRpc } from "./runtime-rpc";
import { activeAccountContext, networkRpcUrls } from "./runtime-state";
import type { RuntimeResponse, WalletStatusReader } from "./runtime-types";
import type { UnlockSession } from "./session";
import { readAddTokenInput, readSetTokenHiddenInput, readTokenChartInput } from "./token-inputs";

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

const sameAddress = (left: string, right: string): boolean => {
  try {
    return BigInt(left) === BigInt(right);
  } catch {
    return left === right;
  }
};

/**
 * Handles token-management messages; returns null for other message types.
 */
export const handleTokenOps = async (
  deps: TokenOpsDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  const { preferencesStore, prices, runtimeRpc } = deps;

  if (messageType === "wallet.addToken") {
    const input = readAddTokenInput(message);
    if (!input) {
      return { error: "invalid add token request" };
    }
    const preferences = await preferencesStore.read();
    const network = STARKNET_NETWORKS[preferences.activeNetworkId];
    const metadata = await runtimeRpc
      .getTokenMetadata({ address: input.address, rpcUrls: networkRpcUrls(network, preferences) })
      .catch(() => null);
    if (!metadata) {
      return { error: "could not read token metadata" };
    }
    const symbol = metadata.symbol.trim().toUpperCase();
    const trimmedName = metadata.name.trim().slice(0, 64);
    const name = trimmedName.length > 0 ? trimmedName : symbol;
    if (!/^[A-Z0-9]{2,12}$/.test(symbol)) {
      return { error: "unsupported token symbol" };
    }
    // Run the full spam heuristics (not just the symbol regex) so a spoofed or
    // malformed token is still added but hidden by default rather than
    // presented as trusted; the user can always reveal it later.
    const spam = isLikelySpam({
      address: input.address,
      decimals: metadata.decimals,
      name,
      networkId: network.id,
      symbol,
    });
    const preferencesWithToken = await preferencesStore.upsertToken({
      address: input.address,
      decimals: metadata.decimals,
      name,
      networkId: network.id,
      symbol,
    });
    if (!spam) {
      return { ok: true, preferences: preferencesWithToken };
    }
    return {
      ok: true,
      preferences: await preferencesStore.setTokenHidden({
        hidden: true,
        tokenId: `${network.id}:${symbol}:${input.address}`,
      }),
    };
  }

  if (messageType === "wallet.detectTokens") {
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
      (known) => !tracked.some((token) => sameAddress(token.address, known.address)),
    );
    if (candidates.length === 0) {
      return { ok: true, suggestions: [] };
    }
    const balances = await runtimeRpc
      .getTokenBalances({
        accountAddress: context.account.address,
        rpcUrls: networkRpcUrls(STARKNET_NETWORKS[context.networkId], preferences),
        tokens: candidates,
      })
      .catch(() => []);
    return { ok: true, suggestions: balances.filter((balance) => balance.balance !== "0") };
  }

  if (messageType === "wallet.setTokenHidden") {
    const input = readSetTokenHiddenInput(message);
    if (!input) {
      return { error: "invalid token visibility request" };
    }
    return { ok: true, preferences: await preferencesStore.setTokenHidden(input) };
  }

  if (messageType === "wallet.prices") {
    if (!readTypeOnlyInput(message, "wallet.prices")) {
      return { error: "invalid prices request" };
    }
    const preferences = await preferencesStore.read();
    const currency = preferences.displayCurrency ?? "usd";
    const addresses = preferences.tokens
      .filter((token) => token.networkId === preferences.activeNetworkId)
      .map((token) => token.address);
    return {
      ok: true,
      ...(await prices.getPrices({ addresses, currency, networkId: preferences.activeNetworkId })),
    };
  }

  if (messageType === "wallet.tokenChart") {
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
  }

  return null;
};
