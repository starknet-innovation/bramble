/**
 * One-time in-memory swap preparations. AVNU is contacted before review; the
 * exact validated calls and their account/network binding are then frozen here
 * until a single confirm action atomically claims them.
 */

import { WalletError } from "@mc-wallet/core/errors";
import type { Call } from "starknet";
import type { ApprovalContext } from "./approval-context";
import type { ApprovalRiskFlag } from "./approvals";

const MAX_SWAP_PREPARATIONS = 20;
const PREPARATION_ID_PATTERN = /^sha256:[0-9a-f]{64}$/;

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
  readonly sellSymbol: string;
  readonly summaries: readonly string[];
};

/**
 * Public review subset returned to the extension side panel.
 */
export type SwapPreparationReview = {
  readonly flags: readonly ApprovalRiskFlag[];
  readonly id: string;
  readonly payloadDigest: string;
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
  sellSymbol: preparation.sellSymbol,
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
      if (!PREPARATION_ID_PATTERN.test(id)) {
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
      if (!PREPARATION_ID_PATTERN.test(copy.id) || copy.id !== copy.context.payloadDigest) {
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
        payloadDigest: copy.context.payloadDigest,
        summaries: [...copy.summaries],
      };
    },
  };
};
