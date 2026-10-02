/**
 * How a relay-quoted fee is bounded before it is proved.
 *
 * The pool charges its fee in STRK and only in STRK: `collect_fee` transfers
 * `STRK_TOKEN_ADDRESS` from `get_caller_address()`, and on the sponsored-private
 * route that caller is the relay. The relay recovers what it paid through a
 * withdrawal action appended to the sender's batch, and that action's token is
 * whatever `pool_fee_token` the wallet asked to be quoted in.
 *
 * Those two facts split this module in half. On STRK the withdrawal is
 * denominated in the same unit the pool charged, so it must equal the on-chain
 * charge exactly and the relay is trusted for nothing. On any other token the
 * relay performs a conversion that nothing on-chain denominates — and it both
 * sets the rate and receives the proceeds. That quote is admitted only under a
 * ceiling derived from a price source which is not the relay, and refused
 * outright when no such source answers.
 */

import { WalletError } from "@bramble/core/errors";
import {
  STRK_TOKEN_ADDRESS,
  type StarknetNetworkId,
  sameFelt,
} from "@bramble/wallet-model/networks";
import type { Strk20Action } from "@bramble/wallet-protocol/strk20";
import { spentTokens } from "../policy/fee-guards";
import {
  STRK20_FEE_UNVERIFIABLE,
  type Strk20FeeBound,
  type Strk20FeeReference,
  strk20ConvertedFeeCeiling,
} from "../policy/fee-policy";
import type { Strk20PrivateRelayPlan } from "../policy/submission-plan";

/**
 * Chooses and derives the bound the quote for `feeToken` must satisfy.
 *
 * STRK yields an exact bound from `poolFeeFri` alone. Any other token consults
 * `feeReference`; a missing collaborator, a refusal, or a non-positive answer
 * all fail the route closed with {@link STRK20_FEE_UNVERIFIABLE} rather than
 * letting the relay's own conversion stand unchecked.
 */
export const resolveStrk20FeeBound = async (input: {
  readonly feeReference?: Strk20FeeReference;
  readonly feeToken: string;
  readonly networkId: StarknetNetworkId;
  readonly poolFeeFri: bigint;
}): Promise<Strk20FeeBound> => {
  if (sameFelt(input.feeToken, STRK_TOKEN_ADDRESS)) {
    return { amount: input.poolFeeFri, kind: "exact" };
  }
  if (!input.feeReference) {
    throw new WalletError(STRK20_FEE_UNVERIFIABLE);
  }
  // A reference that throws is the same outcome as one that declines: the
  // wallet has no second opinion, so it does not proceed. Swallowing the cause
  // keeps a price-feed transport error from reaching a privacy review surface.
  let reference: bigint | null;
  try {
    reference = await input.feeReference({
      feeToken: input.feeToken,
      networkId: input.networkId,
      poolFeeFri: input.poolFeeFri,
    });
  } catch {
    throw new WalletError(STRK20_FEE_UNVERIFIABLE);
  }
  if (reference === null || reference <= 0n) {
    throw new WalletError(STRK20_FEE_UNVERIFIABLE);
  }
  return { ceiling: strk20ConvertedFeeCeiling(reference), kind: "ceiling", reference };
};

/**
 * Whether a quoted fee amount satisfies `bound`.
 *
 * `amount` has already passed `isStarkFieldElement` where the quote was read,
 * so it parses. The exact route defers to `sameFelt` rather than comparing
 * parsed values, keeping felt equality in its one implementation; the converted
 * route needs an inequality, which only a numeric comparison expresses.
 */
export const withinFeeBound = (amount: string, bound: Strk20FeeBound): boolean => {
  if (bound.kind === "exact") {
    return sameFelt(amount, bound.amount.toString());
  }
  let quoted: bigint;
  try {
    quoted = BigInt(amount);
  } catch {
    return false;
  }
  return quoted <= bound.ceiling;
};

/**
 * Records what a converted quote was admitted under, so the reviewed plan — and
 * the submission that re-checks it — carry the bound rather than re-deriving
 * one from a price that has since moved. The exact route has no band to record
 * and contributes nothing.
 */
export const reviewedFeeCeiling = (
  bound: Strk20FeeBound,
): Pick<Strk20PrivateRelayPlan, "feeCeiling"> | Record<string, never> =>
  bound.kind === "ceiling"
    ? {
        feeCeiling: {
          ceiling: `0x${bound.ceiling.toString(16)}`,
          reference: `0x${bound.reference.toString(16)}`,
        },
      }
    : {};

/**
 * The token a batch's relay fee should be quoted in, before the relay has had
 * a say.
 *
 * Paying in the token being moved is what makes a shielded balance
 * self-sufficient: a holder of only private USDC can transact without first
 * acquiring and shielding STRK. `fallback` (the configured fee token, STRK by
 * default) is returned whenever that choice would be ambiguous or unsafe:
 *
 * - the batch spends no token privately, or spends more than one — there is no
 *   single "token being sent" to follow;
 * - the batch also deposits that token, where adding a fee withdrawal in it
 *   would put a public deposit and a public withdrawal of one token in a single
 *   transaction, which is the linkage `assertNoPrivacyLeak` exists to prevent.
 *
 * Note this is a preference, not a decision: the relay may still refuse the
 * token, and the caller falls back on {@link Strk20FeeTokenUnsupportedError}.
 * Choosing the sent token also makes the public fee withdrawal name the asset
 * class of an otherwise-private action; `fallback` keeps every batch's fee
 * looking alike.
 */
export const preferredStrk20FeeToken = (
  actions: readonly Strk20Action[],
  fallback: string,
): string => {
  const spent = spentTokens(actions);
  const [candidate] = spent;
  if (spent.length !== 1 || candidate === undefined) {
    return fallback;
  }
  const deposited = actions.some(
    (action) => action.type === "deposit" && sameFelt(action.token, candidate),
  );
  return deposited ? fallback : candidate;
};

/**
 * The fee token a Send affordability gate should reserve against, mirroring the
 * preference {@link preferredStrk20FeeToken} applies at quote time so the panel
 * and the submission path agree on which balance pays.
 *
 * The quote selects the token being sent when a converted fee can be bounded
 * from an independent reference, and otherwise falls back to the configured fee
 * token. `convertedCeiling` is that bound for `token`, already derived from the
 * reference; a `null` ceiling means no bound exists, so the fee stays on the
 * fallback exactly as the quote would leave it. Keeping this selection here, a
 * pure function beside the quote's own preference, is what stops the two
 * disagreeing about which balance a fee leaves.
 */
export const strk20SendFeeModel = (input: {
  readonly convertedCeiling: bigint | null;
  readonly fallbackFeeToken: string;
  readonly token: string;
}): { readonly convertedCeiling: bigint | null; readonly feeToken: string } =>
  sameFelt(input.token, input.fallbackFeeToken) || input.convertedCeiling === null
    ? { convertedCeiling: null, feeToken: input.fallbackFeeToken }
    : { convertedCeiling: input.convertedCeiling, feeToken: input.token };
