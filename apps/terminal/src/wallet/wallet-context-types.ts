/**
 * Public types shared by the Terminal wallet provider and its consumers.
 */
import type { AccountInterface, InvokeFunctionResponse } from "starknet";
import type { PrivateBalance, PrivateCallAndProof } from "./privacy-wallet";
import type { WatchAssetInput } from "./wallet-connection";
import type { WalletTransactionRequest } from "./wallet-request";

export type ContractDeclaration = {
  readonly classHash: string;
  readonly compiledClassHash: string;
  readonly contractClass: Readonly<Record<string, unknown>>;
};

export type DeclarationResult = {
  readonly classHash: string;
  readonly transactionHash: string;
};

/** State and reviewed actions exposed by the wallet provider. */
export type WalletContextValue = {
  readonly account: AccountInterface | null;
  readonly address: string | null;
  readonly chainId: string | null;
  readonly walletName: string | null;
  readonly isConnected: boolean;
  readonly isConnecting: boolean;
  readonly error: string | null;
  readonly clearError: () => void;
  readonly connect: () => Promise<void>;
  readonly requestTransaction: (
    input: WalletTransactionRequest,
  ) => Promise<InvokeFunctionResponse>;
  readonly privateBalances: (tokens: readonly string[]) => Promise<readonly PrivateBalance[]>;
  readonly preparePrivateInvoke: (actions: readonly unknown[]) => Promise<PrivateCallAndProof>;
  readonly invokePrivate: (actions: readonly unknown[]) => Promise<string>;
  readonly registerPrivate: () => Promise<string>;
  readonly watchAsset: (input: WatchAssetInput) => Promise<void>;
  readonly declareContract: (input: ContractDeclaration) => Promise<DeclarationResult>;
  readonly disconnect: () => Promise<void>;
};
