/**
 * In-wallet swap operations over the avnu aggregator, dispatched from the
 * background message handler. Both messages are privileged (extension pages
 * only, deny-by-default in ../routing/senders.ts) and follow the wallet's
 * execution contract: token addresses come from the user's TRACKED registry
 * (never from the UI message), avnu responses are validated at the
 * @bramble/transactions/avnu boundary, the COMPLETE built call set passes the
 * intent policy gate in ../privacy/swap-build-policy.ts — against the router
 * address and swap selector the WALLET pins per network and the route calldata
 * DECODED against the pinned exchange ABI (@bramble/transactions/avnu-route),
 * not against anything the response asserts — plus the shared call verifier,
 * and signing happens only through the session-gated Krusty signer. Failure
 * behaviour: any validation, quote, build, or policy failure returns an error
 * response — nothing is signed on a path that could not be fully checked.
 */

import type { PriceService } from "@bramble/portfolio/prices";
import type { TokenConfig } from "@bramble/settings/preferences";
import { IndeterminateRpcWriteError } from "@bramble/starknet/provider";
import { formatTokenAmount, parseTokenAmount } from "@bramble/starknet/rpc";
import { activityToken } from "@bramble/transactions/activity";
import { avnuRouterAddress, type SwapService } from "@bramble/transactions/avnu";
import { reviewedMinBuyAmount } from "@bramble/transactions/avnu-route";
import {
  refuseOnPoisonedRecipient,
  verificationContext,
  verifyCalls,
} from "@bramble/transactions/verify";
import { canonical, shortAddress } from "@bramble/transactions/verify-decode";
import { isApproveEntrypoint } from "@bramble/transactions/verify-selectors";
import { STARKNET_NETWORKS, sameFelt } from "@bramble/wallet-model/networks";
import { submissionUnknownResponse } from "@bramble/wallet-protocol/submission-unknown";
import { recordAutoDeployment } from "../accounts/deployment-ops";
import { signerForContext, type WalletOpsDeps } from "../accounts/wallet-ops";
import {
  approvalPayloadMatchesContext,
  createApprovalContext,
} from "../approvals/approval-context";
import { allowanceOwner, recordApproveAllowances } from "../portfolio/allowance-recording";
import { readTypeOnlyInput } from "../routing/message-inputs";
import { activeAccountContext, networkRpcUrls } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { captureSessionAuthorization } from "../runtime/session";
import { afterBroadcast, recordSubmittedActivity } from "./activity-recording";
import { buildPolicy } from "./swap-build-policy";
import { readSwapExecuteInput, readSwapPrepareInput, readSwapQuoteInput } from "./swap-inputs";
import { type SwapPreparationStore, swapPreparationPayload } from "./swap-preparations";
import { walletSwapValueDelta } from "./swap-value-check";
import { withTrustedRecipients } from "./trusted-recipients";

/**
 * Dependencies for the swap handler: the shared wallet-ops set plus the avnu
 * swap service (injected fetch; unavailable default fails closed).
 */
export type SwapOpsDeps = WalletOpsDeps & {
  // The wallet's own price feed, for the quote's value check (Sherlock 137).
  readonly prices?: PriceService;
  readonly swap: SwapService;
  readonly swapPreparations: SwapPreparationStore;
};

const errorText = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message.length > 0 ? error.message : fallback;

const swapPair = async (
  deps: SwapOpsDeps,
  input: { readonly buyTokenId: string; readonly sellTokenId: string },
) => {
  const context = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) {
    return { error: context.error } as const;
  }
  const preferences = await withTrustedRecipients(
    deps,
    await deps.preferencesStore.read(),
    context.accounts,
  );
  const tokenById = (id: string): TokenConfig | undefined =>
    preferences.tokens.find((token) => token.id === id && token.networkId === context.networkId);
  const sellToken = tokenById(input.sellTokenId);
  const buyToken = tokenById(input.buyTokenId);
  if (!sellToken || !buyToken) {
    return { error: "token unavailable on this network" } as const;
  }
  if (sameFelt(sellToken.address, buyToken.address)) {
    return { error: "pick two different tokens" } as const;
  }
  return { ...context, buyToken, preferences, sellToken } as const;
};

