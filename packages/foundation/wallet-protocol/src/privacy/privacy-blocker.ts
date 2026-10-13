/** Typed, display-safe prerequisites shared by the privileged privacy runtime and UI. */
import { WalletError } from "@bramble/core/errors";
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";

/** Closed vocabulary of actionable privacy refusals; unknown failures remain service errors. */
export type PrivacyBlockerKind = "deploy" | "fund" | "ledger" | "network" | "pending" | "service";

/** Registration is an invoke and requires an existing account contract. */
export const PRIVACY_DEPLOY_REQUIRED = "Deploy this account before enabling private balances";

/**
 * The next step for an account that cannot pay to go private. Raised ahead of
 * the deployment when the balance read says it cannot, so the refusal arrives
 * as a screen with somewhere to go rather than a failed fee estimate. The
 * screen's own title and body carry the explanation; this is the instruction
 * under them, so it stays a single clause and names the one action to take.
 */
export const PRIVACY_FUNDS_REQUIRED = "Deposit some STRK, then come back";

/**
 * The one line a site's private request shows when this network has no private
 * services for it (no shadow-account anonymizer configured). Approved copy.
 * The request is held on the wallet's own surface until the user closes it, so
 * a site cannot time an instant refusal to learn what the user has set up.
 */
export const PRIVATE_SERVICES_UNAVAILABLE_NOTICE =
  "Private services aren't set up for this network.";

/**
 * PROPOSED, pending copy review: the notice line when the shadow-account
 * record table cannot take this request's scope. Not "Private services aren't
 * set up for this network.", which would be false here.
 */
export const SHADOW_ACCOUNT_RECORD_LIMIT_NOTICE =
  "Bramble can't record another shadow account, so this request can't run.";

/**
 * PROPOSED, pending copy review: the notice line when a site's private request
 * could not be prepared for review (for example its fee quote failed).
 */
export const PRIVATE_REQUEST_FAILED_NOTICE = "Couldn't prepare this private request.";

/** Curated wallet refusal; carries its action independently of display wording. */
export class PrivacyBlockerError extends WalletError {
  public constructor(
    public readonly kind: PrivacyBlockerKind,
    message: string,
  ) {
    super(message);
  }
}

/** Validates an untrusted refusal before its message or action enters UI state. */
export const readPrivacyBlockerError = (value: unknown): PrivacyBlockerError | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["error", "privacyBlocker"]) ||
    typeof value["error"] !== "string" ||
    value["error"].length === 0
  )
    return null;
  const kind = value["privacyBlocker"];
  if (
    kind !== "deploy" &&
    kind !== "fund" &&
    kind !== "ledger" &&
    kind !== "network" &&
    kind !== "pending" &&
    kind !== "service"
  )
    return null;
  return new PrivacyBlockerError(kind, value["error"]);
};
