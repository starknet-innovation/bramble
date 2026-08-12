/**
 * Pure state and field parsing for the Send binding. Keeping this model outside
 * the DOM orchestration makes stage transitions and confirmation semantics
 * explicit and independently testable.
 */

import type { ActivityEntry } from "@mc-wallet/transactions/activity";
import type { ValueBucket } from "@mc-wallet/transactions/send-routes";
import {
  isStarkFieldElement,
  normalizeFeltInput,
  sameFelt,
} from "@mc-wallet/wallet-model/networks";
import { errorMessage } from "../../shared/dom";
import type { PrivacyPreparation } from "../privacy/privacy-runtime";

/**
 * Friendly validation copy shared by the recipient screen and review failures.
 */
const INVALID_RECIPIENT_MESSAGE = "Enter a valid Starknet address.";

const INVALID_REVIEW_ERRORS = new Set([
  "invalid nft transfer review request",
  "invalid transfer review request",
]);

/**
 * Returns an inline error for a malformed Starknet address. Normalization keeps
 * the check aligned with the background and accepts mixed-case hex.
 */
export const recipientFieldError = (recipient: string): string | null =>
  isStarkFieldElement(normalizeFeltInput(recipient)) ? null : INVALID_RECIPIENT_MESSAGE;

/**
 * Maps a malformed-recipient background error onto the same friendly copy.
 */
export const friendlyReviewError = (error: unknown): string => {
  const message = errorMessage(error, "Transfer review failed");
  return INVALID_REVIEW_ERRORS.has(message) ? INVALID_RECIPIENT_MESSAGE : message;
};

/**
 * Deterministic screens owned by the Send state machine.
 */
export type TransferStage =
  | "asset"
  | "authorizing"
  | "broadcasting"
  | "confirming"
  | "details"
  | "failed"
  | "pending"
  | "recipient"
  | "review"
  | "reviewing"
  | "submitted";

/**
 * User-visible transaction fields frozen at review.
 */
export type TransferFields = {
  readonly accountId: string;
  readonly amount: string;
  /** Balance the value lands in. With `source`, this names the send's route. */
  readonly destination: ValueBucket;
  readonly fiatEstimate: string;
  readonly recipient: string;
  readonly recipientLabel: string;
  readonly signer: "ledger" | "software";
  /** Balance the value is spent from. */
  readonly source: ValueBucket;
  readonly speed: "fast" | "standard";
  readonly tokenAddress: string;
  readonly tokenBalance: string;
  readonly tokenDecimals: string;
  readonly tokenFormatted: string;
  readonly tokenId: string;
  readonly tokenPrice: string;
  readonly tokenSymbol: string;
};

/**
 * Persisted Send state retained across shell repaints.
 */
export type TransferState<Review> = {
  readonly error: string;
  readonly fields: TransferFields | null;
  readonly privatePreparation: PrivacyPreparation | null;
  readonly requiresDeployment: boolean;
  readonly review: Review | null;
  readonly reviewedKey: string | null;
  readonly stage: TransferStage;
  readonly transactionHash: string | null;
};

/**
 * Fresh recipient-first state.
 */
export const initialTransferState = <Review>(): TransferState<Review> => ({
  error: "",
  fields: null,
  privatePreparation: null,
  requiresDeployment: false,
  review: null,
  reviewedKey: null,
  stage: "recipient",
  transactionHash: null,
});

// Buckets default to public: an unreadable or absent field must never silently
// promise privacy the send is not going to deliver.
const bucket = (value: FormDataEntryValue | null): ValueBucket =>
  value === "private" ? "private" : "public";

/**
 * Reads the trusted extension form into the transaction snapshot submitted to
 * the privileged runtime. Hidden presentation fields are retained only so the
 * exact review can be restored after a shell repaint.
 */
