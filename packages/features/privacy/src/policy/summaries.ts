/** Review summaries and invoke conversion for STRK20 wire values. */

import type { MessageRef } from "@bramble/core/i18n";
import { formatTokenAmount } from "@bramble/starknet/rpc";
import { DEFAULT_TOKENS, STRK_TOKEN_ADDRESS, sameFelt } from "@bramble/wallet-model/networks";
import type { Strk20Action, Strk20InvokeCall } from "@bramble/wallet-protocol/strk20";
import type { Call } from "starknet";
import { strk20English, strk20Text } from "./review-messages";
import {
  SHADOW_INVOKE_CONTROL_TEXT,
  SHADOW_INVOKE_SETTLES_NOTHING_TEXT,
  shadowInvokeAnonymizerText,
  shadowInvokeCollectsAllToText,
  shadowInvokeRunsText,
  shadowInvokeSettlesText,
  shadowInvokeSettlesToText,
} from "./shadow-account-copy";
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
export const strk20ActionText = (
  action: Strk20Action,
  depositor?: string,
  assetFor?: Strk20AssetLookup,
): MessageRef => {
  if (action.type === "deposit") {
    const amount = actionAmount(action.amount, action.token, assetFor);
    const token = shortAddress(action.token);
    return action.recipient === undefined || sameFelt(action.recipient, depositor)
      ? strk20Text("strk20Review.action.deposit", { amount, token })
      : strk20Text("strk20Review.action.pay", {
          amount,
          recipient: shortAddress(action.recipient),
          token,
        });
  }
  if (action.type === "withdraw") {
    return strk20Text("strk20Review.action.withdraw", {
      amount: actionAmount(action.amount, action.token, assetFor),
      recipient: shortAddress(action.recipient),
      token: shortAddress(action.token),
    });
  }
  if (action.type === "transfer") {
    return strk20Text("strk20Review.action.transfer", {
      amount:
        action.amount === "OPEN"
          ? strk20Text("strk20Review.amount.openNote")
          : actionAmount(action.amount, action.token, assetFor),
      recipient: shortAddress(action.recipient),
      token: shortAddress(action.token),
    });
  }
  if (action.type === "shadow_account_invoke") {
    return strk20Text("strk20Review.action.shadowInvoke", {
      count: String(action.calls.length),
      dapp: action.dapp_name,
    });
  }
  return strk20Text("strk20Review.action.invoke", { contract: shortAddress(action.contract) });
};

/** The English of {@link strk20ActionText}, as review cards have always shown it. */
export const summarizeStrk20Action = (
  action: Strk20Action,
  depositor?: string,
  assetFor?: Strk20AssetLookup,
): string => strk20English(strk20ActionText(action, depositor, assetFor));

/**
 * The wallet-side facts a shadow-account invoke is reviewed against: the
 * anonymizer the network is configured with, and the origin the request was
 * gated on (already shortened for display by the caller).
 */
export type Strk20ShadowAccountReview = {
  readonly anonymizer: string;
  readonly origin: string;
};

// A nonce reads as a number on the card ("#1"); the exact felt stays in the
// action parameters. A malformed nonce cannot reach here (the batch parsed),
// but display code must not throw a review surface away, so it degrades.
const displayNonce = (nonce: string): string => {
  try {
    return BigInt(nonce).toString();
  } catch {
    return nonce;
  }
};

// The tokens an invoke settles, grouped by who receives the open note: one
// entry per OPEN transfer in the batch, named by the trusted symbol when the
// wallet knows the token, else by its address. `self` is true only when the
// recipient is proven to be `depositor`, as for a deposit.
const settledTokens = (
  actions: readonly Strk20Action[],
  depositor: string | undefined,
  assetFor: Strk20AssetLookup | undefined,
): readonly { readonly recipient: string; readonly self: boolean; readonly tokens: string[] }[] => {
  const groups: { readonly recipient: string; readonly self: boolean; tokens: string[] }[] = [];
  for (const action of actions) {
    if (action.type !== "transfer" || action.amount !== "OPEN") {
      continue;
    }
    const self = sameFelt(action.recipient, depositor);
    const token = assetFor?.(action.token)?.symbol ?? shortAddress(action.token);
    const group = groups.find(
      (candidate) => candidate.self === self && sameFelt(candidate.recipient, action.recipient),
    );
    if (group) {
      group.tokens.push(token);
    } else {
      groups.push({ recipient: action.recipient, self, tokens: [token] });
    }
  }
  return groups;
};

