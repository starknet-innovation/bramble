import { WalletAccountV6 } from "starknet";
import type { AccountInterface } from "starknet";
import { STARKNET_NETWORKS } from "../../protocols/support/networks";
import {
  INJECTION_TIMEOUT_MS,
  type StarknetWindowObject,
  waitForInjectedBramble,
} from "./starknet-window";

export type WalletRequest = (call: {
  readonly params?: unknown;
  readonly type: string;
}) => Promise<unknown>;

export type WatchAssetInput = {
  readonly address: string;
  readonly decimals?: number;
  readonly name?: string;
  readonly symbol?: string;
};

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

/**
 * Requests ERC20 tracking through the standards provider. The wallet treats
 * every field as untrusted, re-reads metadata, and requires user approval.
 */
export const requestWatchAsset = async (
  wallet: StarknetWindowObject | null,
  input: WatchAssetInput,
): Promise<void> => {
  if (wallet === null || typeof wallet.request !== "function") {
    throw new Error("Connect a wallet that supports token tracking.");
  }
  const raw = wallet.request as unknown as WalletRequest;
  const result = await raw({
    params: { options: input, type: "ERC20" },
    type: "wallet_watchAsset",
  });
  if (result !== true) {
    throw new Error("Wallet did not add the token.");
  }
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

type WalletAccountV6Provider = Parameters<typeof WalletAccountV6.connect>[1];

type WalletStandardConnectResult = {
  readonly accounts: readonly { readonly address: string }[];
};

/**
 * Adapts an injected window.starknet object to the wallet-standard feature
 * map WalletAccountV6.connect reads. The injected provider is untrusted: only
 * `request` is forwarded, and connect results are re-normalized to addresses.
 */
const walletStandardProvider = (wallet: StarknetWindowObject): WalletAccountV6Provider => {
  if (typeof wallet.request !== "function") {
    throw new Error("Wallet does not support the request API.");
  }
  const request = wallet.request as WalletRequest;
  return {
    features: {
      "standard:connect": {
        connect: async ({
          silent = false,
        }: { readonly silent?: boolean } = {}): Promise<WalletStandardConnectResult> => {
          const result = await request({
            ...(silent ? { params: { silent_mode: true } } : {}),
            type: "wallet_requestAccounts",
          });
          return {
            accounts: normalizeAddresses(result).map((address) => ({ address })),
          };
        },
      },
      "standard:events": {
        on: (event: string, listener: (...args: never[]) => void): (() => void) => {
          wallet.on(event, listener);
          return () => wallet.off(event, listener);
        },
      },
      "starknet:walletApi": {
        request,
      },
    },
  } as WalletAccountV6Provider;
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
    return (await WalletAccountV6.connect(
      { nodeUrl },
      walletStandardProvider(wallet),
    )) as unknown as AccountInterface;
  } catch {
    return null;
  }
};

/** Finds Bramble first, while preserving standards-based Starknet wallet fallback. */
export const resolveWallet = async (): Promise<StarknetWindowObject | null> => {
  return waitForInjectedBramble(INJECTION_TIMEOUT_MS);
};