export const transferFields = (form: HTMLFormElement): TransferFields => {
  const data = new FormData(form);
  return {
    accountId: String(data.get("accountId") ?? ""),
    amount: String(data.get("amount") ?? "").trim(),
    destination: bucket(data.get("destination")),
    fiatEstimate: String(data.get("fiatEstimate") ?? ""),
    recipient: normalizeFeltInput(String(data.get("recipient") ?? "")),
    recipientLabel: String(data.get("recipientLabel") ?? "").trim(),
    signer: form.dataset["signer"] === "ledger" ? "ledger" : "software",
    source: bucket(data.get("source")),
    speed: data.get("speed") === "fast" ? "fast" : "standard",
    tokenAddress: String(data.get("tokenAddress") ?? ""),
    tokenBalance: String(data.get("tokenBalance") ?? "0"),
    tokenDecimals: String(data.get("tokenDecimals") ?? "0"),
    tokenFormatted: String(data.get("tokenFormatted") ?? "0"),
    tokenId: String(data.get("tokenId") ?? ""),
    tokenPrice: String(data.get("tokenPrice") ?? ""),
    tokenSymbol: String(data.get("tokenSymbol") ?? "token"),
  };
};

/**
 * Stable review cache key. Presentation-only fiat data is excluded so a price
 * refresh cannot silently change the transaction being authorized.
 *
 * Both buckets are part of the key: flipping either one changes the route, the
 * fee, and the submission path, so a review cached under the old pair must never
 * be reused for the new one.
 */
export const transferKey = (fields: TransferFields): string =>
  JSON.stringify({
    accountId: fields.accountId,
    amount: fields.amount,
    destination: fields.destination,
    recipient: fields.recipient,
    source: fields.source,
    speed: fields.speed,
    tokenId: fields.tokenId,
  });

/**
 * Finds the current chain status for one submitted hash.
 */
export const confirmationStatus = (
  entries: readonly ActivityEntry[],
  transactionHash: string,
): ActivityEntry["status"] | null =>
  entries.find((entry) => sameFelt(entry.hash, transactionHash))?.status ?? null;

/**
 * What the Send journey should do about the latest chain status.
 *
 * A pre-confirmation is a real answer — the proposer has executed the
 * transaction and its revert status is already known — so the journey completes
 * on it rather than sitting on a spinner waiting for L2 acceptance. Background
 * reconciliation keeps verifying the transaction through to L1 finality and
 * raises a notice if it later fails. `null` means keep waiting.
 */
export type ConfirmationOutcome =
  | { readonly kind: "failed"; readonly message: string; readonly toast: string }
  | { readonly kind: "succeeded"; readonly toast: string };

// One row per status the journey acts on. Statuses absent here — `pending`, and
// no status observed yet — mean keep waiting.
const CONFIRMATION_OUTCOMES: Partial<Record<ActivityEntry["status"], ConfirmationOutcome>> = {
  accepted: { kind: "succeeded", toast: "Transaction confirmed on Starknet" },
  preconfirmed: { kind: "succeeded", toast: "Transaction pre-confirmed on Starknet" },
  rejected: {
    kind: "failed",
    message: "Starknet rejected this transaction. No transfer was completed.",
    toast: "Transaction was not confirmed",
  },
  reverted: {
    kind: "failed",
    message: "Starknet reverted this transaction. Review its activity details before retrying.",
    toast: "Transaction was not confirmed",
  },
};

/**
 * Confirmation checkpoints in milliseconds, paired with the outcome table above:
 * a tight burst for the common case, then ten-second checks out to roughly a
 * minute. Every checkpoint is a live chain read, so this is the journey's
 * patience rather than the chain's — it completes on PRE_CONFIRMED, but a
 * proposer can take longer than a ten-second burst to report even that.
 */
export const CONFIRMATION_DELAYS_MS: readonly number[] = [
  0, 250, 500, 900, 1_500, 2_500, 4_000, 5_000, 7_500, 10_000, 10_000, 10_000,
];

/**
 * Maps the latest observed status onto that decision.
 */
export const confirmationOutcome = (
  status: ActivityEntry["status"] | null,
): ConfirmationOutcome | null => (status === null ? null : (CONFIRMATION_OUTCOMES[status] ?? null));

/**
 * Human-readable title for the current Send checkpoint.
 */
export const transferStageTitle = (stage: TransferStage): string => {
  if (stage === "recipient") return "Send to";
  if (stage === "asset") return "Select an asset";
  if (stage === "details") return "Send";
  if (stage === "review" || stage === "reviewing") return "Review send";
  if (stage === "authorizing") return "Authorize send";
  if (stage === "broadcasting") return "Sending";
  if (stage === "confirming") return "Confirming";
  if (stage === "pending") return "Confirmation pending";
  if (stage === "submitted") return "Confirmed";
  return "Send failed";
};
