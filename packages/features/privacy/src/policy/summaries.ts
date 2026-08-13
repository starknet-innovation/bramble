/** Review summaries and invoke conversion for STRK20 wire values. */

import type { Strk20Action, Strk20InvokeCall } from "@mc-wallet/wallet-protocol/strk20";
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
 * Describes the route without exposing private relay typed data. The returned
 * text is display-only; approval binds the structured plan instead.
 */
export const summarizeStrk20Plan = (plan: Strk20SubmissionPlan): string =>
  plan.mode === "account"
    ? `Public account pool fee ${plan.poolFeeFri} STRK fri — first deposits are linked to this wallet`
    : [
        `Private relay fee ${plan.feeAction.amount} (${plan.feeAction.token})`,
        ...(plan.authorization
          ? [
              `outside execution by ${shortAddress(plan.authorization.caller)} from ${plan.authorization.executeAfter} until ${plan.authorization.executeBefore} for ${plan.authorization.publicCallCount} public approval call${plan.authorization.publicCallCount === 1 ? "" : "s"}`,
            ]
          : []),
      ].join(" · ");

/**
 * Converts a validated wire call without changing target, entrypoint, calldata
 * order, or calldata values.
 */
export const strk20CallToInvoke = (call: Strk20InvokeCall): Call => ({
  calldata: [...call.calldata],
  contractAddress: call.contract_address,
  entrypoint: call.entry_point,
});
