/**
 * In-wallet swap operations over the AVNU aggregator, dispatched from the
 * background message handler. Both messages are privileged (extension pages
 * only, deny-by-default in ./senders.ts) and follow the wallet's execution
 * contract: token addresses come from the user's TRACKED registry (never from
 * the UI message), AVNU responses are validated at the ../starknet/avnu.ts
 * boundary, the COMPLETE built call set passes the intent policy check here
 * (see buildPolicy) — against the router address and swap selectors the WALLET
 * pins per network, not against anything the response asserts — plus the shared
 * call verifier, and signing happens only through the session-gated Krusty
 * signer. Failure behaviour: any validation, quote, build, or policy failure
 * returns an error response — nothing is signed on a path that could not be
 * fully checked.
 */

import {
  avnuRouterAddress,
  isAvnuSwapEntrypoint,
  MAX_SWAP_CALLS,
  type SwapService,
} from "../starknet/avnu";
import { STARKNET_NETWORKS, sameFelt, uint256Felts } from "../starknet/networks";
import { formatTokenAmount, parseTokenAmount } from "../starknet/rpc";
import { type DecodedCall, refuseOnPoisonedRecipient, verifyCalls } from "../starknet/verify";
import { isApproveEntrypoint } from "../starknet/verify-selectors";
import type { TokenConfig } from "../storage/preferences-store";
import { allowanceOwner, recordApproveAllowances } from "./allowance-recording";
import { approvalPayloadMatchesContext, createApprovalContext } from "./approval-context";
import type { ApprovalRiskFlag } from "./approvals";
import { readTypeOnlyInput } from "./message-inputs";
import { activeAccountContext, networkRpcUrls } from "./runtime-state";
import type { RuntimeResponse } from "./runtime-types";
import { readSwapExecuteInput, readSwapPrepareInput, readSwapQuoteInput } from "./swap-inputs";
import { type SwapPreparationStore, swapPreparationPayload } from "./swap-preparations";
import { signerForContext, verificationContext, type WalletOpsDeps } from "./wallet-ops";

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

