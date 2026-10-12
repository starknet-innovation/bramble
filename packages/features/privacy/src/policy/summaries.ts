/** Review summaries and invoke conversion for STRK20 wire values. */

import { formatTokenAmount } from "@bramble/starknet/rpc";
import { DEFAULT_TOKENS, STRK_TOKEN_ADDRESS, sameFelt } from "@bramble/wallet-model/networks";
import type { Strk20Action, Strk20InvokeCall } from "@bramble/wallet-protocol/strk20";
import type { Call } from "starknet";
import type { Strk20SubmissionPlan } from "./submission-plan";

const shortAddress = (value: string): string =>
  value.length <= 13 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`;

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
 * Display metadata for an action's token, looked up by token address. Callers
 * pass only tokens the wallet trusts for this account and network, so a
 * dapp-watched or spoof token never lends its ticker or decimals to a card.
 */
export type Strk20AssetLookup = (token: string) => Strk20FeeAsset | undefined;

// An amount in the token's own units and symbol when the wallet trusts the
// token, else the exact felt as sent: a decimal point is never guessed.
const actionAmount = (amount: string, token: string, assetFor?: Strk20AssetLookup): string =>
  displayFeeAmount(amount, assetFor?.(token)) ?? amount;

/**
 * Builds display-only summaries from validated actions; approval identity stays
 * bound to the exact structured payload, never this text.
 *
 * A `deposit` that names a recipient other than `depositor` credits that
 * account's private balance, so it is summarized as a payment naming the payee
 * rather than as a shield. Without a `depositor` a recipient-bearing deposit is
 * always summarized as a payment: the self case is only claimed when proven.
 *
 * Given `assetFor`, an amount in a token the wallet trusts renders in that
 * token's decimals and symbol, beside the token address (Sherlock 154).
 * Without it, or for a token it does not describe, the exact felt is shown.
 */
export const summarizeStrk20Action = (
  action: Strk20Action,
  depositor?: string,
  assetFor?: Strk20AssetLookup,
): string => {
  if (action.type === "deposit") {
    const amount = actionAmount(action.amount, action.token, assetFor);
    return action.recipient === undefined || sameFelt(action.recipient, depositor)
      ? `Deposit ${amount} to private balance (${shortAddress(action.token)})`
      : `Pay ${amount} privately to ${shortAddress(action.recipient)} (${shortAddress(action.token)})`;
  }
  if (action.type === "withdraw") {
    const amount = actionAmount(action.amount, action.token, assetFor);
    return `Withdraw ${amount} to ${shortAddress(action.recipient)} (${shortAddress(action.token)})`;
  }
  if (action.type === "transfer") {
    const amount =
      action.amount === "OPEN"
        ? "an open note"
        : actionAmount(action.amount, action.token, assetFor);
    return `Transfer ${amount} privately to ${shortAddress(action.recipient)} (${shortAddress(action.token)})`;
  }
  if (action.type === "subaccount_invoke") {
    return `Private ${action.dapp_name} sub-account invoke (${action.calls.length} calls)`;
  }
  return `Private invoke on ${shortAddress(action.contract)}`;
};

/**
 * The pool's own fee is charged in STRK on every network, so its display
 * metadata is the wallet's bundled STRK entry rather than a second spelling of
 * the decimals the balance paths already read. Resolved once: if the bundled
 * registry ever stopped describing STRK, every pool-fee summary would fall back
 * to its raw felt rather than guess a decimal point.
 */
const STRK_FEE_ASSET: Strk20FeeAsset | undefined = (() => {
  const strk = DEFAULT_TOKENS.find((token) => sameFelt(token.address, STRK_TOKEN_ADDRESS));
  return strk ? { decimals: strk.decimals, symbol: strk.symbol } : undefined;
})();

/**
 * Renders the pool fee, which the pool always charges in STRK, in STRK rather
 * than as the raw felt integer it arrives as. Display-only, and on the
 * approval path: an amount that cannot be rendered degrades to the raw felt
 * with its unit rather than throwing a review surface away.
 */
export const formatStrk20PoolFee = (poolFeeFri: string): string =>
  displayFeeAmount(poolFeeFri, STRK_FEE_ASSET) ?? `${poolFeeFri} STRK fri`;

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
    return `Public account pool fee ${formatStrk20PoolFee(plan.poolFeeFri)} — first deposits are linked to this wallet`;
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
