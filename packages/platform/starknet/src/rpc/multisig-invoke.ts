/** Frozen Argent multisig V3 preparation and exact-signature submission. */

import { WalletError } from "@mc-wallet/core/errors";
import { isStarknetNetworkId, STARKNET_NETWORKS, sameFelt } from "@mc-wallet/wallet-model/networks";
import { ETransactionVersion3, type RpcProvider, transaction } from "starknet";
import {
  ARGENT_MULTISIG_CONTRACT,
  type ArgentMultisigConfig,
  normalizeArgentMultisigConfig,
  serializeArgentMultisigSignature,
} from "../accounts/account-contracts";
import {
  argentMultisigRpcResourceBounds,
  argentMultisigTransactionHash,
  canonicalArgentMultisigFelt,
  isPreparedArgentMultisigInvokeV3,
  normalizeArgentMultisigCalls,
  normalizeArgentMultisigResourceBounds,
} from "./multisig-invoke-prepared";
import {
  ARGENT_MULTISIG_INVOKE_LIMITS,
  type ArgentMultisigAccountInput,
  type ArgentMultisigCall,
  type PrepareArgentMultisigInvokeV3Input,
  type PreparedArgentMultisigInvokeV3,
  type SubmitPreparedArgentMultisigInvokeV3Input,
} from "./multisig-invoke-types";
import {
  argentQueryAccount,
  matchingAcceptedRpcWriteHash,
  withRpcFallback,
  withRpcWrite,
} from "./provider";

/**
 * Re-exports strict guards and fee/comparison helpers for untrusted prepared
 * transaction records. They fail closed without accessing RPC or key material.
 */
export {
  isArgentMultisigCall,
  isArgentMultisigCalls,
  isPreparedArgentMultisigInvokeV3,
  preparedArgentMultisigFee,
  samePreparedArgentMultisigInvokeV3,
} from "./multisig-invoke-prepared";
/**
 * Re-exports the canonical stored and request types from their pure module.
 */
export {
  ARGENT_MULTISIG_INVOKE_LIMITS,
  type ArgentMultisigAccountInput,
  type ArgentMultisigCall,
  type PrepareArgentMultisigInvokeV3Input,
  type PreparedArgentMultisigCall,
  type PreparedArgentMultisigInvokeV3,
  type PreparedResourceBound,
  type PreparedResourceBounds,
  type SubmitPreparedArgentMultisigInvokeV3Input,
} from "./multisig-invoke-types";

/**
 * Provider-level preparation seam for tests and already selected read paths.
 * It estimates with an Argent-shaped F3 query signature and freezes the
 * corresponding production V3 hash without KMS access. Most callers should
 * use {@link prepareArgentMultisigInvokeV3} with RPC URLs.
 */
