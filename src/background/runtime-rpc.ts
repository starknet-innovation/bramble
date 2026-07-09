/**
 * Starknet RPC surface consumed by background message dispatch, injectable so
 * tests can stub network access.
 */

import {
  computeMultisigTransactionId,
  getMultisigConfig,
  getMultisigProposalStatus,
  type MultisigConfigInput,
  type MultisigProposalStatusInput,
  type MultisigTransactionIdInput,
} from "../starknet/multisig";
import {
  isMultisigClassDeclared,
  type MultisigClassStatusInput,
} from "../starknet/multisig-deploy";
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
import { createHttpStrk20Service, type Strk20Http } from "../starknet/strk20/http-service";
import type { Strk20Service } from "../starknet/strk20/service";

/**
 * Injectable multisig read operations used by the multisig message handlers.
 */
export type MultisigRpc = {
  readonly computeTransactionId: (
    input: MultisigTransactionIdInput,
  ) => ReturnType<typeof computeMultisigTransactionId>;
  readonly getConfig: (input: MultisigConfigInput) => ReturnType<typeof getMultisigConfig>;
  readonly getProposalStatus: (
    input: MultisigProposalStatusInput,
  ) => ReturnType<typeof getMultisigProposalStatus>;
  readonly isClassDeclared: (
    input: MultisigClassStatusInput,
  ) => ReturnType<typeof isMultisigClassDeclared>;
};

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
  /**
   * Multisig read surface. Optional so existing RPC stubs stay valid; when
   * absent the multisig handlers report the feature as unavailable.
   */
  readonly multisig?: MultisigRpc;
  /**
   * STRK20 privacy service. Optional so existing RPC stubs stay valid; when
   * absent the handler falls back to {@link unavailableStrk20Service}, which
   * reports the account as not registered.
   */
  readonly strk20?: Strk20Service;
};

// Real network transport for the STRK20 prover: a thin `fetch` wrapper matching
// the {@link Strk20Http} shape the HTTP service expects.
const strk20Http: Strk20Http = (url, init) => fetch(url, init);

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
  multisig: {
    computeTransactionId: computeMultisigTransactionId,
    getConfig: getMultisigConfig,
    getProposalStatus: getMultisigProposalStatus,
    isClassDeclared: isMultisigClassDeclared,
  },
  submitAccountDeployment,
  submitDeclareTransaction,
  submitErc20Transfer,
  submitInvokeTransaction,
  strk20: createHttpStrk20Service(strk20Http),
};
