/**
 * Shared decoded-transfer review markup used by Send and NFT transfer flows.
 */
import { escapeHtml } from "../shared/html";
import { accountLabel, formatFri } from "./parts";
import { reviewCallsList, reviewFeeSection, reviewPanel, riskFlagMessages } from "./review-render";
import type { SidepanelWallet } from "./runtime";
import { tokenGlyph } from "./token-row";
import type { TransferFields } from "./transfer-model";

type TransferReview = Awaited<ReturnType<SidepanelWallet["reviewTransfer"]>>;

/**
 * Renders the confirm-face summary: the amount with its fiat estimate, and who
 * receives it.
 */
export const reviewSummaryHtml = (fields: TransferFields): string => `
  <div class="send-review-hero">
    <span class="send-review-token">${tokenGlyph(fields.tokenAddress, fields.tokenSymbol)}</span>
    <span><strong>${escapeHtml(fields.amount)} ${escapeHtml(fields.tokenSymbol)}</strong><small>${escapeHtml(fields.fiatEstimate || "Fiat estimate unavailable")}</small></span>
  </div>
  <dl class="send-review-facts">
    <div><dt>Recipient</dt><dd><strong>${escapeHtml(fields.recipientLabel || accountLabel(fields.recipient))}</strong><code>${escapeHtml(accountLabel(fields.recipient))}</code></dd></div>
  </dl>`;

const feeLine = (label: string, value: string): string =>
  `<p class="review-fee">${escapeHtml(label)}: ${escapeHtml(value)}</p>`;

const feeDifference = (total: string, poolFeeFri: string): bigint | null => {
  try {
    const relay = BigInt(total) - BigInt(poolFeeFri);
    return relay < 0n ? null : relay;
  } catch {
    return null;
  }
};

/**
 * Renders the fee lines for a private send. The relay withdraws one amount from
 * the sender's shielded balance, and that amount is not all the relay's: the
 * privacy pool charges a fixed fee per action batch (`get_fee_amount`) which the
 * relay pays on the sender's behalf. Splitting them keeps the pool's protocol
 * charge from reading as the relay's price.
 *
 * With no pool fee known, or a fee action smaller than it, the total is shown as
 * a single unattributed line rather than an invented split.
 */
export const privateRelayFeeHtml = (
  relayFee: { readonly amount: string },
  poolFeeFri?: string,
): string => {
  const relay = poolFeeFri === undefined ? null : feeDifference(relayFee.amount, poolFeeFri);
  if (relay === null || poolFeeFri === undefined) {
    return feeLine("Fee taken from your private balance", formatFri(relayFee.amount));
  }
  return `${feeLine("Pool fee", formatFri(poolFeeFri))}${feeLine(
    "Relay fee",
    relay === 0n ? "Sponsored" : formatFri(`0x${relay.toString(16)}`),
  )}`;
};

/**
 * Renders the transfer fee state — the estimated amount, the pending-deployment
 * note, or the failed-estimate alert with its retry affordance (`""` when no
 * state applies). Delegates to the shared `reviewFeeSection` so every confirm
 * surface that promotes the fee — Send, NFT transfer, and the dApp invoke
 * card — renders one wording and one formatting (issues 189 and 190). Dynamic
 * copy is escaped before rendering.
 */
export const reviewFeeHtml = (review: TransferReview): string =>
  reviewFeeSection(review, { id: "review-retry-fee" });

/**
 * Renders decoded calls, risk flags, and deployment context without the fee
 * state, for surfaces that promote `reviewFeeHtml` onto their always-visible
 * confirm face. All untrusted review copy passes through the shared escaped
 * renderers.
 */
export const reviewDetailsHtml = (review: TransferReview): string =>
  `${reviewCallsList(review.summaries)}${reviewPanel([
    ...riskFlagMessages(review.flags),
    ...(review.requiresDeployment
      ? ["This account is not deployed yet; the first send also submits its deployment."]
      : []),
  ])}`;

/**
 * Renders decoded calls, risk flags, deployment context, and fee state. All
 * untrusted review copy passes through the shared escaped renderers.
 */
export const reviewPanelHtml = (review: TransferReview): string =>
  `${reviewDetailsHtml(review)}${reviewFeeHtml(review)}`;
