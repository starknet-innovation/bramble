/**
 * One-time background-only preparations for wallet-owned privacy operations.
 * The side panel receives review metadata, never the proof, viewing key, or
 * executable action batch.
 */

import { WalletError } from "@mc-wallet/core/errors";
import type { Strk20Action } from "@mc-wallet/wallet-protocol/strk20";
import type { PaymasterAuthorizationReview } from "@mc-wallet/privacy/paymaster-typed-data";
import type { Strk20SubmissionPlan } from "@mc-wallet/privacy/service";
import type { TokenConfig } from "@mc-wallet/settings/preferences";
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
  readonly poolFeeFri: string;
};

/**
 * Frozen one-time deposit operation, including its reviewed submission route.
 * `recipient` is whose private balance the deposit credits — the depositor for a
 * shield, anyone registered with the pool otherwise — and is committed by the
 * digest so the credited party cannot change between review and submission.
 */
export type Strk20DepositPreparation = BasePreparation & {
  readonly actions: readonly Strk20Action[];
  readonly amount: string;
  readonly amountRaw: string;
  readonly kind: "deposit";
  readonly plan: Strk20SubmissionPlan;
  readonly recipient: string;
};

/**
 * Frozen one-time shielded transfer, always routed through the private relay.
 * The recipient is committed by the digest alongside the action batch.
 */
export type Strk20TransferPreparation = BasePreparation & {
  readonly actions: readonly Strk20Action[];
  readonly amount: string;
  readonly amountRaw: string;
  readonly kind: "transfer";
  readonly plan: Strk20SubmissionPlan;
  readonly recipient: string;
};

/**
 * Frozen one-time withdrawal (unshield), always routed through the private
 * relay. The public destination is committed by the digest with the batch.
 */
export type Strk20WithdrawPreparation = BasePreparation & {
  readonly actions: readonly Strk20Action[];
  readonly amount: string;
  readonly amountRaw: string;
  readonly kind: "withdraw";
  readonly plan: Strk20SubmissionPlan;
  readonly recipient: string;
};

/**
 * Frozen protected payload consumed at most once by the background.
 */
export type Strk20WalletPreparation =
  | Strk20DepositPreparation
  | Strk20RegistrationPreparation
  | Strk20TransferPreparation
  | Strk20WithdrawPreparation;

type UnsignedStrk20WalletPreparation =
  | Omit<Strk20DepositPreparation, "context" | "id">
  | Omit<Strk20RegistrationPreparation, "context" | "id">
  | Omit<Strk20TransferPreparation, "context" | "id">
  | Omit<Strk20WithdrawPreparation, "context" | "id">;

/**
 * Safe review subset returned to the side panel before confirmation.
 */
export type Strk20WalletPreparationReview = {
  readonly amount?: string;
  readonly authorization?: PaymasterAuthorizationReview;
  readonly id: string;
  readonly kind: "deposit" | "register" | "transfer" | "withdraw";
  readonly payloadDigest: string;
  readonly poolAddress: string;
  readonly poolFeeFri?: string;
  readonly recipient?: string;
  readonly route: "private-relay" | "public-account";
  readonly relayFee?: {
    readonly amount: string;
    readonly recipient: string;
    readonly token: string;
  };
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
        poolFeeFri: preparation.poolFeeFri,
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
        recipient: preparation.recipient,
        summaries: preparation.summaries,
        token: preparation.token,
      };

const reviewOf = (preparation: Strk20WalletPreparation): Strk20WalletPreparationReview => ({
  ...(preparation.kind === "register" ? {} : { amount: preparation.amount }),
  ...(preparation.kind !== "register" &&
  preparation.plan.mode !== "account" &&
  preparation.plan.authorization
    ? { authorization: preparation.plan.authorization }
    : {}),
  id: preparation.id,
  kind: preparation.kind,
  payloadDigest: preparation.context.payloadDigest,
  poolAddress: preparation.poolAddress,
  ...(preparation.kind === "register"
    ? { poolFeeFri: preparation.poolFeeFri }
    : preparation.plan.mode === "account"
      ? { poolFeeFri: preparation.plan.poolFeeFri }
      : {}),
  ...(preparation.kind === "register" ? {} : { recipient: preparation.recipient }),
  route:
    preparation.kind !== "register" && preparation.plan.mode !== "account"
      ? "private-relay"
      : "public-account",
  ...(preparation.kind !== "register" && preparation.plan.mode !== "account"
    ? {
        relayFee: {
          amount: preparation.plan.feeAction.amount,
          recipient: preparation.plan.feeAction.recipient,
          token: preparation.plan.feeAction.token,
        },
      }
    : {}),
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
