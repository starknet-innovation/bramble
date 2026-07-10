/**
 * Types + discovery helpers for the injected Starknet wallet provider.
 *
 * The terminal is a dApp: it talks to the MC Wallet browser extension through
 * the wallet's injected `window.starknet_mcWallet` provider (a standard
 * get-starknet StarknetWindowObject). We prefer that provider specifically, but
 * fall back to any other injected Starknet wallet so the terminal is usable for
 * development against Argent/Braavos too.
 */
import type { StarknetWindowObject } from "get-starknet-core";

/**
 * The window key the MC Wallet extension injects its provider under.
 */
export const MC_WALLET_WINDOW_KEY = "starknet_mcWallet" as const;

/**
 * Substring used to recognise the MC Wallet among discovered providers when the
 * exact injected key is unavailable (e.g. behind get-starknet discovery).
 */
export const MC_WALLET_NAME_MATCH = /mc\s*wallet/i;

type StarknetWindow = Window & {
  readonly [MC_WALLET_WINDOW_KEY]?: StarknetWindowObject;
};

/**
 * Reads the MC Wallet provider directly off the window, if the extension has
 * injected it. Returns null in SSR or when the extension is absent.
 */
export const readInjectedMcWallet = (): StarknetWindowObject | null => {
  if (typeof window === "undefined") {
    return null;
  }
  return (window as StarknetWindow)[MC_WALLET_WINDOW_KEY] ?? null;
};

/**
 * Picks the MC Wallet from a list of discovered providers, matching first on the
 * canonical id, then on a name substring. Returns null when none match.
 */
export const pickMcWallet = (
  wallets: readonly StarknetWindowObject[],
): StarknetWindowObject | null =>
  wallets.find(
    (wallet) => wallet.id === "mcWallet" || MC_WALLET_NAME_MATCH.test(wallet.name ?? ""),
  ) ?? null;
