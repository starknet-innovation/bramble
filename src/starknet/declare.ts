/**
 * Starknet declare-transaction submission backed by starknet-js and Krusty
 * signatures. Kept out of rpc.ts so that file stays within the size budget.
 */
import type { Account, CompiledContract } from "starknet";
import type { AccountRef } from "../storage/vault-schema";
import { ensureAccountDeployed } from "./deployment";
import { krustyAccount, type StarkHashSigner, withRpcFallback } from "./provider";

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
 * Signs and submits a declare transaction through an account contract,
 * deploying the counterfactual account first when this is its first
 * transaction. Returns the node's transaction and class hashes.
 */
export const submitDeclareTransaction = async ({
  account,
  classHash,
  compiledClassHash,
  contractClass,
  rpcUrls,
  signHash,
}: DeclareInput): Promise<DeclareSubmission> =>
  withRpcFallback(rpcUrls, async (provider) => {
    const starknetAccount = krustyAccount(provider, account, signHash);
    await ensureAccountDeployed(provider, starknetAccount, account);
    const result = await (starknetAccount as Account).declare({
      compiledClassHash,
      contract: contractClass as CompiledContract,
      ...(classHash === undefined ? {} : { classHash }),
    });
    return {
      classHash: result.class_hash,
      transactionHash: result.transaction_hash,
    };
  });
