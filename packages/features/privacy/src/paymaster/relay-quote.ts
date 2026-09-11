/**
 * Assembles one sponsored-private relay quote into a frozen submission plan.
 *
 * Everything the route is trusted on is decided here and nowhere else: the
 * pool's charge is read on-chain, the bound that charge implies is derived by
 * `./fee-bound`, and the relay's answer is admitted only if it satisfies that
 * bound. Splitting this out of the service keeps the whole fee decision on one
 * screen, where it can be reviewed against the relay's OpenRPC contract.
 */

import { WalletError } from "@bramble/core/errors";
import {
  STARKNET_NETWORKS,
  type StarknetNetworkId,
  sameFelt,
} from "@bramble/wallet-model/networks";
import type { Strk20Action } from "@bramble/wallet-protocol/strk20";
import type { RpcProvider } from "starknet";
import type { Strk20NetworkConfig } from "../config";
import {
  STRK20_FEE_UNVERIFIABLE,
  STRK20_SERVICE_UNAVAILABLE,
  type Strk20FeeReference,
} from "../policy/fee-policy";
import type { Strk20PrivateRelayPlan } from "../policy/submission-plan";
import { Strk20FeeTokenUnsupportedError } from "../sdk/official-sdk-errors";
import type { ServiceRetryPause } from "../sdk/official-sdk-retry";
import { approveCalls, RELAY_PAYS_POOL_FEE, readStrk20PoolFee } from "../sdk/official-sdk-values";
import { STRK20_SUBMISSION_UNAVAILABLE } from "../service";
import { preferredStrk20FeeToken, resolveStrk20FeeBound } from "./fee-bound";
import { buildStrk20PaymasterPlan } from "./paymaster";

/**
 * Quotes the relay route for `actions` and freezes the result.
 *
 * Fails closed before any network call when the network has no relay
 * configured, and before proving when the fee token cannot be bounded. The
 * returned plan is the exact one submission must carry: it records the fee
 * action, and on a converted fee token the ceiling that admitted it.
 */
export const quoteStrk20RelayPlan = async (input: {
  readonly accountAddress: string;
  readonly actions: readonly Strk20Action[];
  readonly config: Strk20NetworkConfig;
  readonly feeReference?: Strk20FeeReference;
  readonly http?: (request: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  readonly networkId: StarknetNetworkId;
  readonly nowSeconds?: () => number;
  readonly pauseForServiceRetry: ServiceRetryPause;
  readonly providerFor: (nodeUrl: string) => RpcProvider;
  readonly rpcUrls: readonly string[];
}): Promise<Strk20PrivateRelayPlan> => {
  const paymaster = input.config.paymaster;
  if (!paymaster) {
    throw new WalletError(
      `${STRK20_SUBMISSION_UNAVAILABLE}: no private relay is configured for this network`,
    );
  }
  if (!input.nowSeconds) {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  const nowSeconds = input.nowSeconds;
  const poolFeeFri = await readStrk20PoolFee(
    input.providerFor,
    input.rpcUrls,
    input.config.poolAddress,
    input.pauseForServiceRetry,
  );
  const quoteIn = async (feeToken: string): Promise<Strk20PrivateRelayPlan> => {
    const feeBound = await resolveStrk20FeeBound({
      ...(input.feeReference ? { feeReference: input.feeReference } : {}),
      feeToken,
      networkId: input.networkId,
      poolFeeFri,
    });
    return buildStrk20PaymasterPlan({
      accountAddress: input.accountAddress,
      approveCalls: approveCalls(input.actions, input.config.poolAddress, RELAY_PAYS_POOL_FEE),
      chainId: STARKNET_NETWORKS[input.networkId].chainId,
      config: { ...paymaster, feeToken },
      feeBound,
      ...(input.http ? { http: input.http } : {}),
      nowSeconds: nowSeconds(),
      poolAddress: input.config.poolAddress,
    });
  };

  const preferred = preferredStrk20FeeToken(input.actions, paymaster.feeToken);
  if (sameFelt(preferred, paymaster.feeToken)) {
    return quoteIn(paymaster.feeToken);
  }
  // The preferred token is only a preference, and two things can veto it: no
  // independent price to bound a conversion against, and the relay's own
  // refusal. Both land on the configured token instead of failing the send,
  // because a fee the wallet cannot bound is a reason to change denomination,
  // not to strand a shielded balance. Only a quote is retried — no proof has
  // been built and nothing is in flight, so re-quoting is free of side effects.
  try {
    return await quoteIn(preferred);
  } catch (error) {
    if (
      error instanceof Strk20FeeTokenUnsupportedError ||
      (error instanceof WalletError && error.message === STRK20_FEE_UNVERIFIABLE)
    ) {
      return quoteIn(paymaster.feeToken);
    }
    throw error;
  }
};
