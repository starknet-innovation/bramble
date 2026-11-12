/**
 * Staking actions (issue 750), prepared then executed, like the in-wallet
 * swap.
 *
 * Prepare: the staker address is the user's pick (from the directory or
 * pasted) and is only a candidate; the token comes from the account's TRACKED
 * registry and the staking contract's active-token list; and the pool is
 * resolved and verified on chain at one pinned block. A staker the staking
 * contract does not list a pool for is refused before anything is built. No
 * directory data reaches this file: the review names the full staker address. The calls
 * are built from those facts alone (a stake approves exactly what it stakes),
 * checked by the shared verifier, priced, and frozen in a one-time
 * preparation together with the review sentence the user will confirm.
 *
 * Execute: the preparation is claimed once and must still match the active
 * account, network and chain by digest; it is re-verified against the live
 * trusted set and signed with the frozen fee through the session-gated signer.
 * A lost reply is "status unknown" with the signed hash, filed in Activity.
 */
import type { TokenConfig } from "@bramble/settings/preferences";
import { IndeterminateRpcWriteError } from "@bramble/starknet/provider";
import { parseTokenAmount } from "@bramble/starknet/rpc";
import { activityToken } from "@bramble/transactions/activity";
import { reviewEnglish, withReviewText } from "@bramble/transactions/review-messages";
import { buildStakingCalls, stakingActivitySummary } from "@bramble/transactions/staking-calls";
import { stakingReviewText, stakingValidatorText } from "@bramble/transactions/staking-review";
import { refuseOnPoisonedRecipient, verifyCalls } from "@bramble/transactions/verify";
import { shortAddress } from "@bramble/transactions/verify-decode";
import { STARKNET_NETWORKS, STRK_TOKEN_ADDRESS, sameFelt } from "@bramble/wallet-model/networks";
import { submissionUnknownResponse } from "@bramble/wallet-protocol/submission-unknown";
import { recordAutoDeployment } from "../accounts/deployment-ops";
import { signerForContext, verificationContext } from "../accounts/wallet-ops";
import {
  approvalPayloadMatchesContext,
  createApprovalContext,
} from "../approvals/approval-context";
import { allowanceOwner, recordApproveAllowances } from "../portfolio/allowance-recording";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { captureSessionAuthorization } from "../runtime/session";
import { afterBroadcast, recordSubmittedActivity } from "../transactions/activity-recording";
import {
  nowSeconds,
  STAKING_UNREADABLE,
  type StakingContext,
  type StakingOpsDeps,
  stakingContext,
} from "./staking-context";
import type { StakingPrepareInput } from "./staking-inputs";
import { type StakingPreparation, stakingPreparationPayload } from "./staking-preparations";
import { readStakingChainFacts, readStakingPool } from "./staking-reads";

const baseUnits = (amount: string | null, decimals: number): bigint | null => {
  if (amount === null) return null;
  try {
    return parseTokenAmount(amount, decimals);
  } catch {
    return null;
  }
};

const readActionPool = (context: StakingContext, token: TokenConfig, staker: string) =>
  context
    .read(context.rpcUrls, async (pinned) => {
      const facts = await readStakingChainFacts(pinned, context.network.stakingContract);
      if (!facts?.activeTokens.some((active) => sameFelt(active, token.address))) {
        return { refusal: "This token can't be staked.", staker, token: token.address };
      }
      return readStakingPool(pinned, {
        account: context.account.address,
        staker,
        stakingContract: context.network.stakingContract,
        token: token.address,
      });
    })
    .catch(() => null);

const assetsFor = (context: StakingContext, pool: string) => ({
  ...verificationContext(context.account, context.preferences),
  knownContracts: [pool],
});

// The review as English plus, when the panel would accept it, its reference.
const stakingReview = (input: Parameters<typeof stakingReviewText>[0]) => {
  const text = stakingReviewText(input);
  const reference = withReviewText(text).text;
  return { review: reviewEnglish(text), ...(reference ? { reviewText: reference } : {}) };
};

/**
 * `wallet.stakingPrepare`: builds, verifies and prices one action, and freezes
 * it for a single confirm.
 */
