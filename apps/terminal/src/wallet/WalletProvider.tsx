/**
 * Wallet connection context for the trade terminal.
 *
 * Wraps get-starknet-core to connect to the injected MC Wallet provider
 * (preferring window.starknet_mcWallet), exposes the connected account and
 * address, and drives the Connect / Disconnect buttons throughout the shell.
 *
 * Screens consume this via the `useWallet()` hook. To send protocol calldata,
 * build `Call[]` with the protocol layer (src/protocols) and hand them to the
 * connected account: `await account.execute(calls)`.
 */
import { getStarknet } from "get-starknet-core";
import type { StarknetWindowObject } from "get-starknet-core";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { WalletAccount } from "starknet";
import type { AccountInterface } from "starknet";
import { STARKNET_NETWORKS } from "../protocols/support/networks";
import {
  INJECTION_TIMEOUT_MS,
  pickMcWallet,
  waitForInjectedMcWallet,
} from "./starknet-window";

// The mainnet RPC used to bind a WalletAccount for modern wallets that expose
// only the request API (no ready `account` object). Reuses the single source of
// truth in the protocol layer rather than hardcoding a second endpoint.
const MAINNET_RPC_URL = STARKNET_NETWORKS.SN_MAIN.rpcUrls[0];

/**
 * The wallet state + actions exposed to the app through `useWallet()`.
 */
export type WalletContextValue = {
  /** The connected wallet account, or null when disconnected. Use `account.execute(calls)` to send protocol calldata. */
  readonly account: AccountInterface | null;
  /** The selected account address (canonical hex), or null when disconnected. */
  readonly address: string | null;
  /** The wallet's current chain id (e.g. "SN_MAIN"), or null when disconnected. */
  readonly chainId: string | null;
  /** The human-readable name of the connected wallet, or null. */
  readonly walletName: string | null;
  /** True once an account is connected. */
  readonly isConnected: boolean;
  /** True while a connect() call is in flight. */
  readonly isConnecting: boolean;
  /** The last connection error message, or null. */
  readonly error: string | null;
  /** Opens the wallet and connects an account. Prefers the MC Wallet provider. */
  readonly connect: () => Promise<void>;
  /** Disconnects the current wallet and clears the last-connected hint. */
  readonly disconnect: () => Promise<void>;
};

const WalletContext = createContext<WalletContextValue | null>(null);

// Loosely-typed view of the provider's request method. get-starknet-core's
// RpcMessage union does not enumerate the account/chain permission requests, so
// we cast to call them without fighting the published types.
type WalletRequest = (call: { readonly type: string }) => Promise<unknown>;

// A user explicitly rejecting the connection prompt (SNIP error 113 / a
// reject/deny message). We must not silently retry through a second path when
// this happens — surface it instead.
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

