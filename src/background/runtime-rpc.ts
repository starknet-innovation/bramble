/**
 * Starknet RPC surface consumed by background message dispatch, injectable so
 * tests can stub network access.
 */
import {
  type BalanceInput,
  type DeclareInput,
  type DeployAccountInput,
  type DeploymentStatusInput,
  estimateInvokeFee,
  getDeploymentStatus,
  getNftOwner,
  getTokenBalances,
  getTokenMetadata,
  getTransactionStatuses,
  type InvokeInput,
  type NftOwnerInput,
  submitAccountDeployment,
  submitDeclareTransaction,
  submitErc20Transfer,
  submitInvokeTransaction,
  type TokenMetadataInput,
  type TransactionStatusInput,
  type TransferInput,
} from "../starknet/rpc";

/**
 * Injectable Starknet RPC operations used by the message handler.
 */
export type RuntimeRpc = {
  readonly estimateInvokeFee: (input: InvokeInput) => ReturnType<typeof estimateInvokeFee>;
  readonly getDeploymentStatus: (
    input: DeploymentStatusInput,
  ) => ReturnType<typeof getDeploymentStatus>;
  readonly getNftOwner: (input: NftOwnerInput) => ReturnType<typeof getNftOwner>;
  readonly getTokenBalances: (input: BalanceInput) => ReturnType<typeof getTokenBalances>;
  readonly getTokenMetadata: (input: TokenMetadataInput) => ReturnType<typeof getTokenMetadata>;
  readonly getTransactionStatuses: (
    input: TransactionStatusInput,
  ) => ReturnType<typeof getTransactionStatuses>;
  readonly submitAccountDeployment: (
    input: DeployAccountInput,
  ) => ReturnType<typeof submitAccountDeployment>;
  readonly submitDeclareTransaction: (
    input: DeclareInput,
  ) => ReturnType<typeof submitDeclareTransaction>;
  readonly submitErc20Transfer: (input: TransferInput) => ReturnType<typeof submitErc20Transfer>;
  readonly submitInvokeTransaction: (
    input: InvokeInput,
  ) => ReturnType<typeof submitInvokeTransaction>;
};

/**
 * Production RPC wiring used when no stub is injected.
 */
export const defaultRuntimeRpc: RuntimeRpc = {
  estimateInvokeFee,
  getDeploymentStatus,
  getNftOwner,
  getTokenBalances,
  getTokenMetadata,
  getTransactionStatuses,
  submitAccountDeployment,
  submitDeclareTransaction,
  submitErc20Transfer,
  submitInvokeTransaction,
};