export const prepareArgentMultisigInvokeV3WithProvider = async (
  provider: RpcProvider,
  account: ArgentMultisigAccountInput,
  calls: readonly ArgentMultisigCall[],
  config: ArgentMultisigConfig,
): Promise<PreparedArgentMultisigInvokeV3> => {
  if (
    account.accountContractType !== "argent-multisig" ||
    !isStarknetNetworkId(account.networkId) ||
    !sameFelt(account.classHash, ARGENT_MULTISIG_CONTRACT.classHash)
  ) {
    throw new WalletError("Account is not the pinned Argent multisig class");
  }
  const senderAddress = canonicalArgentMultisigFelt(
    account.address,
    "Argent multisig address",
    true,
  );
  const normalizedConfig = normalizeArgentMultisigConfig(config);
  const normalizedCalls = normalizeArgentMultisigCalls(calls);
  const chainId = canonicalArgentMultisigFelt(await provider.getChainId(), "Starknet chain id");
  if (!sameFelt(chainId, STARKNET_NETWORKS[account.networkId].chainId)) {
    throw new WalletError("RPC endpoint chain id does not match the account network");
  }
  const nonce = canonicalArgentMultisigFelt(
    await provider.getNonceForAddress(senderAddress, "latest"),
    "Argent multisig nonce",
  );
  const tip = "0x0";
  const accountDeploymentData: readonly string[] = [];
  const paymasterData: readonly string[] = [];
  const nonceDataAvailabilityMode = "L1";
  const feeDataAvailabilityMode = "L1";
  const queryAccount = argentQueryAccount(provider, account, { multisig: normalizedConfig });
  const estimate = await queryAccount.estimateInvokeFee(
    normalizedCalls.map((call) => ({ ...call, calldata: [...call.calldata] })),
    {
      accountDeploymentData: [...accountDeploymentData],
      feeDataAvailabilityMode,
      nonce,
      nonceDataAvailabilityMode,
      paymasterData: [...paymasterData],
      skipValidate: false,
      tip,
      version: ETransactionVersion3.F3,
    },
  );
  const resourceBounds = normalizeArgentMultisigResourceBounds(estimate.resourceBounds);
  const calldata = transaction
    .getExecuteCalldata(
      normalizedCalls.map((call) => ({ ...call, calldata: [...call.calldata] })),
      "1",
    )
    .map((entry) => canonicalArgentMultisigFelt(entry, "Argent multisig execute calldata"));
  if (calldata.length > ARGENT_MULTISIG_INVOKE_LIMITS.executeCalldataFelts) {
    throw new WalletError("Invalid Argent multisig execute calldata length");
  }
  const fields: Omit<PreparedArgentMultisigInvokeV3, "transactionHash"> = {
    accountDeploymentData,
    calldata,
    calls: normalizedCalls,
    chainId,
    feeDataAvailabilityMode,
    nonce,
    nonceDataAvailabilityMode,
    paymasterData,
    resourceBounds,
    senderAddress,
    tip,
    version: ETransactionVersion3.V3,
  };
  return { ...fields, transactionHash: argentMultisigTransactionHash(fields) };
};

/**
 * Prepares a frozen transaction using transport-only read failover.
 */
export const prepareArgentMultisigInvokeV3 = async (
  { account, calls, config, rpcUrls }: PrepareArgentMultisigInvokeV3Input,
  makeProvider?: (nodeUrl: string) => RpcProvider,
): Promise<PreparedArgentMultisigInvokeV3> =>
  withRpcFallback(
    rpcUrls,
    (provider) => prepareArgentMultisigInvokeV3WithProvider(provider, account, calls, config),
    makeProvider,
  );

/**
 * Broadcasts the exact frozen V3 fields with a complete threshold signature.
 * No nonce read, fee estimate, transaction rebuild, or private signing occurs.
 */
export const submitPreparedArgentMultisigInvokeV3 = async (
  {
    config,
    isAuthorized,
    prepared,
    rpcUrls,
    signatures,
  }: SubmitPreparedArgentMultisigInvokeV3Input,
  makeProvider?: (nodeUrl: string) => RpcProvider,
): Promise<string> => {
  if (!isPreparedArgentMultisigInvokeV3(prepared)) {
    throw new WalletError("Invalid prepared Argent multisig transaction");
  }
  const signature = serializeArgentMultisigSignature(signatures, config);
  return withRpcWrite(
    rpcUrls,
    prepared.chainId,
    async (provider) => {
      if (isAuthorized?.() === false) {
        throw new WalletError("wallet locked");
      }
      const submitted = await provider.invokeFunction(
        {
          calldata: [...prepared.calldata],
          contractAddress: prepared.senderAddress,
          signature: [...signature],
        },
        {
          accountDeploymentData: [...prepared.accountDeploymentData],
          feeDataAvailabilityMode: prepared.feeDataAvailabilityMode,
          nonce: prepared.nonce,
          nonceDataAvailabilityMode: prepared.nonceDataAvailabilityMode,
          paymasterData: [...prepared.paymasterData],
          resourceBounds: argentMultisigRpcResourceBounds(prepared.resourceBounds),
          tip: prepared.tip,
          version: prepared.version,
        },
      );
      matchingAcceptedRpcWriteHash(submitted.transaction_hash, prepared.transactionHash);
      return prepared.transactionHash;
    },
    makeProvider,
  );
};
