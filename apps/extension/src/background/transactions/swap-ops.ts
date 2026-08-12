/**
 * In-wallet swap operations over the AVNU aggregator, dispatched from the
 * background message handler. Both messages are privileged (extension pages
 * only, deny-by-default in ../routing/senders.ts) and follow the wallet's
 * execution contract: token addresses come from the user's TRACKED registry
 * (never from the UI message), AVNU responses are validated at the
 * @mc-wallet/transactions/avnu boundary, the COMPLETE built call set passes the
 * intent policy gate in ../privacy/swap-build-policy.ts — against the router
 * address and swap selector the WALLET pins per network and the route calldata
 * DECODED against the pinned exchange ABI (@mc-wallet/transactions/avnu-route),
 * not against anything the response asserts — plus the shared call verifier,
 * and signing happens only through the session-gated Krusty signer. Failure
 * behaviour: any validation, quote, build, or policy failure returns an error
 * response — nothing is signed on a path that could not be fully checked.
 */

import type { TokenConfig } from "@mc-wallet/settings/preferences";
import { formatTokenAmount, parseTokenAmount } from "@mc-wallet/starknet/rpc";
import { avnuRouterAddress, type SwapService } from "@mc-wallet/transactions/avnu";
import { reviewedMinBuyAmount } from "@mc-wallet/transactions/avnu-route";
import {
  refuseOnPoisonedRecipient,
  verificationContext,
  verifyCalls,
} from "@mc-wallet/transactions/verify";
import { canonical, shortAddress } from "@mc-wallet/transactions/verify-decode";
import { isApproveEntrypoint } from "@mc-wallet/transactions/verify-selectors";
import { STARKNET_NETWORKS, sameFelt } from "@mc-wallet/wallet-model/networks";
import { signerForContext, type WalletOpsDeps } from "../accounts/wallet-ops";
import {
  approvalPayloadMatchesContext,
  createApprovalContext,
} from "../approvals/approval-context";
import { allowanceOwner, recordApproveAllowances } from "../portfolio/allowance-recording";
import { readTypeOnlyInput } from "../routing/message-inputs";
import { activeAccountContext, networkRpcUrls } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { buildPolicy } from "./swap-build-policy";
import { readSwapExecuteInput, readSwapPrepareInput, readSwapQuoteInput } from "./swap-inputs";
import { type SwapPreparationStore, swapPreparationPayload } from "./swap-preparations";

/**
 * Dependencies for the swap handler: the shared wallet-ops set plus the AVNU
 * swap service (injected fetch; unavailable default fails closed).
 */
export type SwapOpsDeps = WalletOpsDeps & {
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
  const preferences = await deps.preferencesStore.read();
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
  const { account, buyToken, networkId, sellToken } = context;
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
    return {
      ok: true,
      swapQuote: {
        buyAmount: formatTokenAmount(BigInt(quote.buyAmount), buyToken.decimals),
        buyAmountInUsd: quote.buyAmountInUsd,
        gasFeesInUsd: quote.gasFeesInUsd,
        quoteId: quote.quoteId,
        sellAmount: input.amount,
        sellAmountInUsd: quote.sellAmountInUsd,
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
      sellSymbol: sellToken.symbol,
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
  const preferences = await deps.preferencesStore.read();
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
    const result = await deps.runtimeRpc.submitInvokeTransaction({
      account: context.account,
      calls: preparation.calls,
      rpcUrls: networkRpcUrls(STARKNET_NETWORKS[context.networkId], preferences),
      signHash: signerForContext(deps, context),
    });
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
    });
    await deps.activity.record({
      accountId: context.account.id,
      amount: preparation.amount,
      hash: result.transactionHash,
      kind: "invoke",
      networkId: context.networkId,
      summary: `Swap ${preparation.amount} ${preparation.sellSymbol} for ~${preparation.buyAmount} ${preparation.buySymbol} via AVNU`,
      token: preparation.sellSymbol,
    });
    return { ok: true, transactionHash: result.transactionHash };
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