// One guarded parse for both sides of the swap: an amount with more decimal
// places than its token has, or a non-positive one, is a rejection the caller
// turns into a message — never a throw out of the handler.
const baseUnits = (amount: string, decimals: number): bigint | null => {
  try {
    const raw = parseTokenAmount(amount, decimals);
    return raw > 0n ? raw : null;
  } catch {
    return null;
  }
};

const sellAmountHex = (amount: string, decimals: number): string | null => {
  const raw = baseUnits(amount, decimals);
  return raw === null ? null : `0x${raw.toString(16)}`;
};

const swapTokensResponse = async (deps: SwapOpsDeps): Promise<RuntimeResponse> => {
  const preferences = await deps.preferencesStore.read();
  try {
    return { ok: true, swapTokens: await deps.swap.listTokens(preferences.activeNetworkId) };
  } catch (error) {
    return { error: errorText(error, "token list unavailable") };
  }
};

const swapQuoteResponse = async (
  deps: SwapOpsDeps,
  input: NonNullable<ReturnType<typeof readSwapQuoteInput>>,
): Promise<RuntimeResponse> => {
  const context = await swapPair(deps, input);
  if ("error" in context) {
    return { error: context.error };
  }
  const { account, buyToken, networkId, preferences, sellToken } = context;
  const sellAmount = sellAmountHex(input.amount, sellToken.decimals);
  if (!sellAmount) {
    return { error: "enter an amount to swap" };
  }
  try {
    const quote = await deps.swap.getQuote({
      buyTokenAddress: buyToken.address,
      networkId,
      sellAmount,
      sellTokenAddress: sellToken.address,
      takerAddress: account.address,
    });
    const buyAmount = formatTokenAmount(BigInt(quote.buyAmount), buyToken.decimals);
    const valueDeltaPercent = await walletSwapValueDelta({
      buyAmount,
      buyToken,
      currency: preferences.displayCurrency ?? "usd",
      networkId,
      prices: deps.prices,
      sellAmount: input.amount,
      sellToken,
    });
    return {
      ok: true,
      swapQuote: {
        buyAmount,
        buyAmountInUsd: quote.buyAmountInUsd,
        gasFeesInUsd: quote.gasFeesInUsd,
        quoteId: quote.quoteId,
        sellAmount: input.amount,
        sellAmountInUsd: quote.sellAmountInUsd,
        ...(valueDeltaPercent === undefined ? {} : { valueDeltaPercent }),
      },
    };
  } catch (error) {
    return { error: errorText(error, "swap quote failed") };
  }
};

