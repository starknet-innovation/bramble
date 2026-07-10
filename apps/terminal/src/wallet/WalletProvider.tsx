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
import type {
  ConnectedStarknetWindowObject,
  StarknetWindowObject,
} from "get-starknet-core";
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
import type { AccountInterface } from "starknet";
import { pickMcWallet, readInjectedMcWallet } from "./starknet-window";

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

const isConnectedWallet = (
  wallet: StarknetWindowObject,
): wallet is ConnectedStarknetWindowObject =>
  wallet.isConnected === true && wallet.account !== undefined;

// Resolves the provider to connect to: the injected MC Wallet first, then any
// MC Wallet surfaced by get-starknet discovery, then any available wallet.
const resolveWallet = async (): Promise<StarknetWindowObject | null> => {
  const injected = readInjectedMcWallet();
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

  const applyConnected = useCallback((connected: ConnectedStarknetWindowObject) => {
    walletRef.current = connected;
    setWallet(connected);
    setAccount(connected.account as unknown as AccountInterface);
    setAddress(connected.selectedAddress);
    setChainId(connected.chainId);
    setWalletName(connected.name ?? null);
    setError(null);
  }, []);

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
      const connected = await getStarknet().enable(target);
      if (!isConnectedWallet(connected)) {
        throw new Error("Wallet did not return a connected account.");
      }
      applyConnected(connected);
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
        const preauthorized = await getStarknet().getPreAuthorizedWallets();
        const target = pickMcWallet(preauthorized) ?? preauthorized[0];
        if (cancelled || target === undefined) {
          return;
        }
        const connected = await getStarknet().enable(target);
        if (!cancelled && isConnectedWallet(connected)) {
          applyConnected(connected);
        }
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
      if (next === undefined) {
        clear();
        return;
      }
      setAddress(next);
      const current = walletRef.current;
      if (current !== null && isConnectedWallet(current)) {
        setAccount(current.account as unknown as AccountInterface);
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