// One line per recipient: "back into private notes" only for this account's
// own notes. A note for anyone else names them, and under `collect_policy: all`
// also says the whole shadow-account balance of those tokens goes to them.
const settlementLines = (
  action: Extract<Strk20Action, { readonly type: "shadow_account_invoke" }>,
  actions: readonly Strk20Action[],
  depositor: string | undefined,
  assetFor: Strk20AssetLookup | undefined,
): readonly MessageRef[] => {
  const groups = settledTokens(actions, depositor, assetFor);
  if (groups.length === 0) {
    return [SHADOW_INVOKE_SETTLES_NOTHING_TEXT];
  }
  return groups.flatMap((group) => {
    const tokens = group.tokens.join(", ");
    if (group.self) {
      return [shadowInvokeSettlesText(tokens)];
    }
    const recipient = shortAddress(group.recipient);
    return [
      shadowInvokeSettlesToText(tokens, recipient),
      ...(action.collect_policy.type === "all"
        ? [shadowInvokeCollectsAllToText(tokens, recipient)]
        : []),
    ];
  });
};

const shadowInvokeSummaries = (
  action: Extract<Strk20Action, { readonly type: "shadow_account_invoke" }>,
  actions: readonly Strk20Action[],
  review: Strk20ShadowAccountReview,
  depositor: string | undefined,
  assetFor: Strk20AssetLookup | undefined,
): readonly MessageRef[] => [
  shadowInvokeRunsText(action.calls.length, displayNonce(action.nonce), review.origin),
  shadowInvokeAnonymizerText(review.anonymizer),
  ...settlementLines(action, actions, depositor, assetFor),
  SHADOW_INVOKE_CONTROL_TEXT,
];

/**
 * Review summaries for a whole validated batch, in batch order. A
 * `shadow_account_invoke` expands into the facts its card must state — the
 * calls it runs and through which shadow account for which site, the
 * anonymizer, the tokens it settles and for whom (back into private notes only
 * when the open note's recipient is `depositor`; otherwise naming the
 * recipient, and under `collect_policy: all` that the shadow account's whole
 * balance of those tokens goes to them), and who can move what the calls leave
 * behind — which is why it needs `shadow`: without it the
 * batch's shadow invokes keep the context-free label of
 * {@link summarizeStrk20Action}. Display-only, like every summary here.
 */
export const strk20BatchTexts = (
  actions: readonly Strk20Action[],
  options: {
    readonly assetFor?: Strk20AssetLookup;
    readonly depositor?: string;
    readonly shadow?: Strk20ShadowAccountReview;
  } = {},
): readonly MessageRef[] =>
  actions.flatMap((action) =>
    action.type === "shadow_account_invoke" && options.shadow
      ? shadowInvokeSummaries(action, actions, options.shadow, options.depositor, options.assetFor)
      : [strk20ActionText(action, options.depositor, options.assetFor)],
  );

/** The English of {@link strk20BatchTexts}, one line per reference. */
export const summarizeStrk20Batch = (
  actions: readonly Strk20Action[],
  options: Parameters<typeof strk20BatchTexts>[1] = {},
): readonly string[] => strk20BatchTexts(actions, options).map(strk20English);

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
export const strk20PlanText = (
  plan: Strk20SubmissionPlan,
  feeAsset?: Strk20FeeAsset,
): MessageRef => {
  if (plan.mode === "account") {
    return strk20Text("strk20Review.plan.account", {
      fee: formatStrk20PoolFee(plan.poolFeeFri),
    });
  }
  const amount = displayFeeAmount(plan.feeAction.amount, feeAsset);
  const fee =
    amount ??
    strk20Text("strk20Review.fee.raw", {
      amount: plan.feeAction.amount,
      token: plan.feeAction.token,
    });
  const ceiling = plan.feeCeiling ? displayFeeAmount(plan.feeCeiling.ceiling, feeAsset) : null;
  const auth = plan.authorization;
  if (!auth) {
    return ceiling === null
      ? strk20Text("strk20Review.plan.relay", { fee })
      : strk20Text("strk20Review.plan.relayCapped", { ceiling, fee });
  }
  const one = auth.publicCallCount === 1;
  const facts = {
    after: auth.executeAfter,
    before: auth.executeBefore,
    caller: shortAddress(auth.caller),
    count: String(auth.publicCallCount),
    fee,
  };
  return ceiling === null
    ? strk20Text(one ? "strk20Review.plan.relayAuthOne" : "strk20Review.plan.relayAuthMany", facts)
    : strk20Text(
        one ? "strk20Review.plan.relayCappedAuthOne" : "strk20Review.plan.relayCappedAuthMany",
        { ...facts, ceiling },
      );
};

/** The English of {@link strk20PlanText}, as review cards have always shown it. */
export const summarizeStrk20Plan = (
  plan: Strk20SubmissionPlan,
  feeAsset?: Strk20FeeAsset,
): string => strk20English(strk20PlanText(plan, feeAsset));

/**
 * Converts a validated wire call without changing target, entrypoint, calldata
 * order, or calldata values.
 */
export const strk20CallToInvoke = (call: Strk20InvokeCall): Call => ({
  calldata: [...call.calldata],
  contractAddress: call.contract_address,
  entrypoint: call.entry_point,
});
