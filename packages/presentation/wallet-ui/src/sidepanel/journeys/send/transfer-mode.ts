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
  /** Heading of the failure receipt. */
  readonly failureTitle: string;
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

const COPY: Readonly<Record<TransferMode, TransferModeCopy>> = {
  send: {
    amountLabel: "Amount to send",
    closeLabel: "Close Send",
    confirmLabel: "Confirm and send",
    failureTitle: "Send not completed",
    noun: "Send",
    preparing: "Preparing send",
    progressive: "Sending",
    progressLabel: "Send progress",
    reviewLabel: "Review send",
    reviewNote: "Confirm only if the recipient, amount, and decoded action are correct.",
    successTitle: "Send complete",
    verb: "send",
  },
  shield: {
    amountLabel: "Amount to shield",
    closeLabel: "Close Shield",
    confirmLabel: "Confirm and shield",
    failureTitle: "Shield not completed",
    noun: "Shield",
    preparing: "Preparing shield",
    progressive: "Shielding",
    progressLabel: "Shield progress",
    reviewLabel: "Review shield",
    reviewNote:
      "This moves value from your public balance into your private one. Confirm only if the amount and decoded action are correct.",
    successTitle: "Shield complete",
    verb: "shield",
  },
  unshield: {
    amountLabel: "Amount to unshield",
    closeLabel: "Close Unshield",
    confirmLabel: "Confirm and unshield",
    failureTitle: "Unshield not completed",
    noun: "Unshield",
    preparing: "Preparing unshield",
    progressive: "Unshielding",
    progressLabel: "Unshield progress",
    reviewLabel: "Review unshield",
    reviewNote:
      "This moves value from your private balance back into your public one. Confirm only if the amount and decoded action are correct.",
    successTitle: "Unshield complete",
    verb: "unshield",
  },
};

/**
 * The copy table for one mode. Total over the union, so no caller falls back
 * to "Send" by accident.
 */
export const transferModeCopy = (mode: TransferMode): TransferModeCopy => COPY[mode];

/**
 * Human-readable header title for the current Send checkpoint, in the mode's
 * own words. The recipient step is only reachable as a send — a shield has
 * nobody to choose — so it keeps its "Send to" prompt.
 */
export const transferStageTitle = (stage: TransferStage, mode: TransferMode = "send"): string => {
  const copy = COPY[mode];
  if (stage === "recipient") return mode === "send" ? "Send to" : copy.noun;
  if (stage === "details" || stage === "reviewing") return copy.noun;
  if (stage === "review") return `Review ${copy.verb}`;
  if (stage === "authorizing") return `Authorize ${copy.verb}`;
  if (stage === "broadcasting") return copy.progressive;
  if (stage === "confirming") return "Confirming";
  if (stage === "pending") return "Confirmation pending";
  if (stage === "submitted") return "Confirmed";
  return `${copy.noun} failed`;
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
  if (mode === "shield") return `${amount} ${symbol} shielded into your private balance`;
  if (mode === "unshield") return `${amount} ${symbol} unshielded into your public balance`;
  return `${amount} ${symbol} sent to ${recipientLabel}`;
};
