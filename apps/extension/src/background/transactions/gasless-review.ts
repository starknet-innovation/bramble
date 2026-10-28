/**
 * Builds the gasless fee choices a review may offer, and submits one the user
 * already chose. The wallet flag and the forwarder pin gate both. STRK stays
 * the fee unless the user later picks an offer.
 *
 * Before anything is signed, the account is re-read with the same compatibility gate
 * the ordinary invoke uses. A refusal or an unreachable node throws; it is
 * never treated as "deployed". Braavos eligibility uses the live class, not
 * the deployment class stored on the account.
 */

import { untrustedFetch } from "@bramble/core/http-json";
import type { PriceService } from "@bramble/portfolio/prices";
import { knownTokensForNetwork } from "@bramble/portfolio/token-registry";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { accountDeployment, isCompatibleAccountDeployed } from "@bramble/starknet/deployment";
import type { StarkHashSigner } from "@bramble/starknet/provider";
import { withRpcFallback } from "@bramble/starknet/provider";
import { type FeeEstimate, formatTokenAmount } from "@bramble/starknet/rpc";
import { clampActivitySummary, systemClock } from "@bramble/transactions/activity";
import type { FeeAffordability } from "@bramble/transactions/fee-funds";
import type { GaslessAccountClass } from "@bramble/transactions/gasless-account";
import {
  type GaslessRoute,
  gaslessRoute,
  gaslessRouteReady,
} from "@bramble/transactions/gasless-config";
import type { GaslessFeeOffer } from "@bramble/transactions/gasless-request";
import {
  quoteGaslessOffers,
  submitReviewedGaslessInvoke,
} from "@bramble/transactions/gasless-submit";
import type { PaymasterHttp } from "@bramble/transactions/paymaster-http";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import {
  canonicalFelt,
  STARKNET_NETWORKS,
  STRK_TOKEN_ADDRESS,
  type StarknetNetworkId,
  sameFelt,
} from "@bramble/wallet-model/networks";
import type { Call, RpcProvider } from "starknet";
import { createStrk20FeeReference } from "../privacy/strk20-fee-reference";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import { networkRpcUrls } from "../runtime/runtime-state";

/** Production transport. Forwards the request hardening the caller put in `init`. */
const gaslessHttp = (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return untrustedFetch(url, init);
};

type MakeProvider = (nodeUrl: string) => RpcProvider;

const fallback = async <T>(
  rpcUrls: readonly string[],
  run: (provider: RpcProvider) => Promise<T>,
  makeProvider?: MakeProvider,
): Promise<T> =>
  makeProvider === undefined
    ? withRpcFallback(rpcUrls, run)
    : withRpcFallback(rpcUrls, run, makeProvider);

/**
 * Deployment and, for Braavos, the class now at the address.
 *
 * Uses {@link isCompatibleAccountDeployed}: a guardian, a Braavos strong
 * signer, or an unrecognised live class throws, and an unreachable node
 * throws. Callers must not turn that into a deployed account. `liveClassHash`
 * is set only for Braavos, and only when the read succeeds.
 */
export const gaslessAccountState = async (
  account: AccountRef,
  rpcUrls: readonly string[],
  makeProvider?: MakeProvider,
): Promise<{ readonly deployed: boolean; readonly liveClassHash: string | null }> => {
  const deployed = await fallback(
    rpcUrls,
    (provider) => isCompatibleAccountDeployed(provider, account),
    makeProvider,
  );
  if (account.accountContractType !== "braavos" || !deployed) {
    return { deployed, liveClassHash: null };
  }
  try {
    const raw = await fallback(
      rpcUrls,
      (provider) => provider.getClassHashAt(account.address, "latest"),
      makeProvider,
    );
    const liveClassHash = canonicalFelt(String(raw));
    return { deployed, liveClassHash: liveClassHash === "0x0" ? null : liveClassHash };
  } catch {
    return { deployed, liveClassHash: null };
  }
};

const accountForGasless = (
  account: AccountRef,
  state: { readonly deployed: boolean; readonly liveClassHash: string | null },
): GaslessAccountClass & {
  readonly accountContractType: AccountRef["accountContractType"];
  readonly address: string;
} => ({
  accountContractType: account.accountContractType,
  address: account.address,
  classHash: account.classHash,
  deployed: state.deployed,
  ...(account.accountContractType === "braavos" && state.liveClassHash !== null
    ? { liveClassHash: state.liveClassHash }
    : {}),
});

const deploymentFor = (
  account: AccountRef,
  deployed: boolean,
): ReturnType<typeof accountDeployment> | null => {
  if (deployed) {
    return null;
  }
  try {
    return accountDeployment(account);
  } catch {
    return null;
  }
};

const nowSeconds = (): number => Math.floor(systemClock() / 1000);

/**
 * Stand-in for the bundled gasless route. Production leaves this unset, so
 * the wallet flag and the forwarder pin stay in force. `http` and
 * `makeProvider` keep a test off the network, and `nowSeconds` is the clock
 * the execution window is checked against.
 */
