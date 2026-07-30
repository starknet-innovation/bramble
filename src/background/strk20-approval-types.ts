/**
 * Private STRK20 requests held inside the background approval queue. These
 * execution payloads stay in background memory; the approval UI receives only
 * a cloned action review, display-safe summaries, and the digest binding.
 */
import type { Strk20Action } from "../starknet/strk20/schemas";

/**
 * Approval kinds for STRK20 operations that disclose private state or create a
 * submittable proof. Every kind requires an explicit user decision.
 */
export type Strk20DisclosureApprovalKind =
  | "strk20-balances"
  | "strk20-prepare"
  | "strk20-subaccount";

/**
 * Exact private operation retained until approval. The discriminant determines
 * which SDK operation executes; callers cannot substitute a different request
 * after the user reviews its digest and summaries.
 */
export type Strk20DisclosureRequest =
  | {
      readonly tokens: readonly string[];
      readonly type: "balances";
    }
  | {
      readonly actions: readonly Strk20Action[];
      readonly simulate: boolean;
      readonly type: "prepare";
    }
  | {
      readonly dappName: string;
      readonly nonce?: string;
      readonly type: "subaccount";
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
  (kind === "strk20-subaccount" && request.type === "subaccount");