const swapPrepareResponse = async (
  deps: SwapOpsDeps,
  input: NonNullable<ReturnType<typeof readSwapPrepareInput>>,
): Promise<RuntimeResponse> => {
  const context = await swapPair(deps, input);
  if ("error" in context) {
    return { error: context.error };
  }
  const { account, buyToken, networkId, preferences, sellToken } = context;
  const sellAmount = sellAmountHex(input.amount, sellToken.decimals);
  if (!sellAmount) {
    return { error: "enter an amount to swap" };
  }
  // The floor the signed route must promise. Derived from the buy amount the
  // user is REVIEWING — the same figure the confirm card and the activity line
  // state — and the slippage the wallet is about to ask the aggregator to build
  // to, in integer base units. Deriving it here rather than in the panel is the
  // point: the panel then displays a minimum the gate below actually enforces
  // instead of a number computed beside the transaction.
  const quotedBuyAmount = baseUnits(input.buyAmount, buyToken.decimals);
  const minBuyAmount =
    quotedBuyAmount === null ? null : reviewedMinBuyAmount(quotedBuyAmount, input.slippage);
  if (minBuyAmount === null) {
    return { error: "swap quote is not reviewable — request a fresh price" };
  }
  try {
    const built = await deps.swap.buildCalls({
      networkId,
      quoteId: input.quoteId,
      slippage: input.slippage,
      takerAddress: account.address,
    });
    const calls = built.calls.map((call) => ({
      calldata: [...call.calldata],
      contractAddress: call.contractAddress,
      entrypoint: call.entrypoint,
    }));
    const routerAddress = avnuRouterAddress(networkId);
    // Decoded first: the policy reads the verifier's per-call kind so it judges
    // the same decode the reviewer will read, and the report is discarded with
    // the build when the policy rejects it.
    const report = verifyCalls(calls, {
      ...verificationContext(account, preferences),
      knownContracts: [routerAddress],
    });
    const policy = buildPolicy(calls, report.calls, {
      // Every side of every equality below is wallet-side: the pair comes from
      // the TRACKED registry, the beneficiary from the unlocked account, the
      // floor from the reviewed quote, and the counterparty from the ACTIVE
      // network's pin. None of them is anything the response can influence.
      buyTokenAddress: buyToken.address,
      minBuyAmount,
      routerAddress,
      sellAmount,
      sellTokenAddress: sellToken.address,
      takerAddress: account.address,
    });
    if (policy.error !== undefined) {
      return { error: policy.error };
    }
    const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[networkId], preferences);
    const signHash = signerForContext(deps, context);
    const reviewedFee = await deps.runtimeRpc
      .estimateInvokeFee({ account, calls, rpcUrls, signHash })
      .catch(() => null);
    if (!reviewedFee) {
      return {
        error:
          "Couldn't estimate the network fee for this swap, so nothing was prepared. The quote may have moved, or the account may not hold enough to cover the swap and its fee. Try again, or reduce the amount.",
      };
    }
    const minBuyText = formatTokenAmount(policy.route.minBuyAmount, buyToken.decimals);
    // The route's own summary is WALLET-AUTHORED from the decoded calldata, not
    // the verifier's generic "Call multi_route_swap on 0x…". That generic line
    // reads identically for an honest build and one that moved the beneficiary
    // or dropped the minimum, which is exactly how such a build passed review;
    // this line states the two facts the gate above just bound.
    const routeIndex = calls.findIndex((call) => !isApproveEntrypoint(call.entrypoint));
    const unsigned = {
      amount: input.amount,
      buyAmount: input.buyAmount,
      buySymbol: buyToken.symbol,
      calls,
      flags: report.flags.map((flag) => ({ code: flag.code, message: flag.message })),
      minBuyAmount: minBuyText,
      reviewedFee,
      sellSymbol: sellToken.symbol,
      sellTokenAddress: sellToken.address,
      summaries: report.calls.map((call, index) =>
        index === routeIndex
          ? `Swap ${input.amount} ${sellToken.symbol} for at least ${minBuyText} ${buyToken.symbol}, paid to ${shortAddress(canonical(account.address))}`
          : call.summary,
      ),
    };
    const approvalContext = await createApprovalContext(account, swapPreparationPayload(unsigned));
    const swapPreparation = deps.swapPreparations.put({
      ...unsigned,
      context: approvalContext,
      id: approvalContext.payloadDigest,
    });
    return { ok: true, swapPreparation };
  } catch (error) {
    return { error: errorText(error, "swap preparation failed") };
  }
};

