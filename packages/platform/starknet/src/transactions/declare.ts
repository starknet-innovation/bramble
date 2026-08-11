/**
 * Starknet declare-transaction submission backed by starknet-js and Krusty
 * signatures. Kept out of rpc.ts so that file stays within the size budget.
 */

import { ensureAccountDeployed } from "@mc-wallet/starknet/deployment";
import {
  krustyAccount,
  type StarkHashSigner,
  withRpcFallback,
  withRpcWrite,
} from "@mc-wallet/starknet/provider";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { STARKNET_NETWORKS } from "@mc-wallet/wallet-model/networks";
import type { Account, CompiledContract, RpcProvider } from "starknet";

/**
 * Inputs for submitting one declare transaction. `contractClass` is the opaque
 * dapp-provided CONTRACT_CLASS; `classHash` is an optional optimization.
 */
export type DeclareInput = {
  readonly account: AccountRef;
  readonly classHash?: string;
  readonly compiledClassHash: string;
  readonly contractClass: unknown;
  readonly rpcUrls: readonly string[];
  readonly signHash: StarkHashSigner;
};

/**
 * Declare submission result carrying the padded-source transaction and class
 * hashes returned by the node.
 */
export type DeclareSubmission = {
  readonly classHash: string;
  readonly transactionHash: string;
};

/**
 * Network fee estimate for a declaration, denominated by the RPC-provided unit.
 */
export type DeclareFeeEstimate = {
  readonly overallFee: string;
  readonly unit: string;
};

const declarePayload = ({
  classHash,
  compiledClassHash,
  contractClass,
}: Pick<DeclareInput, "classHash" | "compiledClassHash" | "contractClass">) => ({
  compiledClassHash,
  contract: contractClass as CompiledContract,
  ...(classHash === undefined ? {} : { classHash }),
});

/**
 * Estimates a Cairo 1 declaration fee without broadcasting or signing. The
 * estimate explicitly skips account validation, so the Krusty signer remains
 * untouched until the user approves the queued declaration.
 */
export const estimateDeclareFee = async (
  input: DeclareInput,
  makeProvider?: (nodeUrl: string) => RpcProvider,
  makeAccount: typeof krustyAccount = krustyAccount,
): Promise<DeclareFeeEstimate> =>
  withRpcFallback(
    input.rpcUrls,
    async (provider) => {
      const estimate = await makeAccount(
        provider,
        input.account,
        input.signHash,
      ).estimateDeclareFee(declarePayload(input), { skipValidate: true });
      return {
        overallFee: BigInt(estimate.overall_fee).toString(),
        unit: typeof estimate.unit === "string" ? estimate.unit : "FRI",
      };
    },
    makeProvider,
  );

/**
 * Signs and submits a declare transaction through an account contract,
 * deploying the counterfactual account first when this is its first
 * transaction. Returns the node's transaction and class hashes. Optional
 * factories are dependency seams for deterministic tests; production uses the
 * standard RPC provider and Krusty account.
 */
export const submitDeclareTransaction = async (
  { account, classHash, compiledClassHash, contractClass, rpcUrls, signHash }: DeclareInput,
  makeProvider?: (nodeUrl: string) => RpcProvider,
  makeAccount: typeof krustyAccount = krustyAccount,
): Promise<DeclareSubmission> =>
  withRpcWrite(
    rpcUrls,
    STARKNET_NETWORKS[account.networkId].chainId,
    async (provider) => {
      const starknetAccount = makeAccount(provider, account, signHash);
      await ensureAccountDeployed(provider, starknetAccount, account);
      const result = await (starknetAccount as Account).declare(
        declarePayload({
          compiledClassHash,
          contractClass,
          ...(classHash === undefined ? {} : { classHash }),
        }),
      );
      return {
        classHash: result.class_hash,
        transactionHash: result.transaction_hash,
      };
    },
    makeProvider,
  );
