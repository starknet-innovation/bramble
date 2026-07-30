/**
 * One-time background-only preparations for wallet-owned privacy operations.
 * The side panel receives review metadata, never the proof, viewing key, or
 * executable action batch.
 */

import { WalletError } from "../shared/errors";
import type { Strk20Action } from "../starknet/strk20/schemas";
import type { Strk20SubmissionPlan } from "../starknet/strk20/service";
import type { TokenConfig } from "../storage/preferences-store";
import type { ApprovalContext } from "./approval-context";

const MAX_PREPARATIONS = 20;
const PREPARATION_ID_PATTERN = /^sha256:[0-9a-f]{64}$/;

type BasePreparation = {
  readonly context: ApprovalContext;
  readonly id: string;
  readonly poolAddress: string;
  readonly summaries: readonly string[];
  readonly token: TokenConfig;
};

/**
 * Frozen one-time registration operation.
 */
export type Strk20RegistrationPreparation = BasePreparation & {
  readonly kind: "register";
};

/**
 * Frozen one-time deposit operation, including its reviewed submission route.
 */
export type Strk20DepositPreparation = BasePreparation & {
  readonly actions: readonly Strk20Action[];
  readonly amount: string;
  readonly amountRaw: string;
  readonly kind: "deposit";
  readonly plan: Strk20SubmissionPlan;
};

/**
 * Frozen protected payload consumed at most once by the background.
 */
export type Strk20WalletPreparation = Strk20DepositPreparation | Strk20RegistrationPreparation;

type UnsignedStrk20WalletPreparation =
  | Omit<Strk20DepositPreparation, "context" | "id">
  | Omit<Strk20RegistrationPreparation, "context" | "id">;

/**
 * Safe review subset returned to the side panel before confirmation.
 */
export type Strk20WalletPreparationReview = {
  readonly amount?: string;
  readonly id: string;
  readonly kind: "deposit" | "register";
  readonly payloadDigest: string;
  readonly poolAddress: string;
  readonly route: "private-relay" | "public-account";
  readonly summaries: readonly string[];
  readonly symbol: string;
  readonly tokenId: string;
};

/**
 * Exact JSON-shaped payload committed by the preparation digest.
 */
export const strk20WalletPreparationPayload = (
  preparation: UnsignedStrk20WalletPreparation,
): unknown =>
  preparation.kind === "register"
    ? {
        kind: preparation.kind,
        poolAddress: preparation.poolAddress,
        summaries: preparation.summaries,
        token: preparation.token,
      }
    : {
        actions: preparation.actions,
        amount: preparation.amount,
        amountRaw: preparation.amountRaw,
        kind: preparation.kind,
        plan: preparation.plan,
        poolAddress: preparation.poolAddress,
        summaries: preparation.summaries,
        token: preparation.token,
      };

const reviewOf = (preparation: Strk20WalletPreparation): Strk20WalletPreparationReview => ({
  ...(preparation.kind === "deposit" ? { amount: preparation.amount } : {}),
  id: preparation.id,
  kind: preparation.kind,
  payloadDigest: preparation.context.payloadDigest,
  poolAddress: preparation.poolAddress,
  route:
    preparation.kind === "deposit" && preparation.plan.mode !== "account"
      ? "private-relay"
      : "public-account",
  summaries: [...preparation.summaries],
  symbol: preparation.token.symbol,
  tokenId: preparation.token.id,
});

/**
 * Bounded, one-time preparation store. Claim removes the payload before any
 * asynchronous work so duplicate confirms cannot double-submit.
 */
export type Strk20WalletPreparationStore = {
  readonly claim: (id: string) => Strk20WalletPreparation | null;
  readonly put: (preparation: Strk20WalletPreparation) => Strk20WalletPreparationReview;
};

/**
 * Creates an in-memory preparation store scoped to the service worker.
 */
export const createStrk20WalletPreparationStore = (): Strk20WalletPreparationStore => {
  const pending = new Map<string, Strk20WalletPreparation>();
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
      return structuredClone(preparation);
    },
    put(preparation) {
      const copy = structuredClone(preparation);
      if (!PREPARATION_ID_PATTERN.test(copy.id) || copy.id !== copy.context.payloadDigest) {
        throw new WalletError("Invalid privacy preparation commitment");
      }
      pending.set(copy.id, copy);
      while (pending.size > MAX_PREPARATIONS) {
        const oldest = pending.keys().next().value;
        if (typeof oldest !== "string") {
          break;
        }
        pending.delete(oldest);
      }
      return reviewOf(copy);
    },
  };
};