const swapExecuteResponse = async (
  deps: SwapOpsDeps,
  input: NonNullable<ReturnType<typeof readSwapExecuteInput>>,
): Promise<RuntimeResponse> => {
  const preparation = deps.swapPreparations.claim(input.preparationId);
  if (!preparation) {
    return { error: "swap preparation not found" };
  }
  const context = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) {
    return { error: context.error };
  }
  const authorized = captureSessionAuthorization(deps.session);
  const preferences = await withTrustedRecipients(
    deps,
    await deps.preferencesStore.read(),
    context.accounts,
  );
  if (
    context.account.id !== preparation.context.accountId ||
    context.networkId !== preparation.context.networkId ||
    preferences.activeNetworkId !== preparation.context.networkId ||
    STARKNET_NETWORKS[context.networkId].chainId !== preparation.context.chainId ||
    !(await approvalPayloadMatchesContext(preparation.context, swapPreparationPayload(preparation)))
  ) {
    return { error: "swap preparation changed" };
  }
  try {
    const assets = verificationContext(context.account, preferences);
    const reviewedAssets = {
      ...assets,
      knownContracts: [avnuRouterAddress(context.networkId)],
    };
    // Re-verified against the account's live trusted set immediately before the
    // batch goes out, and refused — not annotated — when the reviewed route pays
    // a recipient that mimics a saved address. Same shared policy, same wording,
    // as the ERC20 send, the NFT send, the dapp invoke, and the pool routes.
    // A second gate by design: `buildPolicy` already refuses a build containing
    // any decoded transfer, and pins the route's own beneficiary to this
    // account, so today nothing reaches here with a recipient the verifier can
    // read. That is exactly why it belongs — if either rule is ever widened,
    // the recipient rule must not be the thing that quietly went missing.
    const refusal = refuseOnPoisonedRecipient(verifyCalls(preparation.calls, reviewedAssets));
    if (refusal) {
      return refusal;
    }
    // The router approval and the activity line are filed for every hash that
    // may be on chain: the confirmed one, or the signed one when the reply was
    // lost (audit #173 — a live grant must not go missing from the allowance
    // manager, and the swap must stay traceable in Activity).
    const recordSubmitted = async (hash: string): Promise<void> => {
      // The build always carries an approval of the sell token to the router
      // (buildPolicy refuses one without it). The route is expected to spend it
      // in the same transaction, but the wallet cannot prove it did — a residual
      // allowance must be listed and revokable like any other, so it is tracked
      // here on exactly the terms the dapp-invoke path tracks a dapp's approval.
      // Filed BEFORE the activity line: an activity write that fails (a storage
      // quota, an IO fault) must not be able to lose the record of a grant that
      // is already on chain.
      await recordApproveAllowances({
        assets,
        calls: preparation.calls,
        owner: allowanceOwner(context.account),
        store: deps.allowanceStore,
        transactionHash: hash,
      });
      await recordSubmittedActivity(deps.activity, {
        accountId: context.account.id,
        amount: preparation.amount,
        hash,
        kind: "invoke",
        networkId: context.networkId,
        summary: `Swap ${preparation.amount} ${preparation.sellSymbol} for ~${preparation.buyAmount} ${preparation.buySymbol} via avnu`,
        ...activityToken({ address: preparation.sellTokenAddress, symbol: preparation.sellSymbol }),
      });
    };
    // The hash of the invoke as signed, captured before it is sent. Only used
    // when the reply is lost.
    let signedHash: string | undefined;
    let transactionHash: string;
    let deploymentHash: string | undefined;
    try {
      const result = await deps.runtimeRpc.submitInvokeTransaction({
        account: context.account,
        calls: preparation.calls,
        isAuthorized: authorized.isCurrent,
        onSigned: async (signed) => {
          signedHash = signed.transactionHash;
        },
        reviewedFee: preparation.reviewedFee,
        rpcUrls: networkRpcUrls(STARKNET_NETWORKS[context.networkId], preferences),
        signHash: signerForContext(deps, context),
      });
      ({ deploymentTransactionHash: deploymentHash, transactionHash } = result);
    } catch (error) {
      // An accepted automatic deployment is recorded whatever happened next (mc-wallet 719).
      await afterBroadcast(() => recordAutoDeployment(deps.activity, context.account, error));
      if (!(error instanceof IndeterminateRpcWriteError)) {
        throw error;
      }
      // The swap may already be on chain: record it as pending and tell the
      // panel the outcome is unknown, so it never re-quotes into a blind second
      // swap of the same amount.
      const pending = signedHash;
      if (pending !== undefined) {
        await afterBroadcast(() => recordSubmitted(pending));
      }
      return submissionUnknownResponse(error.message, signedHash);
    }
    // Outside the catch below: once a hash exists the reply carries it, so the
    // panel never re-quotes a swap that is already on chain (audit 173).
    await afterBroadcast(() =>
      recordAutoDeployment(deps.activity, context.account, deploymentHash),
    );
    await afterBroadcast(() => recordSubmitted(transactionHash));
    return { ok: true, transactionHash };
  } catch (error) {
    return { error: errorText(error, "swap failed") };
  }
};

/**
 * Handles swap messages; returns null for other message types.
 */
export const handleSwapOps = async (
  deps: SwapOpsDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  if (messageType === "wallet.swapTokens") {
    return readTypeOnlyInput(message, "wallet.swapTokens")
      ? swapTokensResponse(deps)
      : { error: "invalid swap tokens request" };
  }
  if (messageType === "wallet.swapQuote") {
    const input = readSwapQuoteInput(message);
    return input ? swapQuoteResponse(deps, input) : { error: "invalid swap quote request" };
  }
  if (messageType === "wallet.swapExecute") {
    const input = readSwapExecuteInput(message);
    return input ? swapExecuteResponse(deps, input) : { error: "invalid swap request" };
  }
  if (messageType === "wallet.swapPrepare") {
    const input = readSwapPrepareInput(message);
    return input ? swapPrepareResponse(deps, input) : { error: "invalid swap preparation request" };
  }
  return null;
};
