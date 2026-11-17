/**
 * Fee shown on a multisig dapp invoke card. A threshold of 1 uses the ordinary
 * estimate. A proposal uses the same preparation that will be frozen, including
 * its long-lived L1 price ceiling, so approval does not compare that ceiling
 * with a smaller number the user never reviewed.
 */

import type { ArgentMultisigRecord } from "@bramble/multisig/repository";
import type { FeeEstimate } from "@bramble/starknet/fee-bounds";
import { preparedArgentMultisigFee } from "@bramble/starknet/multisig-invoke";
import { resolveFeeAffordability } from "@bramble/transactions/fee-funds";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import type { Call } from "starknet";
import { FAILED_INVOKE_FEE } from "../approvals/invoke-fee-review";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import { networkRpcUrls } from "../runtime/runtime-state";
import { readStrkBalance } from "../transactions/fee-guard";

const proposalCalls = (calls: readonly Call[]) =>
  calls.map((call) => ({
    calldata: Array.isArray(call.calldata) ? call.calldata.map((item) => String(item)) : [],
    contractAddress: call.contractAddress,
    entrypoint: call.entrypoint,
  }));

type PricedInvoke = {
  readonly fee: FeeEstimate;
  readonly feeAffordability: ReturnType<typeof resolveFeeAffordability>;
  readonly feeEstimateFailed: false;
  readonly feeEstimatePending: false;
  readonly requiresDeployment: false;
};

/**
 * Prices one multisig invoke for its review card. A failed read is the failed
 * fee shape, never a throw, so the card stays on screen with its retry.
 */
export const priceMultisigInvoke = async (
  deps: { readonly runtimeRpc: RuntimeRpc },
  record: ArgentMultisigRecord,
  calls: readonly Call[],
  preferences: Parameters<typeof readStrkBalance>[2],
): Promise<typeof FAILED_INVOKE_FEE | PricedInvoke> => {
  const config = record.currentConfig;
  const prepare =
    config && config.threshold > 1 ? deps.runtimeRpc.multisig?.prepareInvoke : undefined;
  const estimate = deps.runtimeRpc.estimateMultisigDappFee;
  if (!config || (!prepare && !estimate)) return FAILED_INVOKE_FEE;
  const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[record.networkId], preferences);
  try {
    const quoted = prepare
      ? preparedArgentMultisigFee(
          await prepare({ account: record, calls: proposalCalls(calls), config, rpcUrls }),
        )
      : await estimate?.({ account: record, calls, config, rpcUrls });
    if (!quoted) return FAILED_INVOKE_FEE;
    const balance = await readStrkBalance(deps, record, preferences);
    return {
      fee: quoted,
      feeAffordability: resolveFeeAffordability({ balance, fee: quoted }),
      feeEstimateFailed: false,
      feeEstimatePending: false,
      requiresDeployment: false,
    };
  } catch {
    return FAILED_INVOKE_FEE;
  }
};