const sellAmountHex = (amount: string, decimals: number): string | null => {
  try {
    const wei = parseTokenAmount(amount, decimals);
    return wei > 0n ? `0x${wei.toString(16)}` : null;
  } catch {
    return null;
  }
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

// One call exactly as the aggregator returned it, already narrowed to felts and
// an entrypoint identifier by ../starknet/avnu.ts.
type BuiltCall = {
  readonly calldata: readonly string[];
  readonly contractAddress: string;
  readonly entrypoint: string;
};

// The intent the user reviewed and the build must stay inside: this account
// selling exactly this amount of this token, against the counterparty the
// WALLET pinned for the active network (never one the aggregator named).
type SwapIntent = {
  readonly routerAddress: string;
  readonly sellAmount: string;
  readonly sellTokenAddress: string;
};

// Either a rejection (nothing is frozen for review) or the extra risk flags the
// admitted build has to carry into the confirm receipt.
type BuildPolicyResult =
  | { readonly error: string; readonly flags?: never }
  | { readonly error?: never; readonly flags: readonly ApprovalRiskFlag[] };

// Per-approval part of the gate: approvals only ever on the sell token, for the
// exact quoted amount, naming the pinned router as spender. Returns the
// rejection, or null when the call is not an approval or is an acceptable one.
const approvalCallPolicyError = (call: BuiltCall, intent: SwapIntent): string | null => {
  // Which selectors grant spend is defined once, by the call verifier
  // (isApproveEntrypoint): a spelling the reviewer decodes as an approve must be
  // a spelling this policy gate sees as one, or a build could route an approval
  // past the sell-token restriction under a selector only one of them knows.
  if (!isApproveEntrypoint(call.entrypoint)) {
    return null;
  }
  if (!sameFelt(call.contractAddress, intent.sellTokenAddress)) {
    return "swap build touched an unexpected token approval";
  }
  // Through the one shared uint256 join, never a local `<< 128n`: the limb pair
  // this gate compares must be read exactly as the allowance decoder and the
  // reviewer read it, and a missing or malformed limb has to fail closed here
  // rather than read as zero and let a `(0, huge)` spelling of an approval past
  // the quoted-amount check.
  const allowance = uint256Felts(call.calldata[1], call.calldata[2]);
  if (call.calldata.length !== 3 || allowance === null || allowance !== BigInt(intent.sellAmount)) {
    return "swap build requested an unexpected token allowance";
  }
  if (!sameFelt(call.calldata[0] ?? "0x0", intent.routerAddress)) {
    return "swap build approved an unexpected spender";
  }
  return null;
};

// A build that clears the policy but carries steps beyond the ONE swap the user
// reviewed is admitted with this flag rather than silently listed as one more
// summary line the confirm receipt does not explain. Every admitted call is a
// pinned-router swap selector, so this counts calls the review cannot attribute
// to the reviewed intent, not calls the policy failed to classify — an
// unclassifiable call is rejected outright and never reaches a receipt.
const unreviewedCallsFlag = (extraCalls: number): ApprovalRiskFlag => ({
  code: "swap-extra-calls",
  message: `This build runs ${extraCalls} swap ${extraCalls === 1 ? "call" : "calls"} beyond the single swap you reviewed. Confirm only if you expect the extra steps.`,
});

// Positive allowlist for everything that is not the approval: the pinned AVNU
// router, called through one of its swap entry points. A negative rule ("not a
// transfer") is not a description of a swap — it admits set_approval_for_all,
// burn, upgrade, and every other selector, and it is evadable by calldata arity
// alone since the verifier only decodes a transfer it can read amounts from.
const routeCallPolicyError = (call: BuiltCall, intent: SwapIntent): string | null => {
  if (!sameFelt(call.contractAddress, intent.routerAddress)) {
    return "swap build called a contract that is not the AVNU router";
  }
  return isAvnuSwapEntrypoint(call.entrypoint)
    ? null
    : "swap build called an entrypoint that is not an AVNU swap";
};

/**
 * The build-output policy gate. The aggregator's response is UNTRUSTED, and the
 * wallet asked it for one swap of one exact amount, so the COMPLETE returned
 * call set is judged against that intent — constraining only the approvals let
 * a hostile or compromised aggregator inject arbitrary extra calls that the
 * account would then execute. The admitted shape is: exactly one approval, on
 * the sell token, for exactly the quoted amount, naming the network's PINNED
 * AVNU router (../starknet/avnu.ts) as spender; every remaining call runs on
 * that same pinned router through one of its swap entry points; and no call
 * moves tokens directly out of the account (`decoded` carries the verifier's
 * decode, so every transfer spelling it knows is covered here without a second
 * list — kept as defence in depth behind the allowlist, never as the only
 * gate). Both the counterparty and the selector are therefore WALLET-chosen,
 * never inferred from the response. The residual an aggregator keeps is the
 * route's own calldata: which pools it hops, the minimum it accepts, and where
 * the bought tokens land — so a tampered build can still cost the user up to
 * the exact allowance they reviewed, and that bound is the claim this gate
 * makes. It cannot reach any other token, contract, or capability of the
 * account. Anything outside the admitted shape fails closed with a rejection;
 * an admitted build carrying more swap calls than the one reviewed comes back
 * flagged.
 */
const buildPolicy = (
  built: readonly BuiltCall[],
  decoded: readonly DecodedCall[],
  intent: SwapIntent,
): BuildPolicyResult => {
  if (built.length > MAX_SWAP_CALLS) {
    return { error: "swap build returned too many calls" };
  }
  for (const call of built) {
    const error = approvalCallPolicyError(call, intent);
    if (error) {
      return { error };
    }
  }
  const approvals = built.filter((call) => isApproveEntrypoint(call.entrypoint));
  if (approvals.length > 1) {
    return { error: "swap build returned multiple token approvals" };
  }
  // The wallet always asks for the approval (`includeApprove`), and it is what
  // states the exact spend the user is consenting to. A build without one is a
  // build with no reviewable spend boundary.
  if (approvals.length === 0) {
    return { error: "swap build omitted the sell token approval" };
  }
  if (decoded.some((call) => call.kind === "transfer")) {
    return { error: "swap build requested a direct token transfer" };
  }
  const route = built.filter((call) => !isApproveEntrypoint(call.entrypoint));
  if (route.length === 0) {
    return { error: "swap build returned no swap call" };
  }
  for (const call of route) {
    const error = routeCallPolicyError(call, intent);
    if (error) {
      return { error };
    }
  }
  return { flags: route.length > 1 ? [unreviewedCallsFlag(route.length - 1)] : [] };
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
    // Decoded first: the policy reads the verifier's per-call kind so it judges
    // the same decode the reviewer will read, and the report is discarded with
    // the build when the policy rejects it.
    const report = verifyCalls(calls, verificationContext(account, preferences));
    const policy = buildPolicy(calls, report.calls, {
      // Wallet-side pin, resolved from the ACTIVE network rather than from the
      // build: the counterparty is never something the response can influence.
      routerAddress: avnuRouterAddress(networkId),
      sellAmount,
      sellTokenAddress: sellToken.address,
    });
    if (policy.error !== undefined) {
      return { error: policy.error };
    }
    const unsigned = {
      amount: input.amount,
      buyAmount: input.buyAmount,
      buySymbol: buyToken.symbol,
      calls,
      flags: [
        ...report.flags.map((flag) => ({ code: flag.code, message: flag.message })),
        ...policy.flags,
      ],
      sellSymbol: sellToken.symbol,
      summaries: report.calls.map((call) => call.summary),
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
    // Re-verified against the account's live trusted set immediately before the
    // batch goes out, and refused — not annotated — when the reviewed route pays
    // a recipient that mimics a saved address. Same shared policy, same wording,
    // as the ERC20 send, the NFT send, the dapp invoke, and the pool routes.
    // A second gate by design: `buildPolicy` already refuses a build containing
    // any decoded transfer, so today nothing reaches here with a recipient at
    // all. That is exactly why it belongs — if the build policy is ever widened,
    // the recipient rule must not be the thing that quietly went missing.
    const refusal = refuseOnPoisonedRecipient(
      verifyCalls(preparation.calls, verificationContext(context.account, preferences)),
    );
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
    await recordApproveAllowances(
      deps.allowanceStore,
      preparation.calls,
      allowanceOwner(context.account),
    );
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
