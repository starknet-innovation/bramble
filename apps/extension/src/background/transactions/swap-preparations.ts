/**
 * One-time in-memory swap preparations. AVNU is contacted before review; the
 * exact validated calls and their account/network binding are then frozen here
 * until a single confirm action atomically claims them.
 */

import { WalletError } from "@bramble/core/errors";
import { isSha256Digest } from "@bramble/core/ids";
import type { FeeEstimate } from "@bramble/starknet/fee-bounds";
import type { Call } from "starknet";
import type { ApprovalContext } from "../approvals/approval-context";
import type { ApprovalRiskFlag } from "../approvals/approvals";

const MAX_SWAP_PREPARATIONS = 20;

/**
 * Frozen swap execution and review metadata held only by the background.
 */
export type SwapPreparation = {
  readonly amount: string;
  readonly buyAmount: string;
  readonly buySymbol: string;
  readonly calls: readonly Call[];
  readonly context: ApprovalContext;
  readonly flags: readonly ApprovalRiskFlag[];
  readonly id: string;
  // The minimum output the frozen route actually carries, decoded from its
  // calldata by the build policy — a decimal display string. It travels with
  // the preparation so the confirm card states the figure the transaction
  // enforces rather than one the panel computed alongside it.
  readonly minBuyAmount: string;
  readonly reviewedFee: FeeEstimate;
  readonly sellSymbol: string;
  // The sold token's contract, so the activity line names the token by
  // address and not only by a symbol another contract may share (issue 643).
  readonly sellTokenAddress: string;
  readonly summaries: readonly string[];
};

/**
 * Public review subset returned to the extension side panel.
 */
export type SwapPreparationReview = {
  readonly flags: readonly ApprovalRiskFlag[];
  readonly id: string;
  readonly minBuyAmount: string;
  readonly payloadDigest: string;
  readonly reviewedFee: FeeEstimate;
  readonly summaries: readonly string[];
};

const clonePreparation = (preparation: SwapPreparation): SwapPreparation =>
  structuredClone(preparation);

/**
 * Exact JSON-shaped value covered by the preparation's SHA-256 digest.
 */
export const swapPreparationPayload = (
  preparation: Omit<SwapPreparation, "context" | "id">,
): unknown => ({
  amount: preparation.amount,
  buyAmount: preparation.buyAmount,
  buySymbol: preparation.buySymbol,
  calls: preparation.calls,
  flags: preparation.flags,
  minBuyAmount: preparation.minBuyAmount,
  reviewedFee: preparation.reviewedFee,
  sellSymbol: preparation.sellSymbol,
  sellTokenAddress: preparation.sellTokenAddress,
  summaries: preparation.summaries,
});

/**
 * One-time preparation store. `claim` removes synchronously before submission,
 * preventing double clicks from submitting the same route twice.
 */
export type SwapPreparationStore = {
  readonly claim: (id: string) => SwapPreparation | null;
  readonly put: (preparation: SwapPreparation) => SwapPreparationReview;
};

/**
 * Creates the bounded background-only preparation store.
 */
export const createSwapPreparationStore = (): SwapPreparationStore => {
  const pending = new Map<string, SwapPreparation>();
  return {
    claim(id) {
      if (!isSha256Digest(id)) {
        return null;
      }
      const preparation = pending.get(id);
      if (!preparation) {
        return null;
      }
      pending.delete(id);
      return clonePreparation(preparation);
    },
    put(preparation) {
      const copy = clonePreparation(preparation);
      if (!isSha256Digest(copy.id) || copy.id !== copy.context.payloadDigest) {
        throw new WalletError("Invalid swap preparation commitment");
      }
      pending.set(copy.id, copy);
      while (pending.size > MAX_SWAP_PREPARATIONS) {
        const oldest = pending.keys().next().value;
        if (typeof oldest !== "string") {
          break;
        }
        pending.delete(oldest);
      }
      return {
        flags: copy.flags.map((flag) => ({ ...flag })),
        id: copy.id,
        minBuyAmount: copy.minBuyAmount,
        payloadDigest: copy.context.payloadDigest,
        reviewedFee: { ...copy.reviewedFee },
        summaries: [...copy.summaries],
      };
    },
  };
};
