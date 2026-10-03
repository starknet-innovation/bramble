/**
 * Fee lines for the Send Amount screen: what a composed send will cost, stated
 * before the user commits to it.
 *
 * The figures come from the same sources the review's Cost box uses, so the two
 * screens cannot disagree: a public transfer's network fee is the review's own
 * estimate, and a pool route's charge is the same sentence, from the same
 * formatter, the review prints. A pool route's NETWORK fee is deliberately
 * absent here: its calldata (and so its estimate) does not exist until the
 * preparation, so any figure would be a guess, and a guess is worse than a blank.
 */

import { sumFeeEstimates } from "@bramble/starknet/fee-bounds";
import type { SendRoute } from "@bramble/transactions/send-routes";
import type { SidepanelWallet } from "../../runtime/runtime";
import { estimatedFeeText } from "../../shared/review-render";
import type { TransferFields, TransferStage } from "./transfer-model";
import { poolFeeText } from "./transfer-review-routes";
import { resolveTransferRoute, type TransferRouteContext, transferRoute } from "./transfer-route";
import type { TransferReview } from "./transfer-submit";

/** How long typing settles before a network fee is requested. */
export const COMPOSE_FEE_DEBOUNCE_MS = 400;

// Copy used when the network fee could not be read. Named, never a made-up figure.
const FEE_UNAVAILABLE = "Estimated fee unavailable";

/** The composed send an Amount-screen estimate applies to. */
export type ComposeFeeTarget = {
  readonly fields: TransferFields;
  readonly poolFeeFri: string | undefined;
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
  if (fields.recipient === "" || fields.amount === "" || Number(fields.amount) <= 0) {
    return null;
  }
  if (resolveTransferRoute(context).blocked) {
    return null;
  }
  return {
    fields,
    poolFeeFri: context.privacy.value?.poolFeeFri,
    route: transferRoute(fields),
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
    target.poolFeeFri !== undefined
  ) {
    lines.push(poolFeeText(target.route.feeBucket, target.poolFeeFri));
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
    const target = composeFeeTarget(deps.context());
    if (target === null) {
      clear();
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
      void estimate(target.fields).then(
        (review) => {
          if (mine === token) paint(composeFeeLines(target, { failed: false, review }));
        },
        () => {
          if (mine === token) paint(composeFeeLines(target, { failed: true, review: null }));
        },
      );
    });
  };
  refresh();
  return { clear, refresh };
};
