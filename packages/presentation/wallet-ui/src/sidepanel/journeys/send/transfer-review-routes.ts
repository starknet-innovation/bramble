/**
 * Route-keyed review blocks: the fee lines a route actually charges, and what it
 * publishes on Starknet.
 *
 * Every charge leaves the sending account, and always the bucket the send comes
 * from: an account route pays network gas — and, on a deposit, the pool's
 * per-batch charge — out of the public balance, while a relayed route pays the
 * pool charge out of the private balance with the paymaster sponsoring gas.
 * Deriving both blocks from the route rather than from three separate review
 * screens is what stops a pool charge being billed as a relay price again.
 */

import { escapeHtml } from "@bramble/core/html";
import type { SendDisclosure, SendRoute } from "@bramble/transactions/send-routes";
import { formatFri } from "../../shared/parts";
import { reviewCostSection, reviewFeeSection } from "../../shared/review-render";
import { isStrkRelayFee, relayFeeAmountText } from "../privacy/privacy-relay-fee";
import type { PrivacyPreparation } from "../privacy/privacy-runtime";
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
  return `<section class="decision-layer" aria-label="Visibility">
    <p class="decision-label">Visibility</p>
    <p class="review-fee">${escapeHtml(`${movement}${clause(hidden, "confidential")}${clause(shown, "public")}`)}</p>
  </section>`;
};

/**
 * The review state the fee lines are built from.
 */
export type RouteFeeState = {
  readonly poolFeeFri?: string;
  readonly preparation: PrivacyPreparation | null;
  readonly review: TransferReview | null;
};

const feeLine = (label: string, value: string): string =>
  `<p class="review-fee">${escapeHtml(label)}: ${escapeHtml(value)}</p>`;

// What the relay withdraws beyond the pool's own charge. `null` when the two
// cannot be compared, so no split is invented from an unusable pair.
const relayCut = (total: string, poolFeeFri: string): bigint | null => {
  try {
    const cut = BigInt(total) - BigInt(poolFeeFri);
    return cut < 0n ? null : cut;
  } catch {
    return null;
  }
};

// "Estimated fee" names the network fee on every route, so the label means one
// thing in all four flows. A relayed route pays no gas — the paymaster sponsors
// it, and the sender's only broadcast cost is whatever the relay keeps above the
// pool's charge. A deposit's gas is not knowable here at all: its proof, and so
// the calldata being estimated, is built at submission.
const networkFeeHtml = (
  route: SendRoute,
  state: RouteFeeState,
  poolFee: string,
  poolFeeFri: string | undefined,
): string => {
  if (route.submission === "relay") {
    const relayFee = state.preparation?.relayFee;
    if (relayFee !== undefined && !isStrkRelayFee(relayFee)) {
      // A fee converted out of STRK covers the pool's STRK charge, which the
      // relay pays, but cannot be split against it or added to it: the two are
      // in different tokens. It is reported whole, in its own token.
      return reviewCostSection(
        feeLine("Fee taken from your private balance", relayFeeAmountText(relayFee)),
      );
    }
    const total = relayFee?.amount;
    const cut =
      total !== undefined && state.poolFeeFri !== undefined
        ? relayCut(total, state.poolFeeFri)
        : null;
    if (total !== undefined && cut === null) {
      // The withdrawal does not decompose against the known pool fee, so it is
      // reported whole rather than split into parts that were guessed.
      return reviewCostSection(
        `${feeLine("Fee taken from your private balance", formatFri(total))}${poolFee}`,
      );
    }
    // A sponsored route costs the pool charge and nothing else, so its total
    // would only repeat the line above it.
    const network = cut === null || cut === 0n ? null : `0x${cut.toString(16)}`;
    return reviewCostSection(
      `${feeLine("Estimated fee", network === null ? "Sponsored" : formatFri(network))}${poolFee}${
        network !== null && poolFeeFri !== undefined
          ? feeLine(
              "Total fees",
              formatFri(`0x${(BigInt(network) + BigInt(poolFeeFri)).toString(16)}`),
            )
          : ""
      }`,
    );
  }
  const estimate = state.review
    ? reviewFeeSection(
        state.review,
        { id: "review-retry-fee" },
        // The pool charge goes in as a figure as well as a line, so the section
        // can state what the two come to together.
        { extra: poolFee, rule: false, ...(poolFeeFri === undefined ? {} : { poolFeeFri }) },
      )
    : "";
  return (
    estimate || reviewCostSection(`${feeLine("Estimated fee", "charged at submission")}${poolFee}`)
  );
};

// The pool's per-batch charge, always named separately and always attributed to
// the balance it leaves. Keeping it off the "Estimated fee" line is what stops a
// protocol charge reading as network gas or as the relay's price.
const poolFeeHtml = (route: SendRoute, poolFeeFri?: string): string =>
  route.poolFeeRequired && route.feeBucket !== "none" && poolFeeFri !== undefined
    ? feeLine("Pool fee", `${formatFri(poolFeeFri)} from your ${route.feeBucket} balance`)
    : "";

/**
 * Renders the fee lines for one route: the network fee, then the pool's charge
 * when the route pays one.
 *
 * Both lines are present on every route that incurs them and carry the same
 * labels throughout, so the four flows read alike — the previous rendering gave
 * a deposit no network-fee line at all and named the relayed routes' charges
 * differently again.
 */
export const routeFeeHtml = (route: SendRoute, state: RouteFeeState): string => {
  const poolFeeFri =
    route.submission === "account" ? state.preparation?.poolFeeFri : state.poolFeeFri;
  const charged = route.poolFeeRequired && route.feeBucket !== "none" ? poolFeeFri : undefined;
  return networkFeeHtml(route, state, poolFeeHtml(route, poolFeeFri), charged);
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
