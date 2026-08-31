/** Read-only exact invoke fee estimation. */

import { WalletError } from "@mc-wallet/core/errors";
import type { RpcProvider } from "starknet";

import { isCompatibleAccountDeployed } from "../transactions/deployment-compatibility";
import { type FeeEstimate, reviewedSpendFor } from "./fee-bounds";
import { estimateExactInvokeFee } from "./invoke-fee";
import { estimatingAccountFor, krustyAccount, withRpcFallback } from "./provider";
import type { InvokeInput } from "./rpc-submit";

/**
 * Estimates exact invoke calls and optional proof without signing or broadcast.
 * OZ validation is skipped so a review never opens a Ledger prompt. Argent and
 * ML-DSA both estimate with validation enabled through a query-version dummy
 * signature, so their account overhead is included without reading private key
 * material or waking a device — see `estimateMode`.
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
      const { account: starknetAccount, skipValidate } = estimatingAccountFor(
        provider,
        account,
        krustyAccount(provider, account, signHash),
      );
      const deployed = await isCompatibleAccountDeployed(provider, account);
      const estimate = await estimateExactInvokeFee(
        starknetAccount,
        account,
        calls,
        proof,
        deployed,
        skipValidate,
      );
      return reviewedSpendFor(estimate, speed);
    },
    makeProvider,
  );
};
