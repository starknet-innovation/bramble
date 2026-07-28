/**
 * Wallet connection context for the trade terminal.
 *
 * Wraps get-starknet-core to connect to the injected MC Wallet provider
 * (preferring window.starknet_mcWallet), exposes the connected account and
 * address, and drives the Connect / Disconnect buttons throughout the shell.
 *
 * Screens consume this via the `useWallet()` hook. Protocol calldata is handed
 * to `requestTransaction()` so every action receives the same terminal review,
 * wallet hand-off, rejection, retry, and submission feedback.
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
import type { AccountInterface, InvokeFunctionResponse } from "starknet";
import {
  INJECTION_TIMEOUT_MS,
  pickMcWallet,
  waitForInjectedMcWallet,
} from "./starknet-window";
import {
  requestAccounts,
  requestChainId,
  requestWatchAsset,
  resolveAccount,
  resolveWallet,
  walletNetwork,
  type WalletRequest,
  type WatchAssetInput,
} from "./wallet-connection";
import { WalletRequestDialog } from "./WalletRequestDialog";
import {
  type WalletRequestPreview,
  type WalletRequestView,
  type WalletTransactionRequest,
  walletInvokeParams,
  walletRequestError,
  walletTransactionHash,
} from "./wallet-request";

/**
 * The wallet state + actions exposed to the app through `useWallet()`.
 */
export type WalletContextValue = {
  /** The connected wallet account, or null when disconnected. Read-only consumers may inspect it; actions use requestTransaction(). */
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
  /** Clears a surfaced connection error without changing the wallet session. */
  readonly clearError: () => void;
  /** Opens the wallet and connects an account. Prefers the MC Wallet provider. */
  readonly connect: () => Promise<void>;
  /** Reviews and executes Starknet calls through the connected wallet. */
  readonly requestTransaction: (
    input: WalletTransactionRequest,
  ) => Promise<InvokeFunctionResponse>;
  /** Requests wallet tracking for an ERC20; the wallet re-reads metadata and requires approval. */
  readonly watchAsset: (input: WatchAssetInput) => Promise<void>;
  /** Requests an approved Sierra class declaration through the connected wallet. */
  readonly declareContract: (input: ContractDeclaration) => Promise<DeclarationResult>;
  /** Disconnects the current wallet and clears the last-connected hint. */
  readonly disconnect: () => Promise<void>;
};

export type ContractDeclaration = {
  readonly classHash: string;
  readonly compiledClassHash: string;
  readonly contractClass: Readonly<Record<string, unknown>>;
};

export type DeclarationResult = {
  readonly classHash: string;
  readonly transactionHash: string;
};

const WalletContext = createContext<WalletContextValue | null>(null);

const declarationResult = (value: unknown): DeclarationResult | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const classHash = record["class_hash"];
  const transactionHash = record["transaction_hash"];
  return typeof classHash === "string" && typeof transactionHash === "string"
    ? { classHash, transactionHash }
    : null;
};

