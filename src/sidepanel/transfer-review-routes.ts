/**
 * Route-keyed review blocks: the fee lines a route actually charges, and what it
 * publishes on Starknet.
 *
 * The four routes pay differently — a public transfer pays network gas only, a
 * deposit pays gas plus the pool's per-batch STRK charge out of the public
 * balance, and the two relayed routes pay the pool charge out of the private
 * balance with the relay covering gas. Deriving both blocks from the route
 * rather than from three separate review screens is what stops a pool charge
 * being billed as a relay price again.
 */

import { escapeHtml } from "../shared/html";
import type { SendDisclosure, SendRoute } from "../starknet/send-routes";
import { formatFri } from "./parts";
import type { PrivacyPreparation } from "./privacy-runtime";
import { reviewFeeSection } from "./review-render";
import { privateRelayFeeHtml } from "./transfer-review-markup";
import type { TransferReview } from "./transfer-submit";

const DISCLOSURE_LABELS: Readonly<Record<SendDisclosure, string>> = {
  amount: "amount",
  recipient: "recipient address",
  sender: "sender address",
};

// Sender, amount, recipient: the order the sentences read most naturally in.
const ORDER: readonly SendDisclosure[] = ["sender", "amount", "recipient"];

const sentence = (parts: readonly string[]): string =>
  parts.length <= 1
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

const clause = (items: readonly SendDisclosure[], predicate: string): string =>
  items.length === 0
    ? ""
    : ` ${sentence(items.map((item) => DISCLOSURE_LABELS[item])).replace(/^./, (first) => first.toUpperCase())} ${items.length === 1 ? "is" : "are"} ${predicate}.`;

/**
 * States what the composed route does with the value and what it exposes, built
 * from the route's own buckets and disclosure list so the copy cannot drift from
 * the table.
 *
 * Every route gets a line, including a plain public transfer: "nothing is
 * private here" is worth saying once the wallet can also do otherwise.
 */
export const routeDisclosureHtml = (route: SendRoute): string => {
  const hidden = ORDER.filter((item) => !route.reveals.includes(item));
  const shown = ORDER.filter((item) => route.reveals.includes(item));
  const movement = `You are sending from a ${route.source} balance to a ${route.destination} balance.`;
  return `<p class="review-fee">${escapeHtml(`${movement}${clause(hidden, "confidential")}${clause(shown, "public")}`)}</p>`;
};

/**
 * Renders the fee lines for one route.
 *
 * A relayed route reports what the relay withdraws, split into the pool's charge
 * and the relay's own cut. A deposit adds the pool charge to the account's own
 * network-fee estimate, because both leave the public balance in the same
 * transaction. A public transfer is the estimate alone.
 */
export const routeFeeHtml = (
  route: SendRoute,
  state: {
    readonly poolFeeFri?: string;
    readonly preparation: PrivacyPreparation | null;
    readonly review: TransferReview | null;
  },
): string => {
  if (state.preparation?.relayFee) {
    return privateRelayFeeHtml(state.preparation.relayFee, state.poolFeeFri);
  }
  const estimate = state.review ? reviewFeeSection(state.review, { id: "review-retry-fee" }) : "";
  if (route.feeBucket !== "public" || !state.poolFeeFri) {
    return estimate;
  }
  // Neutral, not an alert: it is a protocol charge like any other fee line.
  return `${estimate}<p class="review-fee">${escapeHtml(
    `${formatFri(state.poolFeeFri)} is deducted from your public balance to cover pool fees`,
  )}</p>`;
};

/**
 * The fee lines followed by the disclosure, which is what the review screen
 * shows: the cost of the move and its consequences read as one block, directly
 * under the estimate rather than folded away in transaction details.
 */
export const routeReviewFeeHtml = (
  route: SendRoute,
  state: {
    readonly poolFeeFri?: string;
    readonly preparation: PrivacyPreparation | null;
    readonly review: TransferReview | null;
  },
): string => `${routeFeeHtml(route, state)}${routeDisclosureHtml(route)}`;
