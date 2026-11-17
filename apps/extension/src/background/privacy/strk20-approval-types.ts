/**
 * Private STRK20 requests held inside the background approval queue. These
 * execution payloads stay in background memory; the approval UI receives only
 * a cloned action review, display-safe summaries, and the digest binding.
 */
import type { Strk20Action } from "@bramble/wallet-protocol/strk20";

/**
 * Approval kinds for STRK20 operations that disclose private state or create a
 * submittable proof. Every kind requires an explicit user decision.
 */
export type Strk20DisclosureApprovalKind =
  | "strk20-balances"
  | "strk20-prepare"
  | "strk20-register"
  | "strk20-shadow-account";

/**
 * Exact private operation retained until approval. The discriminant determines
 * which SDK operation executes; callers cannot substitute a different request
 * after the user reviews its digest and summaries.
 */
export type Strk20DisclosureRequest =
  | {
      readonly poolAddress: string;
      readonly poolFeeFri: string;
      readonly token: string;
      readonly type: "register";
    }
  | {
      readonly tokens: readonly string[];
      readonly type: "balances";
    }
  | {
      readonly actions: readonly Strk20Action[];
      /**
       * The shadow-account anonymizer the card named, present exactly when the
       * batch holds a `shadow_account_invoke`. Execution refuses if the
       * network's configured anonymizer has changed since.
       */
      readonly anonymizer?: string;
      readonly simulate: boolean;
      readonly type: "prepare";
    }
  | {
      /** The anonymizer the commitment is derived under, as the card named it. */
      readonly anonymizer: string;
      readonly dappName: string;
      readonly nonce?: string;
      readonly type: "shadowAccount";
    };

/**
 * Verifies that an internal approval kind matches its private request shape.
 * A mismatch fails before the request can enter the queue.
 */
export const matchesStrk20DisclosureKind = (
  kind: Strk20DisclosureApprovalKind,
  request: Strk20DisclosureRequest,
): boolean =>
  (kind === "strk20-balances" && request.type === "balances") ||
  (kind === "strk20-prepare" && request.type === "prepare") ||
  (kind === "strk20-register" && request.type === "register") ||
  (kind === "strk20-shadow-account" && request.type === "shadowAccount");
