/** Typed, display-safe prerequisites shared by the privileged privacy runtime and UI. */
import { WalletError } from "@bramble/core/errors";
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";

/** Closed vocabulary of actionable privacy refusals; unknown failures remain service errors. */
export type PrivacyBlockerKind = "deploy" | "fund" | "ledger" | "network" | "pending" | "service";

/** Registration is an invoke and requires an existing account contract. */
export const PRIVACY_DEPLOY_REQUIRED = "Deploy this account before enabling private balances";

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
