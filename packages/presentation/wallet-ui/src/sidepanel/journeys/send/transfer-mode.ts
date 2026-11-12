/**
 * What the composed send *is*, in the user's words.
 *
 * Shielding and unshielding run on the Send machinery — a source bucket, a
 * destination bucket, a recipient — but a screen titled "Send" that asks who to
 * pay is the wrong frame for moving value between your own two balances. The
 * mode is derived from the live fields rather than from how the screen was
 * opened, so a shield shortcut whose destination is flipped back to public
 * reads as the plain send it has become, and a send composed by hand to the
 * account's own private balance reads as the shield it is.
 *
 * Pure: the mode and every string that follows from it are functions of the
 * fields and nothing else, so the template, the repaint, and the receipt all
 * name the operation the same way.
 */

import type { ValueBucket } from "@bramble/transactions/send-routes";
import { sameFelt } from "@bramble/wallet-model/networks";
import { t } from "../../../i18n/messages";
import type { TransferStage } from "./transfer-model";

/**
 * `shield` and `unshield` are the two self-transfers between buckets; anything
 * else — a payment to someone, or a same-bucket move — is a send.
 */
export type TransferMode = "send" | "shield" | "unshield";

/**
 * The fields the mode depends on, so callers need not hold a full snapshot.
 */
export type TransferModeInput = {
  readonly destination: ValueBucket;
  readonly recipient: string;
  readonly source: ValueBucket;
};

/**
 * Derives the mode. A blank or foreign recipient is always a send, and so is a
 * self-transfer that does not cross buckets; only the two bucket-crossing
 * self-transfers earn their own name. `senderAddress` may be empty (no active
 * account), which resolves to a send rather than guessing.
 */
export const transferModeFor = (fields: TransferModeInput, senderAddress: string): TransferMode => {
  if (
    senderAddress.length === 0 ||
    fields.recipient.length === 0 ||
    !sameFelt(fields.recipient, senderAddress)
  ) {
    return "send";
  }
  if (fields.source === "public" && fields.destination === "private") {
    return "shield";
  }
  if (fields.source === "private" && fields.destination === "public") {
    return "unshield";
  }
  return "send";
};

/**
 * Every mode-dependent string the Send screen shows, so a new surface picks
 * from the table rather than spelling "shield" a fourth way.
 */
export type TransferModeCopy = {
  /** Accessible name of the amount field. */
  readonly amountLabel: string;
  /** Accessible name of the header's close control. */
  readonly closeLabel: string;
  /** Label of the final confirm control for a software signer. */
  readonly confirmLabel: string;
  /** The operation as a title-case noun: the amount step's header. */
  readonly noun: string;
  /**
   * The operation while its review is being prepared: the busy review button
   * (with an ellipsis) and the working screen's title. A pool route builds a
   * proof or quotes the relay here, so the wait needs a name of its own.
   */
  readonly preparing: string;
  /** Accessible name of the step indicator. */
  readonly progressLabel: string;
  /** Label of the amount step's primary action. */
  readonly reviewLabel: string;
  /** What the user is asked to check before confirming. */
  readonly reviewNote: string;
  /** Heading of the success receipt. */
  readonly successTitle: string;
  /** The operation as a lower-case verb, for "Review …" and "Authorize …". */
  readonly verb: string;
  /** The operation in progress, for the broadcast title. */
  readonly progressive: string;
};

// Review-step copy stays English: the confirm control and the note beside it
// are signing text, translated with the review under pinned English sources.
const REVIEW_COPY: Readonly<
  Record<TransferMode, Pick<TransferModeCopy, "confirmLabel" | "reviewNote" | "verb">>
