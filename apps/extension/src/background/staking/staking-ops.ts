/**
 * Native staking operations dispatched from the background message handler
 * (issue 750). Both messages are privileged (extension pages only) and absent
 * from the dapp allowlist.
 *
 * Execution contract, the same as the in-wallet swap and the allowance revoke:
 * - the staking contract and validator come from the curated network table,
 *   the token from the account's TRACKED registry and the staking contract's
 *   own active-token list, and the pool is resolved and verified on chain at
 *   one pinned block — never taken from the message;
 * - the calls are rebuilt from those facts on every request, so the fee-review
 *   request and the submit request build the same calls from the same inputs;
 * - a stake approves exactly the staked amount in the same multicall;
 * - the first request returns the network fee to review; only a request that
 *   carries that reviewed fee signs, through the session-gated signer;
 * - a lost reply is "status unknown" with the signed hash, never a failure.
 * Failure behaviour: anything unverifiable is an error and nothing is signed.
 */
import type { TokenConfig } from "@bramble/settings/preferences";
import type { FeeEstimate } from "@bramble/starknet/fee-bounds";
import { IndeterminateRpcWriteError } from "@bramble/starknet/provider";
import { formatTokenAmount, parseTokenAmount } from "@bramble/starknet/rpc";
import { activityToken } from "@bramble/transactions/activity";
import {
  buildStakingCalls,
  stakingActivitySummary,
  stakingPositionState,
} from "@bramble/transactions/staking-calls";
import {
  curatedValidator,
  STAKING_NETWORKS,
  type StakingNetworkTable,
  type StakingValidator,
  stakingNetwork,
} from "@bramble/transactions/staking-networks";
import { refuseOnPoisonedRecipient, verifyCalls } from "@bramble/transactions/verify";
import { STARKNET_NETWORKS, sameFelt } from "@bramble/wallet-model/networks";
import { submissionUnknownResponse } from "@bramble/wallet-protocol/submission-unknown";
import type { Call } from "starknet";
import { recordAutoDeployment } from "../accounts/deployment-ops";
import { signerForContext, verificationContext, type WalletOpsDeps } from "../accounts/wallet-ops";
import { allowanceOwner, recordApproveAllowances } from "../portfolio/allowance-recording";
import { readTypeOnlyInput } from "../routing/message-inputs";
import {
  activeAccountContext,
  networkRpcUrls,
  observedAccountContext,
} from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { captureSessionAuthorization } from "../runtime/session";
import { afterBroadcast, recordSubmittedActivity } from "../transactions/activity-recording";
import { requiredFeeReview } from "../transactions/fee-review";
import { withTrustedRecipients } from "../transactions/trusted-recipients";
import { readStakingActionInput, type StakingActionInput } from "./staking-inputs";
import { readStakingChainFacts, readStakingPool, type StakingPoolReading } from "./staking-reads";
import type { StakingRowView } from "./staking-view";

/**
 * Dependencies: the shared wallet-ops set plus the staking network table
 * (injected so tests can switch a network on; production uses the bundled
 * table, which is off everywhere).
 */
export type StakingOpsDeps = WalletOpsDeps & {
  readonly stakingNetworks?: StakingNetworkTable;
};

const UNAVAILABLE = { error: "Staking isn't available on this network." } as const;

const nowSeconds = (deps: StakingOpsDeps): number | null =>
  deps.now ? Math.floor(deps.now() / 1000) : null;

const percent = (basisPoints: number): string =>
  `${(basisPoints / 100).toFixed(2).replace(/\.?0+$/, "")}%`;

// `observe` reads the session without renewing it: the overview is panel-poll
// traffic and must not hold the wallet unlocked. An action is the user's own
// tap, so it takes the renewing read like every other signing lane.
const stakingContext = async (deps: StakingOpsDeps, observe = false) => {
  const context = await (observe ? observedAccountContext : activeAccountContext)(
    deps.wallet,
    deps.session,
    deps.preferencesStore,
  );
  if (context.error !== undefined) return { error: context.error } as const;
  const network = stakingNetwork(context.networkId, deps.stakingNetworks ?? STAKING_NETWORKS);
  const read = deps.runtimeRpc.readAtPinnedBlock;
  if (!network || !read) return UNAVAILABLE;
  const preferences = await withTrustedRecipients(
    deps,
    await deps.preferencesStore.read(),
    context.accounts,
  );
  const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[context.networkId], preferences);
  return { ...context, network, preferences, read, rpcUrls } as const;
};

