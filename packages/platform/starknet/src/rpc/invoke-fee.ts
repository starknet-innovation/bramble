/** Exact invoke estimation for deployed and counterfactual accounts. */

import { WalletError } from "@mc-wallet/core/errors";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import type { Strk20Proof } from "@mc-wallet/wallet-protocol/strk20";
import { type Account, type Call, TransactionType } from "starknet";
import { ozAccountDeployment } from "../transactions/deployment";

/**
 * Estimates the exact invocation without signing. For an undeployed account,
 * the node simulates DEPLOY_ACCOUNT followed by INVOKE as one ordered batch so
 * the invocation is estimated against the state in which it will execute.
 * Missing/malformed bulk results fail closed.
 */
export const estimateExactInvokeFee = async (
  starknetAccount: Account,
  account: AccountRef,
  calls: readonly Call[],
  proof: Strk20Proof | undefined,
  deployed: boolean,
): ReturnType<Account["estimateInvokeFee"]> => {
  const details = {
    ...(proof ? { proof: proof.data, proofFacts: [...proof.proof_facts] } : {}),
    skipValidate: true,
  } as Parameters<Account["estimateInvokeFee"]>[1];
  if (deployed) {
    return starknetAccount.estimateInvokeFee([...calls], details);
  }
  const deployment = ozAccountDeployment(account);
  const estimates = await starknetAccount.estimateFeeBulk(
    [
      {
        type: TransactionType.DEPLOY_ACCOUNT,
        payload: {
          addressSalt: deployment.addressSalt,
          classHash: deployment.classHash,
          constructorCalldata: [...deployment.constructorCalldata],
          contractAddress: deployment.contractAddress,
        },
      },
      { type: TransactionType.INVOKE, payload: [...calls] },
    ],
    details,
  );
  const estimate = estimates[1];
  if (!estimate) {
    throw new WalletError("The node did not return an invoke fee estimate");
  }
  return estimate;
};
