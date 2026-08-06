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
  amount: "the amount",
  recipient: "the recipient",
  sender: "your address",
};

const ORDER: readonly SendDisclosure[] = ["sender", "recipient", "amount"];

const sentence = (parts: readonly string[]): string =>
  parts.length <= 1
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

/**
 * Describes what a route puts on chain, built from the route's own disclosure
 * list so the copy cannot drift from the table.
 *
 * Rendered only for routes that call the pool: a plain public transfer publishes
 * everything and always has, so annotating it would add noise to the common case
 * rather than tell anyone something new.
 */
export const routeDisclosureHtml = (route: SendRoute): string => {
  if (route.id === "public-public") {
    return "";
  }
  const shown = ORDER.filter((item) => route.reveals.includes(item));
  if (shown.length === 0) {
    return '<p class="send-review-note">Nothing about this transfer is published on Starknet.</p>';
  }
  const hidden = ORDER.filter((item) => !route.reveals.includes(item));
  const published = `Published on Starknet: ${sentence(shown.map((item) => DISCLOSURE_LABELS[item]))}.`;
  const withheld =
    hidden.length === 0
      ? ""
      : ` Not published: ${sentence(hidden.map((item) => DISCLOSURE_LABELS[item]))}.`;
  return `<p class="send-review-note">${escapeHtml(`${published}${withheld}`)}</p>`;
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