export type GaslessReviewTestHooks = {
  readonly http: PaymasterHttp;
  readonly makeProvider: (nodeUrl: string) => RpcProvider;
  readonly nowSeconds: () => number;
  readonly route: (networkId: StarknetNetworkId) => GaslessRoute | null;
};

let testHooks: GaslessReviewTestHooks | null = null;

/**
 * Installs {@link GaslessReviewTestHooks}, or clears them when `hooks` is
 * null. Unset, {@link reviewGaslessOffers} and {@link executeReviewedGasless}
 * use the bundled route and the real transport.
 */
export const setGaslessReviewHooksForTests = (hooks: GaslessReviewTestHooks | null): void => {
  testHooks = hooks;
};

const routeFor = (networkId: StarknetNetworkId): GaslessRoute | null =>
  testHooks === null ? gaslessRoute(networkId) : testHooks.route(networkId);

const httpFor = (): PaymasterHttp => (testHooks === null ? gaslessHttp : testHooks.http);

const nowFor = (): number => (testHooks === null ? nowSeconds() : testHooks.nowSeconds());

const providerFor = (): MakeProvider | undefined =>
  testHooks === null ? undefined : testHooks.makeProvider;

/**
 * Offers for one review. Empty when gasless is off, STRK covers the fee, the
 * account cannot sign SNIP-9 v2, or the route cannot be checked. Failures
 * hide the choice; they do not fail the STRK review.
 */
export const reviewGaslessOffers = async (input: {
  readonly account: AccountRef;
  readonly calls: readonly Call[];
  readonly preferences: WalletPreferences;
  readonly prices: PriceService;
  readonly runtimeRpc: Pick<RuntimeRpc, "getTokenBalances">;
  readonly strkAffordability: FeeAffordability;
  readonly strkFee: FeeEstimate | null;
}): Promise<readonly GaslessFeeOffer[]> => {
  const route = routeFor(input.account.networkId);
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
  const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[input.account.networkId], input.preferences);
  let state: Awaited<ReturnType<typeof gaslessAccountState>>;
  try {
    state = await gaslessAccountState(input.account, rpcUrls, providerFor());
  } catch {
    return [];
  }
  const balances = await input.runtimeRpc
    .getTokenBalances({
      accountAddress: input.account.address,
      rpcUrls,
      tokens: [...known],
    })
    .catch(() => []);
  const reference = createStrk20FeeReference(input.prices);
  return quoteGaslessOffers({
    account: accountForGasless(input.account, state),
    calls: input.calls,
    deployment: deploymentFor(input.account, state.deployed),
    http: httpFor(),
    nowSeconds: nowFor(),
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
 * Submits a fee the user already chose. Throws the paymaster refusal, a
 * compatibility refusal, or a lost-reply error. It does not fall back to STRK,
 * because that would sign a different fee from the one on the control.
 */
export const executeReviewedGasless = async (input: {
  readonly account: AccountRef;
  readonly calls: readonly Call[];
  readonly beforeExecute?: (signed: {
    readonly messageHash: string;
    readonly typedData: unknown;
    readonly userFee: {
      readonly amount: string;
      readonly token: string;
      readonly tokenAddress: string;
    };
  }) => Promise<void>;
  readonly gaslessFee: GaslessFeeOffer;
  readonly isAuthorized: () => boolean;
  readonly preferences: WalletPreferences;
  readonly prices: PriceService;
  readonly signHash: StarkHashSigner;
  readonly strkFee: FeeEstimate | null;
}): Promise<Awaited<ReturnType<typeof submitReviewedGaslessInvoke>>> => {
  const route = routeFor(input.account.networkId);
  const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[input.account.networkId], input.preferences);
  const state = gaslessRouteReady(route)
    ? await gaslessAccountState(input.account, rpcUrls, providerFor())
    : { deployed: false, liveClassHash: null };
  const strkFee =
    input.strkFee !== null && input.strkFee.unit === "FRI" ? BigInt(input.strkFee.overallFee) : 0n;
  const reference = createStrk20FeeReference(input.prices);
  return submitReviewedGaslessInvoke({
    account: accountForGasless(input.account, state),
    calls: input.calls,
    deployment: deploymentFor(input.account, state.deployed),
    ...(input.beforeExecute ? { beforeExecute: input.beforeExecute } : {}),
    http: httpFor(),
    isAuthorized: input.isAuthorized,
    nowSeconds: nowFor(),
    readNowSeconds: nowFor,
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

/**
 * Activity summary for a send whose network fee was a signed token amount.
 * The amount is the one in the signed transfer. Summaries stay specific so
 * two different fees do not read as the same send.
 */
export const gaslessFeeSummary = (
  base: string,
  fee: { readonly amount: string; readonly decimals: number; readonly token: string },
): string => {
  let shown = fee.token;
  try {
    shown = `${formatTokenAmount(BigInt(fee.amount), fee.decimals)} ${fee.token}`;
  } catch {
    shown = fee.token;
  }
  return clampActivitySummary(`${base} (network fee ${shown})`);
};
