/**
 * Wallet connection context for the trade terminal.
 *
 * Connects directly to the injected Bramble provider (preferring
 * window.starknet_bramble), exposes the connected account and address, and
 * drives the Connect / Disconnect buttons throughout the shell.
 *
 * Screens consume this via the `useWallet()` hook. Protocol calldata is handed
 * to `requestTransaction()` so every action receives the same terminal review,
 * wallet hand-off, rejection, retry, and submission feedback.
 */
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
import { WalletError } from "../../protocols/support/errors";
import { userErrorMessage } from "../../protocols/support/user-error";
import type { AccountInterface, InvokeFunctionResponse } from "starknet";
import {
  INJECTION_TIMEOUT_MS,
  type StarknetWindowObject,
  waitForInjectedBramble,
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
import { WalletRequestDialog } from "../requests/WalletRequestDialog";
import {
  type WalletRequestPreview,
  type WalletRequestView,
  type WalletTransactionRequest,
  walletInvokeParams,
  walletRequestError,
  walletTransactionHash,
} from "../requests/wallet-request";
import {
  requestPrivateBalances,
  requestPrivateInvoke,
  requestPrivateProof,
  requestPrivateRegistration,
} from "../privacy/privacy-wallet";
import type {
  ContractDeclaration,
  DeclarationResult,
  WalletContextValue,
} from "./wallet-context-types";

export type { WalletContextValue };

const WalletContext = createContext<WalletContextValue | null>(null);

const WALLET_IDENTITY_CHANGED = "Wallet account or network changed before approval.";

const walletIdentity = (address: string | null, chainId: string | null): string =>
  address === null ? "" : `${address}:${chainId ?? ""}`;

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

// A queued request is built for the account and network that were active when
// it was queued (Sherlock 222). `identity` records them; `inFlight` marks a
// request the wallet is already handling, which only the wallet can settle.
type PendingWalletRequest = {
  readonly identity: string;
  inFlight: boolean;
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
  // The account and network this render's callbacks build requests for.
  const identity = walletIdentity(address, chainId);

  const dropWalletRequest = useCallback((reason: string) => {
    pendingRequestRef.current?.reject(new Error(reason));
    pendingRequestRef.current = null;
    setRequestView(null);
  }, []);

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
    dropWalletRequest("Wallet disconnected before approval.");
    walletRef.current = null;
    setWallet(null);
    setAccount(null);
    setAddress(null);
    setChainId(null);
    setWalletName(null);
  }, [dropWalletRequest]);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    try {
      const target = await resolveWallet();
      if (target === null) {
        throw new Error("No Starknet wallet detected. Install the Bramble extension.");
      }
      const addresses = await requestAccounts(target);
      const nextAddress = addresses[0];
      if (nextAddress === undefined) {
        throw new WalletError("Wallet did not authorize an account.");
      }
      const nextChainId = await requestChainId(target);
      const nextAccount = await resolveAccount(target, nextChainId);
      if (nextAccount === null) {
        throw new WalletError("Could not resolve the connected account.");
      }
      applyConnected(target, nextAccount, nextAddress, nextChainId);
    } catch (cause) {
      clear();
      setError(userErrorMessage(cause, "Couldn't connect your wallet. Try again."));
    } finally {
      setIsConnecting(false);
    }
  }, [applyConnected, clear]);

  const disconnect = useCallback(async () => {
    try {
      await walletRef.current?.disconnect?.();
    } catch {
      // Ignore disconnect failures — we clear local state regardless.
    }
    clear();
  }, [clear]);

  const clearError = useCallback(() => setError(null), []);

  const executeWalletRequest = useCallback(
    async (pending: PendingWalletRequest, preview: WalletRequestPreview): Promise<void> => {
      try {
        pending.inFlight = true;
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
      } finally {
        pending.inFlight = false;
      }
    },
    [],
  );

  const performWalletRequest = useCallback(async (): Promise<void> => {
    const pending = pendingRequestRef.current;
    const preview = requestView?.preview;
    if (pending === null || preview === undefined) {
      return;
    }
    if (pending.identity !== identity) {
      dropWalletRequest(WALLET_IDENTITY_CHANGED);
      return;
    }
    setRequestView({ phase: "awaiting", preview });
    await executeWalletRequest(pending, preview);
  }, [dropWalletRequest, executeWalletRequest, identity, requestView]);

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
          identity,
          inFlight: false,
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
    [executeWalletRequest, identity],
  );

  const cancelWalletRequest = useCallback(
    () => dropWalletRequest("Wallet request cancelled."),
    [dropWalletRequest],
  );

  // A request still under review, or failed and offering a retry, was built for
  // the previous account or network, so it is dropped rather than sent for the
  // new one. One the wallet is already handling is left to the wallet.
  useEffect(() => {
    const pending = pendingRequestRef.current;
    if (pending !== null && !pending.inFlight && pending.identity !== identity) {
      dropWalletRequest(WALLET_IDENTITY_CHANGED);
    }
  }, [dropWalletRequest, identity]);

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
        // Runs on every attempt, right before the wallet sees the calls.
        await input.handoffCheck?.();
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

  const privateBalances = useCallback(
    (tokens: readonly string[]) => requestPrivateBalances(wallet, tokens),
    [wallet],
  );

  const preparePrivateInvoke = useCallback(
    (actions: readonly unknown[]) => requestPrivateProof(wallet, actions),
    [wallet],
  );

  const invokePrivate = useCallback(
    (actions: readonly unknown[]) => requestPrivateInvoke(wallet, actions),
    [wallet],
  );

  const registerPrivate = useCallback(() => requestPrivateRegistration(wallet), [wallet]);

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
        const target = await waitForInjectedBramble(INJECTION_TIMEOUT_MS);
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
      invokePrivate,
      preparePrivateInvoke,
      privateBalances,
      registerPrivate,
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
      invokePrivate,
      preparePrivateInvoke,
      privateBalances,
      registerPrivate,
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
