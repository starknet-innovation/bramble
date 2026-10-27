/**
 * Builds the gasless fee choices a review may offer. The wallet flag and the
 * forwarder pin are read from config: while either refuses, this returns
 * nothing and does not call the gateway. STRK stays the fee unless the user
 * later picks one of these offers.
 */

import { untrustedFetch } from "@bramble/core/http-json";
import type { PriceService } from "@bramble/portfolio/prices";
import { knownTokensForNetwork } from "@bramble/portfolio/token-registry";
import { gaslessRoute, gaslessRouteReady } from "@bramble/privacy/config";
import type { GaslessFeeOffer } from "@bramble/privacy/gasless-request";
import { quoteGaslessOffers, submitReviewedGaslessInvoke } from "@bramble/privacy/gasless-submit";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { accountDeployment } from "@bramble/starknet/deployment";
import type { StarkHashSigner } from "@bramble/starknet/provider";
import type { FeeEstimate } from "@bramble/starknet/rpc";
import { systemClock } from "@bramble/transactions/activity";
import type { FeeAffordability } from "@bramble/transactions/fee-funds";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { STARKNET_NETWORKS, STRK_TOKEN_ADDRESS, sameFelt } from "@bramble/wallet-model/networks";
import type { Call } from "starknet";
import { createStrk20FeeReference } from "../privacy/strk20-fee-reference";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import { networkRpcUrls } from "../runtime/runtime-state";

/** Production transport. Forwards the request hardening the caller put in `init`. */
const gaslessHttp = (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return untrustedFetch(url, init);
};

/**
 * Offers for one review. Empty when gasless is off, STRK covers the fee, the
 * account cannot sign SNIP-9 v2, or the route cannot be checked. Failures
 * hide the choice; they do not fail the STRK review.
 */
export const reviewGaslessOffers = async (input: {
  readonly account: AccountRef;
  readonly calls: readonly Call[];
  readonly deployed: boolean;
  readonly preferences: WalletPreferences;
  readonly prices: PriceService;
  readonly runtimeRpc: Pick<RuntimeRpc, "getTokenBalances">;
  readonly strkAffordability: FeeAffordability;
  readonly strkFee: FeeEstimate | null;
}): Promise<readonly GaslessFeeOffer[]> => {
  const route = gaslessRoute(input.account.networkId);
  if (
    !gaslessRouteReady(route) ||
    input.strkAffordability !== "insufficient" ||
    input.strkFee === null ||
    input.strkFee.unit !== "FRI"
  ) {
    return [];
  }
  let strkFee: bigint;
  try {
    strkFee = BigInt(input.strkFee.overallFee);
  } catch {
    return [];
  }
  const known = knownTokensForNetwork(input.account.networkId).filter(
    (token) => !sameFelt(token.address, STRK_TOKEN_ADDRESS),
  );
  if (known.length === 0 || strkFee <= 0n) {
    return [];
  }
  const balances = await input.runtimeRpc
    .getTokenBalances({
      accountAddress: input.account.address,
      rpcUrls: networkRpcUrls(STARKNET_NETWORKS[input.account.networkId], input.preferences),
      tokens: [...known],
    })
    .catch(() => []);
  let deployment: ReturnType<typeof accountDeployment> | null = null;
  if (!input.deployed) {
    try {
      deployment = accountDeployment(input.account);
    } catch {
      deployment = null;
    }
  }
  const reference = createStrk20FeeReference(input.prices);
  return quoteGaslessOffers({
    account: {
      accountContractType: input.account.accountContractType,
      address: input.account.address,
      classHash: input.account.classHash,
      deployed: input.deployed,
    },
    calls: input.calls,
    deployment,
    http: gaslessHttp,
    nowSeconds: Math.floor(systemClock() / 1000),
    referenceFor: (token) =>
      reference({
        feeToken: token.address,
        networkId: input.account.networkId,
        poolFeeFri: strkFee,
      }),
    route,
    strkShort: true,
    tokens: known.map((token) => ({
      address: token.address,
      balance:
        balances.find((balance) => sameFelt(balance.address, token.address))?.balance ?? null,
      decimals: token.decimals,
      label: token.symbol,
    })),
  });
};

/**
 * Submits a fee the user already chose. Throws the paymaster refusal or a
 * lost-reply error; it does not fall back to STRK, because that would sign
 * a different fee from the one on the control.
 */
export const executeReviewedGasless = async (input: {
  readonly account: AccountRef;
  readonly calls: readonly Call[];
  readonly gaslessFee: GaslessFeeOffer;
  readonly isAuthorized: () => boolean;
  readonly preferences: WalletPreferences;
  readonly prices: PriceService;
  readonly runtimeRpc: Pick<RuntimeRpc, "getDeploymentStatus">;
  readonly signHash: StarkHashSigner;
  readonly strkFee: FeeEstimate | null;
}): Promise<Awaited<ReturnType<typeof submitReviewedGaslessInvoke>>> => {
  const route = gaslessRoute(input.account.networkId);
  const strkFee =
    input.strkFee !== null && input.strkFee.unit === "FRI" ? BigInt(input.strkFee.overallFee) : 0n;
  const reference = createStrk20FeeReference(input.prices);
  const deployed = await input.runtimeRpc
    .getDeploymentStatus({
      accountAddress: input.account.address,
      rpcUrls: networkRpcUrls(STARKNET_NETWORKS[input.account.networkId], input.preferences),
    })
    .catch(() => true);
  let deployment: ReturnType<typeof accountDeployment> | null = null;
  if (!deployed) {
    try {
      deployment = accountDeployment(input.account);
    } catch {
      deployment = null;
    }
  }
  return submitReviewedGaslessInvoke({
    account: {
      accountContractType: input.account.accountContractType,
      address: input.account.address,
      classHash: input.account.classHash,
      deployed,
    },
    calls: input.calls,
    deployment,
    http: gaslessHttp,
    isAuthorized: input.isAuthorized,
    nowSeconds: Math.floor(systemClock() / 1000),
    referenceFor: (token) =>
      reference({
        feeToken: token.address,
        networkId: input.account.networkId,
        poolFeeFri: strkFee,
      }),
    reviewed: input.gaslessFee,
    route,
    signHash: input.signHash,
  });
};