const rowView = (
  reading: StakingPoolReading,
  symbol: string,
  decimals: number,
  tokenId: string,
  now: number,
): StakingRowView => {
  const base = {
    symbol,
    tokenId,
    validatorId: reading.validator.id,
    validatorName: reading.validator.name,
  };
  if ("refusal" in reading) return { ...base, refusal: reading.refusal };
  const member = reading.member === "none" ? null : reading.member;
  const format = (value: bigint): string => formatTokenAmount(value, decimals);
  return {
    ...base,
    accepting: reading.pool.accepting,
    commission: percent(reading.pool.commission),
    delegated: format(reading.pool.delegated),
    staked: format(member?.amount ?? 0n),
    state: stakingPositionState(reading.member, now),
    unclaimed: format(member?.unclaimedRewards ?? 0n),
    unpoolAmount: format(member?.unpoolAmount ?? 0n),
    ...(member?.unpoolTime == null ? {} : { unpoolTime: member.unpoolTime }),
  };
};

const overviewResponse = async (deps: StakingOpsDeps): Promise<RuntimeResponse> => {
  const context = await stakingContext(deps, true);
  if ("error" in context) return { error: context.error };
  const now = nowSeconds(deps);
  if (now === null) return UNAVAILABLE;
  const { account, network, networkId, preferences, read, rpcUrls } = context;
  try {
    return await read(rpcUrls, async (pinned) => {
      const facts = await readStakingChainFacts(pinned, network.stakingContract);
      if (!facts) return { error: "Couldn't read staking on this network. Try again." };
      const tokens = preferences.tokens.filter(
        (token) =>
          token.networkId === networkId &&
          facts.activeTokens.some((active) => sameFelt(active, token.address)),
      );
      const rows: StakingRowView[] = [];
      for (const validator of network.validators) {
        for (const token of tokens) {
          const reading = await readStakingPool(pinned, {
            account: account.address,
            stakingContract: network.stakingContract,
            token: token.address,
            validator,
          });
          rows.push(rowView(reading, token.symbol, token.decimals, token.id, now));
        }
      }
      return { ok: true, staking: { exitWindowSeconds: facts.exitWindowSeconds, rows } };
    });
  } catch {
    return { error: "Couldn't read staking on this network. Try again." };
  }
};

const baseUnits = (amount: string | null, decimals: number): bigint | null => {
  if (amount === null) return null;
  try {
    return parseTokenAmount(amount, decimals);
  } catch {
    return null;
  }
};

type StakingContext = Exclude<
  Awaited<ReturnType<typeof stakingContext>>,
  { readonly error: string }
>;

type PreparedStaking = {
  readonly calls: readonly Call[];
  readonly context: StakingContext;
  readonly token: TokenConfig;
  readonly trusted: ReturnType<typeof verificationContext>;
  readonly validator: StakingValidator;
};

const readActionPool = (context: StakingContext, token: TokenConfig, validator: StakingValidator) =>
  context
    .read(context.rpcUrls, async (pinned) => {
      const facts = await readStakingChainFacts(pinned, context.network.stakingContract);
      if (!facts?.activeTokens.some((active) => sameFelt(active, token.address))) {
        return { refusal: "This token can't be staked.", token: token.address, validator };
      }
      return readStakingPool(pinned, {
        account: context.account.address,
        stakingContract: context.network.stakingContract,
        token: token.address,
        validator,
      });
    })
    .catch(() => null);

