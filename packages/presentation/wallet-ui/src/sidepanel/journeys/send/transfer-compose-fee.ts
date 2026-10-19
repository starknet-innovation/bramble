/**
 * Fee lines for the Send Amount screen: what a composed send will cost, stated
 * before the user commits to it.
 *
 * The figures come from the same sources the review's Cost box uses, so the two
 * screens cannot disagree: a public transfer's network fee is the review's own
 * estimate, and a pool route's charge is the same sentence the review prints,
 * naming the fee in the token that pays it rather than assuming STRK. A pool route's NETWORK fee is deliberately
 * absent here: its calldata (and so its estimate) does not exist until the
 * preparation, so any figure would be a guess, and a guess is worse than a blank.
 */

import { sumFeeEstimates } from "@bramble/starknet/fee-bounds";
import type { SendRoute } from "@bramble/transactions/send-routes";
import { STRK_TOKEN_ADDRESS, sameFelt } from "@bramble/wallet-model/networks";
import type { SidepanelWallet } from "../../runtime/runtime";
import { estimatedFeeText } from "../../shared/review-render";
import { finitePositive } from "./send-model";
import { paysFeeFromAmount } from "./transfer-max";
import type { TransferFields, TransferStage } from "./transfer-model";
import { poolFeeText } from "./transfer-review-routes";
import {
  resolveTransferRoute,
  shieldLeavesNoStrkForGas,
  type TransferRouteContext,
  transferPoolFeeAmount,
  transferRoute,
} from "./transfer-route";
import type { TransferReview } from "./transfer-submit";

/** How long typing settles before a network fee is requested. */
export const COMPOSE_FEE_DEBOUNCE_MS = 400;

// Copy used when the network fee could not be read. Named, never a made-up figure.
const FEE_UNAVAILABLE = "Estimated fee unavailable";
// A STRK shield at Max holds back the pool fee only: its network fee is not
// known until the deposit is proved, and it is paid from the same STRK.
const SHIELD_GAS_NOTE = "Leave enough STRK for the network fee.";
// A shield of any other token still pays its network fee in public STRK, which
// the pool fee line alone does not say (issue 665). No figure: the fee is not
// known until the deposit is proved.
const SHIELD_GAS_IN_STRK = "The network fee is also paid in public STRK.";

/** The composed send an Amount-screen estimate applies to. */
export type ComposeFeeTarget = {
  readonly fields: TransferFields;
  /** A shield that leaves no public STRK for its network fee. */
  readonly leavesNoGas: boolean;
  /** A shield of a token other than STRK, whose network fee is still paid in STRK. */
  readonly gasInStrk: boolean;
  /** The pool fee in the token that pays it, as the route gate reserves it. */
  readonly poolFee: string | null;
  readonly route: SendRoute;
};

/** The estimate state the fee lines are built from. */
export type ComposeFeeEstimate = {
  readonly failed: boolean;
  readonly review: TransferReview | null;
};

/**
 * The composed send a fee can be estimated for, or `null` when the fields are
 * incomplete or the route itself is refusing. The route gate is the same one
 * the Review button enforces, so the preview never prices a send that cannot go.
 */
export const composeFeeTarget = (context: TransferRouteContext): ComposeFeeTarget | null => {
  const { fields } = context;
  if (fields.recipient === "" || finitePositive(fields.amount) === null) {
    return null;
  }
  if (resolveTransferRoute(context).blocked) {
    return null;
  }
  const route = transferRoute(fields);
  return {
    fields,
    gasInStrk: route.id === "public-private" && !sameFelt(fields.tokenAddress, STRK_TOKEN_ADDRESS),
    leavesNoGas: shieldLeavesNoStrkForGas(context),
    poolFee: transferPoolFeeAmount(context),
    route,
  };
};

// The figure the review's Cost box leads with. An account that must deploy first
// is quoted one total for the creation and the send, so the preview leads with
// that same total rather than its cheaper half.
const networkFeeText = (estimate: ComposeFeeEstimate): string | null => {
  const { failed, review } = estimate;
  if (review === null) {
    return failed ? FEE_UNAVAILABLE : null;
  }
  if (review.feeEstimateFailed || review.deploymentFeeEstimateFailed === true) {
    return FEE_UNAVAILABLE;
  }
  if (review.requiresDeployment) {
    const total =
      review.fee && review.deploymentFee ? sumFeeEstimates(review.fee, review.deploymentFee) : null;
    return total === null ? null : estimatedFeeText(total);
  }
  return review.fee === null ? null : estimatedFeeText(review.fee);
};

/**
 * The Amount screen's fee lines for one composed send and estimate, as plain
 * text in reading order. Empty when there is nothing truthful to show, so the
 * caller can paint the result unconditionally.
 */
export const composeFeeLines = (
  target: ComposeFeeTarget,
  estimate: ComposeFeeEstimate,
): readonly string[] => {
  const lines: string[] = [];
  if (
    target.route.poolFeeRequired &&
    target.route.feeBucket !== "none" &&
    target.poolFee !== null
  ) {
    lines.push(poolFeeText(target.route.feeBucket, target.poolFee));
  }
  if (target.leavesNoGas) {
    lines.push(SHIELD_GAS_NOTE);
  } else if (target.gasInStrk) {
    lines.push(SHIELD_GAS_IN_STRK);
  }
  // Only a plain public transfer's network fee can be estimated before the route
  // prepares; every other route's gas is sponsored or priced at review.
  if (target.route.id === "public-public") {
    const network = networkFeeText(estimate);
    if (network !== null) {
      lines.push(network);
    }
  }
  return lines;
};

