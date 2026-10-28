/**
 * The gasless offers a send review just produced, held in the worker until
 * that send is submitted. The side panel's message may name which offer, but
 * the amount, decimals, label, and token are the ones stored here.
 */

import type { GaslessFeeOffer } from "@bramble/privacy/gasless-request";
import type { FeeEstimate } from "@bramble/starknet/fee-bounds";
import { sameFelt } from "@bramble/wallet-model/networks";

/**
 * One reviewed public send and the fee choices the background quoted for it.
 */
export type HeldGaslessSend = {
  readonly accountId: string;
  readonly amount: string;
  readonly offers: readonly GaslessFeeOffer[];
  readonly recipient: string;
  readonly speed: "fast" | "standard";
  /** The STRK estimate this review used for the token ceiling. */
  readonly strkFee: FeeEstimate | null;
  readonly tokenId: string;
};

let held: HeldGaslessSend | null = null;

/**
 * Replaces the held send review. A later review drops the previous one, so a
 * stale offer cannot be submitted for a different transfer.
 */
export const rememberGaslessSendReview = (review: HeldGaslessSend): void => {
  held = review;
};

/**
 * Drops the held review. Tests use this so cases do not share a worker slot.
 */
export const clearGaslessSendReview = (): void => {
  held = null;
};

const sameTransfer = (
  review: HeldGaslessSend,
  transfer: Omit<HeldGaslessSend, "offers" | "strkFee">,
): boolean =>
  review.accountId === transfer.accountId &&
  review.amount === transfer.amount &&
  review.speed === transfer.speed &&
  review.tokenId === transfer.tokenId &&
  sameFelt(review.recipient, transfer.recipient);

const sameOffer = (offer: GaslessFeeOffer, echoed: GaslessFeeOffer): boolean =>
  offer.amount === echoed.amount &&
  offer.decimals === echoed.decimals &&
  offer.label === echoed.label &&
  sameFelt(offer.tokenAddress, echoed.tokenAddress);

/**
 * The stored offer matching this send, or null when the message does not name
 * one this review produced. A match is consumed, so it cannot be submitted twice.
 */
export const takeMatchingGaslessSend = (
  transfer: Omit<HeldGaslessSend, "offers" | "strkFee">,
  echoed: GaslessFeeOffer,
): { readonly offer: GaslessFeeOffer; readonly strkFee: FeeEstimate | null } | null => {
  const review = held;
  if (review === null || !sameTransfer(review, transfer)) {
    return null;
  }
  const offer = review.offers.find((candidate) => sameOffer(candidate, echoed));
  if (offer === undefined) {
    return null;
  }
  held = null;
  return { offer, strkFee: review.strkFee };
};
