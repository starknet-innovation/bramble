/** Review summaries and invoke conversion for STRK20 wire values. */

import { formatTokenAmount } from "@bramble/starknet/rpc";
import type { Strk20Action, Strk20InvokeCall } from "@bramble/wallet-protocol/strk20";
import type { Call } from "starknet";
import type { Strk20SubmissionPlan } from "./submission-plan";

const shortAddress = (value: string): string =>
  value.length <= 13 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`;

/**
 * Builds display-only summaries from validated actions; approval identity stays
 * bound to the exact structured payload, never this text.
 */
export const summarizeStrk20Action = (action: Strk20Action): string => {
  if (action.type === "deposit") {
    return `Deposit ${action.amount} to private balance (${shortAddress(action.token)})`;
  }
  if (action.type === "withdraw") {
    return `Withdraw ${action.amount} to ${shortAddress(action.recipient)} (${shortAddress(action.token)})`;
  }
  if (action.type === "transfer") {
    const amount = action.amount === "OPEN" ? "an open note" : action.amount;
    return `Transfer ${amount} privately to ${shortAddress(action.recipient)} (${shortAddress(action.token)})`;
  }
  if (action.type === "subaccount_invoke") {
    return `Private ${action.dapp_name} sub-account invoke (${action.calls.length} calls)`;
  }
  return `Private invoke on ${shortAddress(action.contract)}`;
};

/**
 * The fee token's display metadata, when the caller knows it. A converted fee
 * is the one number on this surface a user can sanity-check, and a raw felt
 * against a raw address is not checkable — so callers that hold the token's
 * preferences entry should pass it.
 */
export type Strk20FeeAsset = {
  readonly decimals: number;
  readonly symbol: string;
};

// Display-only, and on the approval path: a malformed amount must degrade to
// the raw felt rather than throw a review surface away. Callers validate the
// plan; this only renders it.
const displayFeeAmount = (raw: string, asset: Strk20FeeAsset | undefined): string | null => {
  if (!asset || !Number.isInteger(asset.decimals) || asset.decimals < 0) {
    return null;
  }
  try {
    return `${formatTokenAmount(BigInt(raw), asset.decimals)} ${asset.symbol}`;
  } catch {
    return null;
  }
};

/**
 * Describes the route without exposing private relay typed data. The returned
 * text is display-only; approval binds the structured plan instead.
 *
 * Given `feeAsset`, the relay fee renders as a decimal amount in the fee
 * token's own symbol, followed by the ceiling it was admitted under on a
 * converted token. Without it the raw felt and token address are shown, which
 * is the most that can honestly be said about an unrecognized token.
 */
export const summarizeStrk20Plan = (
  plan: Strk20SubmissionPlan,
  feeAsset?: Strk20FeeAsset,
): string => {
  if (plan.mode === "account") {
    return `Public account pool fee ${plan.poolFeeFri} STRK fri — first deposits are linked to this wallet`;
  }
  const amount = displayFeeAmount(plan.feeAction.amount, feeAsset);
  const ceiling = plan.feeCeiling ? displayFeeAmount(plan.feeCeiling.ceiling, feeAsset) : null;
  return [
    amount === null
      ? `Private relay fee ${plan.feeAction.amount} (${plan.feeAction.token})`
      : `Private relay fee ${amount}`,
    ...(ceiling === null ? [] : [`capped at ${ceiling}`]),
    ...(plan.authorization
      ? [
          `outside execution by ${shortAddress(plan.authorization.caller)} from ${plan.authorization.executeAfter} until ${plan.authorization.executeBefore} for ${plan.authorization.publicCallCount} public approval call${plan.authorization.publicCallCount === 1 ? "" : "s"}`,
        ]
      : []),
  ].join(" · ");
};

/**
 * Converts a validated wire call without changing target, entrypoint, calldata
 * order, or calldata values.
 */
export const strk20CallToInvoke = (call: Strk20InvokeCall): Call => ({
  calldata: [...call.calldata],
  contractAddress: call.contract_address,
  entrypoint: call.entry_point,
});