/** The live Amount-screen fee preview: refresh after a change, clear when it leaves. */
export type ComposeFee = {
  /** Drops the lines and any estimate still in flight. */
  readonly clear: () => void;
  /** Re-reads the composed send and re-estimates, or clears when none applies. */
  readonly refresh: () => void;
  /**
   * The latest review for the composed account, token, recipient and speed,
   * whatever amount it was priced at (a transfer's fee does not depend on its
   * amount), or `null` when there is none yet. Max reserves its fee from it.
   */
  readonly review: () => TransferReview | null;
};

// What a review prices: the same send at any amount.
const reviewKey = (fields: TransferFields): string =>
  [fields.accountId, fields.tokenId, fields.recipient, fields.speed].join("|");

// The smallest positive amount in the token's scale. A public STRK send with no
// amount typed yet is priced at it, so Max can keep its fee back (mc-wallet 720).
const nominalAmount = (decimals: string): string => {
  const places = Number(decimals) || 0;
  return places <= 0 ? "1" : `0.${"0".repeat(places - 1)}1`;
};

/**
 * Binds the Amount screen's fee preview to the live form, painting the current
 * state immediately. Staleness is bounded by a request token: only the most
 * recent refresh may paint, so a slow estimate for a superseded amount can
 * never overwrite a newer one.
 *
 * `schedule` and `delayMs` are injected so tests need no wall clock.
 */
export const createComposeFee = (deps: {
  readonly context: () => TransferRouteContext;
  readonly delayMs?: number;
  readonly form: HTMLFormElement;
  readonly schedule?: (delayMs: number, run: () => void) => () => void;
  readonly stage: () => TransferStage;
  readonly wallet: SidepanelWallet;
}): ComposeFee => {
  // The review's own estimator: the same round trip the Review button makes, so
  // the figure quoted here is the figure that review will bind.
  const estimate = (fields: TransferFields): Promise<TransferReview> =>
    deps.wallet.reviewTransfer(
      fields.accountId,
      fields.tokenId,
      fields.recipient,
      fields.amount,
      fields.speed,
    );
  // Each fee is one text node: the figure is data, never markup.
  const paint = (lines: readonly string[]): void => {
    if (!deps.form.isConnected) return;
    const region = deps.form.querySelector<HTMLElement>("#send-fee-lines");
    if (!region) return;
    const doc = region.ownerDocument;
    region.replaceChildren(
      ...lines.map((text) => {
        const line = doc.createElement("p");
        line.className = "send-fee-line";
        line.textContent = text;
        return line;
      }),
    );
  };
  const schedule =
    deps.schedule ??
    ((delayMs: number, run: () => void): (() => void) => {
      const id = setTimeout(run, delayMs);
      return () => clearTimeout(id);
    });
  let cancel: (() => void) | null = null;
  let token = 0;
  let latest: { readonly key: string; readonly review: TransferReview } | null = null;
  let pricing: string | null = null;
  const remember = (fields: TransferFields, review: TransferReview): void => {
    latest = { key: reviewKey(fields), review };
  };
  const review = (): TransferReview | null => {
    const key = reviewKey(deps.context().fields);
    return latest?.key === key ? latest.review : null;
  };
  // Prices a public STRK send that has a recipient but no amount yet, once per
  // send, so Max can fill an amount that leaves its fee. Paints nothing.
  const priceForMax = (): void => {
    const context = deps.context();
    const { fields } = context;
    const key = reviewKey(fields);
    if (fields.recipient === "" || !paysFeeFromAmount(context) || review() || pricing === key) {
      return;
    }
    pricing = key;
    void estimate({ ...fields, amount: nominalAmount(fields.tokenDecimals) }).then(
      (priced) => {
        if (pricing === key) remember(fields, priced);
      },
      () => undefined,
    );
  };
  const clear = (): void => {
    token += 1;
    cancel?.();
    cancel = null;
    paint([]);
  };
  const refresh = (): void => {
    if (deps.stage() !== "details") {
      clear();
      return;
    }
    const target = deps.form.isConnected ? composeFeeTarget(deps.context()) : null;
    if (target === null) {
      clear();
      if (deps.form.isConnected) priceForMax();
      return;
    }
    token += 1;
    const mine = token;
    cancel?.();
    cancel = null;
    if (target.route.id !== "public-public") {
      // Nothing to wait for: the pool's charge is already known, and the network
      // fee is not knowable until the route prepares.
      paint(composeFeeLines(target, { failed: false, review: null }));
      return;
    }
    cancel = schedule(deps.delayMs ?? COMPOSE_FEE_DEBOUNCE_MS, () => {
      cancel = null;
      // A repaint can detach the form before the debounce fires; an estimate for
      // it would be a request with nothing left to paint.
      if (!deps.form.isConnected) return;
      void estimate(target.fields).then(
        (priced) => {
          remember(target.fields, priced);
          if (mine === token) paint(composeFeeLines(target, { failed: false, review: priced }));
        },
        () => {
          if (mine === token) paint(composeFeeLines(target, { failed: true, review: null }));
        },
      );
    });
  };
  refresh();
  return { clear, refresh, review };
};
