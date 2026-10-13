/**
 * Pure state and field parsing for the Send binding. Keeping this model outside
 * the DOM orchestration makes stage transitions and confirmation semantics
 * explicit and independently testable.
 */

import { normalizeStarkName } from "@bramble/starknet/stark-name";
import type { ValueBucket } from "@bramble/transactions/send-routes";
import { isStarkFieldElement, normalizeFeltInput } from "@bramble/wallet-model/networks";
import { errorMessage } from "../../shared/dom";
import type { PreparationProgress } from "../privacy/privacy-preparation-job";
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
 * True when the text is a syntactically valid Starknet name (for example
 * `name.stark` or `name.braavos.stark`). The `.stark` suffix is required: a
 * bare word is not a name, so an ordinary recipient search can never turn a
 * word into a lookup. A name is not an address: it is only offered to the
 * background for resolution, and the address it resolves to is what a review is
 * built from. A bare hex address is judged by {@link recipientFieldError}
 * instead.
 */
export const isStarkName = (value: string): boolean => normalizeStarkName(value) !== null;

/**
 * Maps a malformed-recipient background error onto the same friendly copy.
 */
export const friendlyReviewError = (error: unknown): string => {
  const message = errorMessage(error, "Transfer review failed");
  return INVALID_REVIEW_ERRORS.has(message) ? INVALID_RECIPIENT_MESSAGE : message;
};

/**
 * Screens Send can hand off to by name: where a finished or abandoned send
 * lands, and the two screens its composition controls open (the address book
 * for a new recipient, token management for a token it does not list).
 */
export type TransferExitView = "activity" | "address-book" | "home" | "multisig-deploy" | "tokens";

/**
 * Deterministic screens owned by the Send state machine.
 */
export type TransferStage =
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
 * Whether a send is past the confirm and its result has not landed yet. Such a
 * send is already signing or on its way to the network, so a screen that takes
 * over the panel (a dapp approval) must keep its state rather than discard the
 * hash it is about to return (Sherlock 164).
 */
export const isTransferInFlight = (stage: TransferStage): boolean =>
  stage === "authorizing" || stage === "broadcasting" || stage === "confirming";

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
  /**
   * Set to `"stark-name"` when the recipient came from a resolved Starknet
   * name, so the review can show the address it was resolved to and flag a
   * recipient that is not already saved. Empty for every other recipient.
   */
  readonly recipientResolvedFrom: "" | "stark-name";
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
  /**
   * The latest progress of the tracked background job behind a pool route's
   * review or confirm — the phase it is in and for how long — so the working
   * screen can say what the wait is doing. Null outside such a wait.
   */
  readonly progress: PreparationProgress | null;
  readonly requiresDeployment: boolean;
  readonly review: Review | null;
  readonly reviewedKey: string | null;
  readonly stage: TransferStage;
  /**
   * True on a `failed` stage whose submission may still land (its reply was
   * lost and no hash was captured). The receipt then says the status is
   * unknown and offers Activity instead of Try again.
   */
  readonly submissionUnknown: boolean;
  readonly transactionHash: string | null;
};

/**
 * Fresh recipient-first state.
 */
export const initialTransferState = <Review>(): TransferState<Review> => ({
  error: "",
  fields: null,
  privatePreparation: null,
  progress: null,
  requiresDeployment: false,
  review: null,
  reviewedKey: null,
  stage: "recipient",
  submissionUnknown: false,
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
    recipientResolvedFrom: data.get("recipientResolvedFrom") === "stark-name" ? "stark-name" : "",
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