// Resolves the curated validator and tracked token, reads and verifies the pool
// at one block, and rebuilds the calls. Every refusal is an error reply.
const prepareAction = async (
  deps: StakingOpsDeps,
  input: StakingActionInput,
): Promise<PreparedStaking | { readonly error: string }> => {
  const context = await stakingContext(deps);
  if ("error" in context) return { error: context.error };
  const now = nowSeconds(deps);
  const validator = curatedValidator(context.network, input.validatorId);
  const token = context.preferences.tokens.find(
    (entry) => entry.id === input.tokenId && entry.networkId === context.networkId,
  );
  if (now === null || !validator || !token) return { error: "Staking option unavailable." };
  const reading = await readActionPool(context, token, validator);
  if (!reading) return { error: "Couldn't read staking on this network. Try again." };
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
  const trusted = {
    ...verificationContext(context.account, context.preferences),
    knownContracts: [reading.pool.pool],
  };
  return { calls: built, context, token, trusted, validator };
};

// Signs with the reviewed fee and submits; files the approval and Activity row
// for every hash that may be on chain (audit #173).
const submitAction = async (
  deps: StakingOpsDeps,
  input: StakingActionInput & { readonly reviewedFee: FeeEstimate },
  prepared: PreparedStaking,
  isAuthorized: () => boolean,
): Promise<RuntimeResponse> => {
  const { calls, context, token, trusted, validator } = prepared;
  const { account, rpcUrls } = context;
  const recordSubmitted = async (hash: string): Promise<void> => {
    // The stake's exact-amount approval is filed before the Activity line, as
    // on every other path that grants an allowance.
    await recordApproveAllowances({
      assets: trusted,
      calls,
      owner: allowanceOwner(account),
      store: deps.allowanceStore,
      transactionHash: hash,
    });
    await recordSubmittedActivity(deps.activity, {
      accountId: account.id,
      ...(input.amount === null ? {} : { amount: input.amount }),
      hash,
      kind: "invoke",
      networkId: context.networkId,
      summary: stakingActivitySummary({
        action: input.action,
        amount: input.amount,
        symbol: token.symbol,
        validator: validator.name,
      }),
      ...activityToken({ address: token.address, symbol: token.symbol }),
    });
  };
  let signedHash: string | undefined;
  try {
    const result = await deps.runtimeRpc.submitInvokeTransaction({
      account,
      calls,
      isAuthorized,
      onSigned: async (signed) => {
        signedHash = signed.transactionHash;
      },
      reviewedFee: input.reviewedFee,
      rpcUrls,
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

const actionResponse = async (
  deps: StakingOpsDeps,
  input: StakingActionInput,
): Promise<RuntimeResponse> => {
  const authorized = captureSessionAuthorization(deps.session);
  const prepared = await prepareAction(deps, input);
  if ("error" in prepared) return prepared;
  const refusal = refuseOnPoisonedRecipient(verifyCalls(prepared.calls, prepared.trusted));
  if (refusal) return refusal;
  const { account, rpcUrls } = prepared.context;
  const reviewedFee = input.reviewedFee;
  if (!reviewedFee) {
    const signHash = signerForContext(deps, prepared.context);
    return requiredFeeReview(() =>
      deps.runtimeRpc.estimateInvokeFee({ account, calls: prepared.calls, rpcUrls, signHash }),
    );
  }
  return submitAction(deps, { ...input, reviewedFee }, prepared, authorized.isCurrent);
};

/**
 * Handles staking messages; returns null for other message types. `networks`
 * overrides the bundled staking table (tests only).
 */
export const handleStakingOps = async (
  deps: StakingOpsDeps,
  messageType: string,
  message: unknown,
  networks?: StakingNetworkTable,
): Promise<RuntimeResponse | null> => {
  const scoped = networks ? { ...deps, stakingNetworks: networks } : deps;
  if (messageType === "wallet.stakingOverview") {
    return readTypeOnlyInput(message, "wallet.stakingOverview")
      ? overviewResponse(scoped)
      : { error: "invalid staking request" };
  }
  if (messageType === "wallet.stakingAction") {
    const input = readStakingActionInput(message);
    return input ? actionResponse(scoped, input) : { error: "invalid staking request" };
  }
  return null;
};