// Asks the wallet to authorize account access and returns the granted
// addresses. Prefers the modern `request({ type: "wallet_requestAccounts" })`
// API, falling back to the legacy `enable()` method and finally to a
// synchronously-populated `selectedAddress`. THIS is the core connect fix: the
// old code assumed the enable() call left `isConnected`/`account` populated on
// the window object, which modern wallets no longer do — so approving in the
// wallet changed nothing in the app.
const requestAccounts = async (wallet: StarknetWindowObject): Promise<readonly string[]> => {
  if (typeof wallet.request === "function") {
    try {
      const raw = wallet.request as unknown as WalletRequest;
      const result = await raw({ type: "wallet_requestAccounts" });
      const addresses = normalizeAddresses(result);
      if (addresses.length > 0) {
        return addresses;
      }
    } catch (cause) {
      if (isUserRejection(cause)) {
        throw cause;
      }
      // Unknown request type on an older wallet — fall through to enable().
    }
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

// Reads the wallet's current chain id, preferring the request API and falling
// back to the window object's own field.
const requestChainId = async (wallet: StarknetWindowObject): Promise<string | null> => {
  if (typeof wallet.request === "function") {
    try {
      const raw = wallet.request as unknown as WalletRequest;
      const result = await raw({ type: "wallet_requestChainId" });
      if (typeof result === "string" && result.length > 0) {
        return result;
      }
    } catch {
      // Fall back to the field below.
    }
  }
  return typeof wallet.chainId === "string" ? wallet.chainId : null;
};

// Resolves an executable account. Legacy wallets (and the test double) expose a
// ready `account`; modern request-only wallets are bound to a WalletAccount
// against the injected provider so `account.execute(calls)` still works.
const resolveAccount = async (
  wallet: StarknetWindowObject,
): Promise<AccountInterface | null> => {
  if (wallet.account !== undefined) {
    return wallet.account as unknown as AccountInterface;
  }
  try {
    const account = await WalletAccount.connect(
      { nodeUrl: MAINNET_RPC_URL },
      wallet as never,
    );
    return account as unknown as AccountInterface;
  } catch {
    return null;
  }
};

// Resolves the provider to connect to: waits for the injected MC Wallet (so a
// click that beats extension injection still works), then any MC Wallet from
// get-starknet discovery, then any available wallet.
const resolveWallet = async (): Promise<StarknetWindowObject | null> => {
  const injected = await waitForInjectedMcWallet(INJECTION_TIMEOUT_MS);
  if (injected !== null) {
    return injected;
  }
  const available = await getStarknet().getAvailableWallets();
  return pickMcWallet(available) ?? available[0] ?? null;
};

/**
 * Provides wallet connection state to the tree. Mount once near the root.
 */
export const WalletProvider = ({ children }: { readonly children: ReactNode }): ReactNode => {
  const [wallet, setWallet] = useState<StarknetWindowObject | null>(null);
  const [account, setAccount] = useState<AccountInterface | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const walletRef = useRef<StarknetWindowObject | null>(null);

  const applyConnected = useCallback(
    (
      connected: StarknetWindowObject,
      nextAccount: AccountInterface,
      nextAddress: string,
      nextChainId: string | null,
    ) => {
      walletRef.current = connected;
      setWallet(connected);
      setAccount(nextAccount);
      setAddress(nextAddress);
      setChainId(nextChainId);
      setWalletName(connected.name ?? null);
      setError(null);
    },
    [],
  );

  const clear = useCallback(() => {
    walletRef.current = null;
    setWallet(null);
    setAccount(null);
    setAddress(null);
    setChainId(null);
    setWalletName(null);
  }, []);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    try {
      const target = await resolveWallet();
      if (target === null) {
        throw new Error("No Starknet wallet detected. Install the MC Wallet extension.");
      }
      const addresses = await requestAccounts(target);
      const nextAddress = addresses[0];
      if (nextAddress === undefined) {
        throw new Error("Wallet did not authorize an account.");
      }
      const nextAccount = await resolveAccount(target);
      if (nextAccount === null) {
        throw new Error("Could not resolve the connected account.");
      }
      const nextChainId = await requestChainId(target);
      applyConnected(target, nextAccount, nextAddress, nextChainId);
    } catch (cause) {
      clear();
      setError(cause instanceof Error ? cause.message : "Failed to connect wallet.");
    } finally {
      setIsConnecting(false);
    }
  }, [applyConnected, clear]);

  const disconnect = useCallback(async () => {
    try {
      await getStarknet().disconnect({ clearLastWallet: true });
    } catch {
      // Ignore disconnect failures — we clear local state regardless.
    }
    clear();
  }, [clear]);

  // Attempt a silent reconnect if the wallet pre-authorized this origin.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const injected = await waitForInjectedMcWallet(INJECTION_TIMEOUT_MS);
        const target =
          injected ?? pickMcWallet(await getStarknet().getPreAuthorizedWallets());
        if (cancelled || target === null) {
          return;
        }
        const preauthorized =
          typeof target.isPreauthorized === "function"
            ? await target.isPreauthorized().catch(() => false)
            : false;
        if (cancelled || !preauthorized) {
          return;
        }
        const addresses = await requestAccounts(target);
        const nextAddress = addresses[0];
        if (cancelled || nextAddress === undefined) {
          return;
        }
        const nextAccount = await resolveAccount(target);
        if (cancelled || nextAccount === null) {
          return;
        }
        const nextChainId = await requestChainId(target);
        applyConnected(target, nextAccount, nextAddress, nextChainId);
      } catch {
        // No pre-authorization / no wallet — stay disconnected silently.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyConnected]);

  // Track wallet-side account / network changes while connected.
  useEffect(() => {
    if (wallet === null) {
      return;
    }
    const onAccountsChanged = (accounts?: string[]): void => {
      const next = accounts?.[0];
      if (next === undefined || next.length === 0) {
        clear();
        return;
      }
      setAddress(next);
      const current = walletRef.current;
      if (current !== null) {
        void resolveAccount(current).then((nextAccount) => {
          if (nextAccount !== null) {
            setAccount(nextAccount);
          }
        });
      }
    };
    const onNetworkChanged = (network?: string): void => {
      setChainId(network ?? null);
    };
    wallet.on("accountsChanged", onAccountsChanged);
    wallet.on("networkChanged", onNetworkChanged);
    return () => {
      wallet.off("accountsChanged", onAccountsChanged);
      wallet.off("networkChanged", onNetworkChanged);
    };
  }, [wallet, clear]);

  const value = useMemo<WalletContextValue>(
    () => ({
      account,
      address,
      chainId,
      walletName,
      isConnected: account !== null && address !== null,
      isConnecting,
      error,
      connect,
      disconnect,
    }),
    [account, address, chainId, walletName, isConnecting, error, connect, disconnect],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
};

/**
 * Reads the wallet context. Throws if used outside a `<WalletProvider>`.
 */
export const useWallet = (): WalletContextValue => {
  const value = useContext(WalletContext);
  if (value === null) {
    throw new Error("useWallet must be used within a <WalletProvider>");
  }
  return value;
};