export const prepareStakingResponse = async (
  deps: StakingOpsDeps,
  input: StakingPrepareInput,
): Promise<RuntimeResponse> => {
  const context = await stakingContext(deps);
  if ("error" in context) return { error: context.error };
  const now = nowSeconds(deps);
  const token = context.preferences.tokens.find(
    (entry) => entry.id === input.tokenId && entry.networkId === context.networkId,
  );
  if (now === null || !token) return { error: "Staking option unavailable." };
  const reading = await readActionPool(context, token, input.staker);
  if (!reading) return STAKING_UNREADABLE;
  if ("refusal" in reading) return { error: reading.refusal };
  const built = buildStakingCalls({
    account: context.account.address,
    action: input.action,
    amount: baseUnits(input.amount, token.decimals),
    member: reading.member,
    nowSeconds: now,
    pool: reading.pool,
    token: token.address,
  });
  if ("refusal" in built) return { error: built.refusal };
  const calls = built.map((call) => ({ ...call, calldata: [...(call.calldata as string[])] }));
  const refusal = refuseOnPoisonedRecipient(
    verifyCalls(calls, assetsFor(context, reading.pool.pool)),
  );
  if (refusal) return refusal;
  const reviewedFee = await deps.runtimeRpc
    .estimateInvokeFee({
      account: context.account,
      calls,
      rpcUrls: context.rpcUrls,
      signHash: signerForContext(deps, context),
    })
    .catch(() => null);
  if (!reviewedFee) {
    return { error: "Couldn't estimate the network fee, so nothing was signed. Try again." };
  }
  // The review names the full verified staker address; Activity the short
  // form. Neither is ever a directory name.
  const facts = {
    amount: input.amount,
    symbol: token.symbol,
    validator: `validator ${input.staker}`,
  };
  const unsigned = {
    action: input.action,
    amount: input.amount,
    calls,
    pool: reading.pool.pool,
    ...stakingReview({
      ...facts,
      account: context.account.address,
      action: input.action,
      member: reading.member,
      validator: stakingValidatorText(input.staker),
    }),
    reviewedFee,
    summary: stakingActivitySummary({
      ...facts,
      action: input.action,
      validator: `validator ${shortAddress(input.staker)}`,
    }),
    // A claim pays STRK whatever the staked token.
    symbol: input.action === "claim" ? "STRK" : token.symbol,
    tokenAddress: input.action === "claim" ? STRK_TOKEN_ADDRESS : token.address,
  };
  const approvalContext = await createApprovalContext(
    context.account,
    stakingPreparationPayload(unsigned),
  );
  const stakingPreparation = deps.stakingPreparations.put({
    ...unsigned,
    context: approvalContext,
    id: approvalContext.payloadDigest,
  });
  return { ok: true, stakingPreparation };
};

const stillMatches = async (context: StakingContext, preparation: StakingPreparation) =>
  context.account.id === preparation.context.accountId &&
  context.networkId === preparation.context.networkId &&
  STARKNET_NETWORKS[context.networkId].chainId === preparation.context.chainId &&
  (await approvalPayloadMatchesContext(
    preparation.context,
    stakingPreparationPayload(preparation),
  ));

// Files the stake's exact-amount approval before the Activity line, as on
// every other path that grants an allowance, for any hash that may be on chain.
const recordStakingSubmission = async (
  deps: StakingOpsDeps,
  facts: {
    readonly account: StakingContext["account"];
    readonly assets: ReturnType<typeof assetsFor>;
    readonly networkId: StakingContext["networkId"];
    readonly preparation: StakingPreparation;
  },
  hash: string,
): Promise<void> => {
  const { account, assets, networkId, preparation } = facts;
  await recordApproveAllowances({
    assets,
    calls: preparation.calls,
    owner: allowanceOwner(account),
    store: deps.allowanceStore,
    transactionHash: hash,
  });
  await recordSubmittedActivity(deps.activity, {
    accountId: account.id,
    ...(preparation.amount === null ? {} : { amount: preparation.amount }),
    hash,
    kind: "invoke",
    networkId,
    summary: preparation.summary,
    ...activityToken({ address: preparation.tokenAddress, symbol: preparation.symbol }),
  });
};

// Signs the frozen calls with the frozen fee. A lost reply is "status unknown"
// with the signed hash, and that hash is filed like a confirmed one.
const submitPreparation = async (
  deps: StakingOpsDeps,
  context: StakingContext,
  preparation: StakingPreparation,
  assets: ReturnType<typeof assetsFor>,
  isAuthorized: () => boolean,
): Promise<RuntimeResponse> => {
  const { account } = context;
  const facts = { account, assets, networkId: context.networkId, preparation };
  const recordSubmitted = (hash: string) => recordStakingSubmission(deps, facts, hash);
  let signedHash: string | undefined;
  try {
    const result = await deps.runtimeRpc.submitInvokeTransaction({
      account,
      calls: preparation.calls,
      isAuthorized,
      onSigned: async (signed) => {
        signedHash = signed.transactionHash;
      },
      reviewedFee: preparation.reviewedFee,
      rpcUrls: context.rpcUrls,
      signHash: signerForContext(deps, context),
    });
    await afterBroadcast(() =>
      recordAutoDeployment(deps.activity, account, result.deploymentTransactionHash),
    );
    await afterBroadcast(() => recordSubmitted(result.transactionHash));
    return { ok: true, transactionHash: result.transactionHash };
  } catch (error) {
    await afterBroadcast(() => recordAutoDeployment(deps.activity, account, error));
    if (!(error instanceof IndeterminateRpcWriteError)) {
      return { error: error instanceof Error && error.message ? error.message : "Staking failed" };
    }
    const pending = signedHash;
    if (pending !== undefined) await afterBroadcast(() => recordSubmitted(pending));
    return submissionUnknownResponse(error.message, pending);
  }
};

/**
 * `wallet.stakingExecute`: claims a preparation once and submits exactly it.
 */
export const executeStakingResponse = async (
  deps: StakingOpsDeps,
  preparationId: string,
): Promise<RuntimeResponse> => {
  const preparation = deps.stakingPreparations.claim(preparationId);
  if (!preparation) return { error: "Review this staking action again." };
  const authorized = captureSessionAuthorization(deps.session);
  const context = await stakingContext(deps);
  if ("error" in context) return { error: context.error };
  if (!(await stillMatches(context, preparation))) {
    return { error: "Review this staking action again." };
  }
  const assets = assetsFor(context, preparation.pool);
  // Re-checked against the live trusted set immediately before signing, as
  // on every other wallet-initiated lane.
  const refusal = refuseOnPoisonedRecipient(verifyCalls(preparation.calls, assets));
  if (refusal) return refusal;
  return submitPreparation(deps, context, preparation, assets, authorized.isCurrent);
};
