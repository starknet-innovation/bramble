/**
 * Historical public-state readiness checks required before the privacy prover
 * reads a freshly deployed account or recently funded ERC20 balance.
 */

import { decodeUint256Response } from "@bramble/starknet/rpc-assets";
import { canonicalFelt } from "@bramble/wallet-model/networks";
import type { Strk20Action } from "@bramble/wallet-protocol/strk20";
import type { Call, RpcProvider } from "starknet";

const depositRequirements = (
  actions: readonly Strk20Action[],
): ReadonlyMap<string, bigint> | null => {
  const requirements = new Map<string, bigint>();
  for (const action of actions) {
    if (action.type === "deposit") {
      const token = canonicalFelt(action.token);
      if (token === null) {
        return null;
      }
      requirements.set(token, (requirements.get(token) ?? 0n) + BigInt(action.amount));
    }
  }
  return requirements;
};

/**
 * Checks that the account contract exists at the exact historical proof base.
 * A missing or temporarily unreadable class remains not ready and is retried.
 */
export const isHistoricalAccountReady = async (
  provider: RpcProvider,
  accountAddress: string,
  block: number,
): Promise<boolean> => {
  try {
    await provider.getClassHashAt(accountAddress, block);
    return true;
  } catch {
    return false;
  }
};

/**
 * Checks that every deposited ERC20 amount is already visible at the exact
 * historical proof base. Malformed token responses fail closed.
 */
export const areHistoricalDepositsReady = async (
  provider: RpcProvider,
  accountAddress: string,
  actions: readonly Strk20Action[],
  block: number,
): Promise<boolean> => {
  const requirements = depositRequirements(actions);
  if (requirements === null) {
    return false;
  }
  for (const [token, required] of requirements) {
    const call: Call = {
      calldata: [accountAddress],
      contractAddress: token,
      entrypoint: "balanceOf",
    };
    try {
      const balance = decodeUint256Response(await provider.callContract(call, block));
      if (balance === null || balance < required) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
};
