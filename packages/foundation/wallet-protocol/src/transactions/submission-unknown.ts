/**
 * Typed "submission status unknown" refusal shared by the privileged runtime
 * and the side panel.
 *
 * A write whose reply was lost (a transport failure after the broadcast began)
 * may already be on chain. The background reports it with this shape instead
 * of a plain `{ error }` so the panel can tell it apart from a determinate
 * failure and never offer a blind re-send. The signed hash, when the
 * background captured one, lets the panel follow the transaction instead.
 */
import { WalletError } from "@bramble/core/errors";
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { isNonZeroStarkFieldElement } from "@bramble/wallet-model/networks";

/** Wire shape of a submission whose outcome the background could not establish. */
export type SubmissionUnknownResponse = {
  readonly error: string;
  readonly submissionUnknown: true;
  readonly transactionHash?: string;
};

/**
 * A rejected panel call whose transaction may still land. `transactionHash`
 * is the hash the wallet signed and tried to send, or `null` when none was
 * captured (for example when an automatic deployment's own reply was lost).
 */
export class SubmissionUnknownError extends WalletError {
  public constructor(
    message: string,
    public readonly transactionHash: string | null,
  ) {
    super(message);
    this.name = "SubmissionUnknownError";
  }
}

/**
 * Builds the background reply for an indeterminate write. A hash that is not a
 * non-zero field element is dropped rather than forwarded, so the reader on
 * the panel side never has to reject an otherwise honest refusal.
 */
export const submissionUnknownResponse = (
  error: string,
  transactionHash?: string,
): SubmissionUnknownResponse => ({
  error,
  submissionUnknown: true,
  ...(transactionHash !== undefined && isNonZeroStarkFieldElement(transactionHash)
    ? { transactionHash }
    : {}),
});

/**
 * Validates an untrusted reply before it becomes a {@link SubmissionUnknownError}.
 * Only the exact shape is accepted: a non-empty message, `submissionUnknown:
 * true`, and an optional non-zero field-element hash. Anything else returns
 * `null`, so the caller falls back to its ordinary error handling.
 */
export const readSubmissionUnknownError = (value: unknown): SubmissionUnknownError | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["error", "submissionUnknown", "transactionHash"]) ||
    typeof value["error"] !== "string" ||
    value["error"].length === 0 ||
    value["submissionUnknown"] !== true
  ) {
    return null;
  }
  const hash = value["transactionHash"];
  if (hash === undefined) {
    return new SubmissionUnknownError(value["error"], null);
  }
  return typeof hash === "string" && isNonZeroStarkFieldElement(hash)
    ? new SubmissionUnknownError(value["error"], hash)
    : null;
};
