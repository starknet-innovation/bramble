import { getStarknet } from "get-starknet-core";
import type { StarknetWindowObject } from "get-starknet-core";
import { WalletAccount } from "starknet";
import type { AccountInterface } from "starknet";
import { STARKNET_NETWORKS } from "../protocols/support/networks";
import {
  INJECTION_TIMEOUT_MS,
  pickMcWallet,
  waitForInjectedMcWallet,
} from "./starknet-window";

export type WalletRequest = (call: {
  readonly params?: unknown;
  readonly type: string;
}) => Promise<unknown>;

const isUserRejection = (cause: unknown): boolean => {
  if (cause instanceof Error && /reject|denied|refus/i.test(cause.message)) {
    return true;
  }
  const code = (cause as { readonly code?: unknown } | null | undefined)?.code;
  return code === 113;
};

const normalizeAddresses = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    : [];

/**
 * Requests origin-scoped account access, failing closed on explicit rejection.
 * Silent reconnects never fall through to the legacy prompting enable method.
 */
export const requestAccounts = async (
  wallet: StarknetWindowObject,
  silent = false,
): Promise<readonly string[]> => {
  if (typeof wallet.request === "function") {
    try {
      const raw = wallet.request as unknown as WalletRequest;
      const result = await raw({
        ...(silent ? { params: { silent_mode: true } } : {}),
        type: "wallet_requestAccounts",
      });
      const addresses = normalizeAddresses(result);
      if (addresses.length > 0) {
        return addresses;
      }
    } catch (cause) {
      if (isUserRejection(cause)) {
        throw cause;
      }
    }
  }
  if (silent) {
    return [];
  }
  if (typeof wallet.enable === "function") {
    const result = await wallet.enable({ starknetVersion: "v5" });
    const addresses = normalizeAddresses(result);
    if (addresses.length > 0) {
      return addresses;
    }
  }
  if (typeof wallet.selectedAddress === "string" && wallet.selectedAddress.length > 0) {
    return [wallet.selectedAddress];
  }
  return [];
};

/** Reads the active wallet chain without treating an unsupported request as fatal. */
export const requestChainId = async (
  wallet: StarknetWindowObject,
): Promise<string | null> => {
  if (typeof wallet.request === "function") {
    try {
      const raw = wallet.request as unknown as WalletRequest;
      const result = await raw({ type: "wallet_requestChainId" });
      if (typeof result === "string" && result.length > 0) {
        return result;
      }
    } catch {
      // Legacy providers expose the field below.
    }
  }
  return typeof wallet.chainId === "string" ? wallet.chainId : null;
};

/** Maps a wallet chain identifier to terminal network metadata for display and RPC binding. */
export const walletNetwork = (
  chainId: string | null,
): (typeof STARKNET_NETWORKS)[keyof typeof STARKNET_NETWORKS] | null => {
  const normalized = chainId?.toUpperCase() ?? "";
  return (
    Object.values(STARKNET_NETWORKS).find(
      (network) =>
        network.id === normalized ||
        network.chainId.toLowerCase() === (chainId?.toLowerCase() ?? ""),
    ) ?? null
  );
};

/** Resolves an executable account against the wallet's actual active network. */
export const resolveAccount = async (
  wallet: StarknetWindowObject,
  chainId: string | null,
): Promise<AccountInterface | null> => {
  if (wallet.account !== undefined) {
    return wallet.account as unknown as AccountInterface;
  }
  const nodeUrl =
    walletNetwork(chainId)?.rpcUrls[0] ?? STARKNET_NETWORKS.SN_MAIN.rpcUrls[0];
  try {
    const account = await WalletAccount.connect({ nodeUrl }, wallet as never);
    return account as unknown as AccountInterface;
  } catch {
    return null;
  }
};

/** Finds MC Wallet first, while preserving standards-based Starknet wallet fallback. */
export const resolveWallet = async (): Promise<StarknetWindowObject | null> => {
  const injected = await waitForInjectedMcWallet(INJECTION_TIMEOUT_MS);
  if (injected !== null) {
    return injected;
  }
  const available = await getStarknet().getAvailableWallets();
  return pickMcWallet(available) ?? available[0] ?? null;
};
