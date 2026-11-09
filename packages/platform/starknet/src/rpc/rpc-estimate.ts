/** Read-only exact invoke fee estimation. */

import { WalletError } from "@bramble/core/errors";
import type { RpcProvider } from "starknet";
import { isCompatibleAccountDeployed, refuseUndeployedBraavos } from "../transactions/deployment";
import { type FeeEstimate, reviewedSpendFor } from "./fee-bounds";
import { estimateExactInvokeFee } from "./invoke-fee";
import { argentQueryAccount, krustyAccount, withRpcFallback } from "./provider";
import type { InvokeInput } from "./rpc-submit";

/**
 * Estimates exact invoke calls and optional proof without signing or broadcast.
 * OZ validation is skipped so a review never opens a Ledger prompt. Argent
 * uses a shape-correct query signature with validation enabled, so its account
 * overhead is included without reading private key material.
 */
export const estimateInvokeFee = async (
  { account, calls, proof, rpcUrls, signHash, speed = "standard" }: InvokeInput,
  makeProvider?: (nodeUrl: string) => RpcProvider,
): Promise<FeeEstimate> => {
  if (calls.length === 0) {
    throw new WalletError("No calls to estimate");
  }
  return withRpcFallback(
    rpcUrls,
    async (provider) => {
      const validateArgent = account.accountContractType === "argent";
      const starknetAccount = validateArgent
        ? argentQueryAccount(provider, account)
        : krustyAccount(provider, account, signHash);
      const deployed = await isCompatibleAccountDeployed(provider, account);
      refuseUndeployedBraavos(account, deployed);
      const estimate = await estimateExactInvokeFee(
        starknetAccount,
        account,
        calls,
        proof,
        deployed,
        !validateArgent,
      );
      return reviewedSpendFor(estimate, speed);
    },
    makeProvider,
  );
};