> = {
  send: {
    confirmLabel: "Confirm and send",
    reviewNote: "Confirm only if the recipient, amount, and decoded action are correct.",
    verb: "send",
  },
  shield: {
    confirmLabel: "Confirm and shield",
    reviewNote:
      "This moves value from your public balance into your private one. Confirm only if the amount and decoded action are correct.",
    verb: "shield",
  },
  unshield: {
    confirmLabel: "Confirm and unshield",
    reviewNote:
      "This moves value from your private balance back into your public one. Confirm only if the amount and decoded action are correct.",
    verb: "unshield",
  },
};

// Built on each call so it follows the active UI language.
const copyFor = (mode: TransferMode): TransferModeCopy => {
  const key = <S extends string>(suffix: S) => `send.mode.${mode}.${suffix}` as const;
  return {
    ...REVIEW_COPY[mode],
    amountLabel: t(key("amount")),
    closeLabel: t(key("close")),
    noun: t(key("noun")),
    preparing: t(key("preparing")),
    progressive: t(key("progressive")),
    progressLabel: t(key("progress")),
    reviewLabel: t(key("review")),
    successTitle: t(key("success")),
  };
};

/**
 * Heading of the failure receipt, in every mode, when nothing was submitted.
 * The flow header above it already names the operation ("Shield failed"), so
 * this line carries the fact the header does not. Mode-independent on purpose:
 * "Shield not completed" under "Shield failed" said one thing twice.
 */
export const transferFailureTitle = (): string => t("send.failure.title.notSent");

/**
 * Heading of the failure receipt once a transaction was submitted and the chain
 * then rejected or reverted it. It was sent, its hash is shown, and a fee may
 * have been paid, so "not sent" would be false.
 */
export const transferSentFailureTitle = (): string => t("send.failure.title.sentFailed");

/**
 * Heading of the receipt when the submission's reply was lost: it may or may
 * not be on chain, so neither "not sent" nor "failed" is true.
 */
export const transferUnknownTitle = (): string => t("send.failure.title.unknown");

/** Default reason for a submitted transaction that failed without its own message. */
export const transferSentFailureReason = (): string => t("send.failure.sentReason");

/** The working screen's title while a reviewed transfer is being sent. */
export const transferWorkingTitle = (mode: TransferMode): string => t(`send.mode.${mode}.working`);

/**
 * The copy table for one mode. Total over the union, so no caller falls back
 * to "Send" by accident.
 */
export const transferModeCopy = (mode: TransferMode): TransferModeCopy => copyFor(mode);

/**
 * Human-readable header title for the current Send checkpoint, in the mode's
 * own words. The recipient step is only reachable as a send — a shield has
 * nobody to choose — and the stage's own "Send to" label names the step, so the
 * header stays the verb rather than repeating it.
 */
export const transferStageTitle = (stage: TransferStage, mode: TransferMode = "send"): string => {
  const copy = copyFor(mode);
  if (stage === "recipient") return copy.noun;
  if (stage === "details" || stage === "reviewing") return copy.noun;
  // The review step's header is signing text: English until the review moves.
  if (stage === "review") return `Review ${copy.verb}`;
  // Authorizing, broadcasting and confirming are one wait as far as the reader
  // is concerned: the wallet is sending, and the steps between are its own.
  if (stage === "authorizing" || stage === "broadcasting" || stage === "confirming") {
    return copy.progressive;
  }
  if (stage === "pending") return t("send.stage.pending");
  if (stage === "submitted") return t("send.stage.confirmed");
  return t(`send.mode.${mode}.failed`);
};

/**
 * One-line receipt for a settled transaction: what moved, and where. A shield
 * or unshield names the bucket the value landed in rather than "sent to" the
 * account that already owned it.
 */
export const transferSuccessSummary = (
  mode: TransferMode,
  amount: string,
  symbol: string,
  recipientLabel: string,
): string => {
  if (mode === "shield") return t("send.receipt.shielded", { amount, symbol });
  if (mode === "unshield") return t("send.receipt.unshielded", { amount, symbol });
  return t("send.receipt.sentTo", { amount, recipient: recipientLabel, symbol });
};