type PendingWalletRequest = {
  readonly perform: () => Promise<unknown>;
  readonly reject: (reason: Error) => void;
  readonly resolve: (value: unknown) => void;
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
  const [requestView, setRequestView] = useState<WalletRequestView | null>(null);
  const walletRef = useRef<StarknetWindowObject | null>(null);
  const pendingRequestRef = useRef<PendingWalletRequest | null>(null);

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
    pendingRequestRef.current?.reject(new Error("Wallet disconnected before approval."));
    pendingRequestRef.current = null;
    setRequestView(null);
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
      const nextChainId = await requestChainId(target);
      const nextAccount = await resolveAccount(target, nextChainId);
      if (nextAccount === null) {
        throw new Error("Could not resolve the connected account.");
      }
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

  const clearError = useCallback(() => setError(null), []);

  const executeWalletRequest = useCallback(async (
    pending: PendingWalletRequest,
    preview: WalletRequestPreview,
  ): Promise<void> => {
    try {
      const result = await pending.perform();
      const transactionHash = walletTransactionHash(result);
      if (transactionHash === null) {
        throw new Error("Wallet returned an invalid transaction hash.");
      }
      pendingRequestRef.current = null;
      setRequestView({ phase: "submitted", preview, transactionHash });
      pending.resolve(result);
    } catch (cause) {
      setRequestView({
        phase: "failed",
        preview,
        message: walletRequestError(cause),
      });
    }
  }, []);

  const performWalletRequest = useCallback(async (): Promise<void> => {
    const pending = pendingRequestRef.current;
    const preview = requestView?.preview;
    if (pending === null || preview === undefined) {
      return;
    }
    setRequestView({ phase: "awaiting", preview });
    await executeWalletRequest(pending, preview);
  }, [executeWalletRequest, requestView]);

  const queueWalletRequest = useCallback(
    <Result,>(
      preview: WalletRequestPreview,
      perform: () => Promise<Result>,
      phase: "awaiting" | "review" = "review",
    ): Promise<Result> => {
      if (pendingRequestRef.current !== null) {
        return Promise.reject(new Error("Finish the open wallet request first."));
      }
      return new Promise<Result>((resolve, reject) => {
        const pending: PendingWalletRequest = {
          perform,
          reject,
          resolve: (value) => resolve(value as Result),
        };
        pendingRequestRef.current = pending;
        setRequestView({ phase, preview });
        if (phase === "awaiting") {
          void executeWalletRequest(pending, preview);
        }
      });
    },
    [executeWalletRequest],
  );

  const cancelWalletRequest = useCallback(() => {
    pendingRequestRef.current?.reject(new Error("Wallet request cancelled."));
    pendingRequestRef.current = null;
    setRequestView(null);
  }, []);

  const closeWalletRequest = useCallback(() => setRequestView(null), []);

  const requestTransaction = useCallback(
    async (input: WalletTransactionRequest): Promise<InvokeFunctionResponse> => {
      if (account === null) {
        throw new Error("Connect a wallet before submitting a transaction.");
      }
      if (input.calls.length === 0) {
        throw new Error("The terminal refused an empty wallet request.");
      }
      const preview: WalletRequestPreview = {
        callCount: input.calls.length,
        description: input.description,
        details: input.details ?? [],
        kind: "transaction",
        title: input.title,
        warning: input.warning,
      };
      const perform = async (): Promise<InvokeFunctionResponse> => {
        const params = walletInvokeParams(input.calls);
        if (wallet !== null && typeof wallet.request === "function") {
          const raw = wallet.request as unknown as WalletRequest;
          const result = await raw({
            type: "wallet_addInvokeTransaction",
            params,
          });
          const transactionHash = walletTransactionHash(result);
          if (transactionHash === null) {
            throw new Error("Wallet returned an invalid transaction hash.");
          }
          return { transaction_hash: transactionHash };
        }
        const calls = params.invoke_transaction.map((call) => ({
          calldata: [...call.calldata],
          contractAddress: call.contract_address,
          entrypoint: call.entry_point,
        }));
        return account.execute(calls);
      };
      return queueWalletRequest(
        preview,
        perform,
        input.reviewMode === "wallet" ? "awaiting" : "review",
      );
    },
    [account, queueWalletRequest, wallet],
  );

  const watchAsset = useCallback(
    (input: WatchAssetInput): Promise<void> => requestWatchAsset(wallet, input),
    [wallet],
  );

  const declareContract = useCallback(
    async (input: ContractDeclaration): Promise<DeclarationResult> => {
      if (wallet === null || typeof wallet.request !== "function") {
        throw new Error("Connect a wallet that supports contract declarations.");
      }
      const raw = wallet.request as unknown as WalletRequest;
      return queueWalletRequest<DeclarationResult>(
        {
          description:
            "Register the audited MC Punks Sierra class on this network before deploying it.",
          details: [
            { label: "Class hash", value: input.classHash },
            { label: "Compiled hash", value: input.compiledClassHash },
          ],
          kind: "declaration",
          title: "Declare Punk collection",
          warning: "Declaration fees are paid even if you decide not to deploy afterward.",
        },
        async () => {
          const result = declarationResult(
            await raw({
              type: "wallet_addDeclareTransaction",
              params: {
                declare_transaction: {
                  class_hash: input.classHash,
                  compiled_class_hash: input.compiledClassHash,
                  contract_class: input.contractClass,
                },
              },
            }),
          );
          if (result === null) {
            throw new Error("Wallet returned an invalid contract declaration result.");
          }
          return {
            classHash: result.classHash,
            transactionHash: result.transactionHash,
            transaction_hash: result.transactionHash,
          } as DeclarationResult & { readonly transaction_hash: string };
        },
      ).then(({ classHash, transactionHash }) => ({ classHash, transactionHash }));
    },
    [queueWalletRequest, wallet],
  );

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
        const addresses = await requestAccounts(target, true);
        const nextAddress = addresses[0];
        if (cancelled || nextAddress === undefined) {
          return;
        }
        const nextChainId = await requestChainId(target);
        const nextAccount = await resolveAccount(target, nextChainId);
        if (cancelled || nextAccount === null) {
          return;
        }
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
        void requestChainId(current).then((activeChain) =>
          resolveAccount(current, activeChain).then((nextAccount) => {
            if (nextAccount !== null) {
              setAccount(nextAccount);
            }
          }),
        );
      }
    };
    const onNetworkChanged = (network?: string): void => {
      const nextNetwork = network ?? null;
      setChainId(nextNetwork);
      const current = walletRef.current;
      if (current !== null) {
        void resolveAccount(current, nextNetwork).then((nextAccount) => {
          if (nextAccount !== null) {
            setAccount(nextAccount);
          }
        });
      }
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
      clearError,
      connect,
      requestTransaction,
      watchAsset,
      declareContract,
      disconnect,
    }),
    [
      account,
      address,
      chainId,
      walletName,
      isConnecting,
      error,
      clearError,
      connect,
      requestTransaction,
      watchAsset,
      declareContract,
      disconnect,
    ],
  );

  const chainName = walletNetwork(chainId)?.name ?? chainId ?? "Unknown network";
  return (
    <WalletContext.Provider value={value}>
      {children}
      {requestView === null ? null : (
        <WalletRequestDialog
          address={address}
          chainName={chainName}
          onApprove={() => void performWalletRequest()}
          onCancel={cancelWalletRequest}
          onClose={closeWalletRequest}
          onRetry={() => void performWalletRequest()}
          request={requestView}
          walletName={walletName}
        />
      )}
    </WalletContext.Provider>
  );
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
