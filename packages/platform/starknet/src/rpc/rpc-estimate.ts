/** Read-only exact invoke fee estimation. */

import { WalletError } from "@mc-wallet/core/errors";
import type { RpcProvider } from "starknet";
import { isAccountDeployed } from "../transactions/deployment";
import { type FeeEstimate, reviewedSpendFor } from "./fee-bounds";
import { estimateExactInvokeFee } from "./invoke-fee";
import { krustyAccount, withRpcFallback } from "./provider";
import type { InvokeInput } from "./rpc-submit";

/**
 * Estimates exact invoke calls and optional proof without signing or broadcast.
 * Validation is skipped so a review never opens a Ledger prompt; the returned
 * amount reflects the bounds the selected speed would authorize.
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
      const starknetAccount = krustyAccount(provider, account, signHash);
      const deployed = await isAccountDeployed(provider, account.address);
      const estimate = await estimateExactInvokeFee(
        starknetAccount,
        account,
        calls,
        proof,
        deployed,
      );
      return reviewedSpendFor(estimate, speed);
    },
    makeProvider,
  );
};
