/**
 * Shared decoded-transfer review markup used by Send and NFT transfer flows,
 * and the Send receipt shown once the transfer lands.
 */
import { escapeHtml } from "@bramble/core/html";
import type { SidepanelWallet } from "../../runtime/runtime";
import { accountLabel, inlineCopyButton } from "../../shared/parts";
import {
  reviewCallsList,
  reviewFeeSection,
  reviewPanel,
  riskFlagMessages,
} from "../../shared/review-render";
import { tokenGlyph } from "../portfolio/token-row";
import { type TransferMode, transferSuccessSummary } from "./transfer-mode";
import type { TransferFields } from "./transfer-model";

type TransferReview = Awaited<ReturnType<SidepanelWallet["reviewTransfer"]>>;

const BUCKET_NAMES = { private: "Private balance", public: "Public balance" } as const;

/**
 * Copy for a name-resolved recipient that is not already saved. A name is a
 * convenient spelling, not a saved contact, so the review says the address it
 * resolved to is new rather than only showing it.
 */
const NEW_RECIPIENT_WARNING = "New recipient. Check the full address before you send.";

/**
 * Renders the confirm-face summary in the order the decision is made: who it
 * leaves, who it reaches, how much. A shield or unshield has no recipient in
 * the payment sense (the account on both ends is the user's own), so it names
 * the account and the movement between its balances instead.
 *
 * The recipient shows truncated with a copy control carrying the full canonical
 * address, so the reviewer can check it against the source they were given. A
 * recipient that came from a Starknet name is the exception: the full address
 * the name resolved to is shown, with a line naming where it came from, because
 * the name alone does not carry the address the reader must check. The caller
 * binds `[data-copy]` after mounting (see ./transfer-render).
 */
export const reviewSummaryHtml = (
  fields: TransferFields,
  mode: TransferMode = "send",
  sender: { readonly address: string; readonly label: string } = { address: "", label: "" },
): string => {
  const copyLabel = mode === "send" ? "Copy recipient address" : "Copy account address";
  const recipientIdentity =
    fields.recipientResolvedFrom === "stark-name"
      ? `<span class="send-review-address send-review-address-full copy-line"><code title="${escapeHtml(fields.recipient)}">${escapeHtml(fields.recipient)}</code>${inlineCopyButton(fields.recipient, copyLabel)}</span><small class="send-review-source">Resolved from Starknet ID</small>`
      : `<span class="send-review-address copy-line"><code title="${escapeHtml(fields.recipient)}">${escapeHtml(accountLabel(fields.recipient))}</code>${inlineCopyButton(fields.recipient, copyLabel)}</span>`;
  return `
  <dl class="send-review-facts">
    <div><dt>From</dt><dd><strong>${escapeHtml(sender.label || accountLabel(sender.address))}</strong><span class="send-review-address"><code title="${escapeHtml(sender.address)}">${escapeHtml(accountLabel(sender.address))}</code></span></dd></div>
    <div><dt>${mode === "send" ? "To" : "Account"}</dt><dd><strong>${escapeHtml(fields.recipientLabel || accountLabel(fields.recipient))}</strong>${recipientIdentity}</dd></div>
    <div><dt>Amount</dt><dd><span class="send-review-amount">${tokenGlyph(fields.tokenAddress, fields.tokenSymbol)}<strong>${escapeHtml(fields.amount)} ${escapeHtml(fields.tokenSymbol)}</strong></span><small>${escapeHtml(fields.fiatEstimate || "Fiat estimate unavailable")}</small></dd></div>
    ${mode === "send" ? "" : `<div><dt>Movement</dt><dd><strong>${BUCKET_NAMES[fields.source]} → ${BUCKET_NAMES[fields.destination]}</strong></dd></div>`}
  </dl>`;
};

/**
 * Renders the transfer fee state — the estimated amount, the pending-deployment
 * note, or the failed-estimate alert with its retry affordance (`""` when no
 * state applies). Delegates to the shared `reviewFeeSection` so every confirm
 * surface that promotes the fee — Send, NFT transfer, and the dApp invoke
 * card — renders one wording and one formatting (issues 189 and 190). Dynamic
 * copy is escaped before rendering.
 */
const reviewFeeHtml = (review: TransferReview): string =>
  reviewFeeSection(review, { id: "review-retry-fee" });

/**
 * Renders only the warnings a review raised: the note that a name-resolved
 * recipient is not saved yet, risk flags, and the note that a first send also
 * deploys the account. Returns `""` when there is nothing to warn about, so the
 * confirm face stays quiet unless something needs saying. The decoded-call list
 * is not shown here: the summary above already names the recipient and amount
 * this transfer moves.
 */
export const reviewRisksHtml = (review: TransferReview, newResolvedRecipient = false): string => {
  const messages = [
    ...(newResolvedRecipient ? [NEW_RECIPIENT_WARNING] : []),
    ...riskFlagMessages(review.flags),
    ...(review.requiresDeployment
      ? ["This account is not deployed yet; the first send also submits its deployment."]
      : []),
  ];
  return messages.length === 0 ? "" : reviewPanel(messages, "");
};

/**
 * Renders decoded calls, risk flags, and deployment context without the fee
 * state, for surfaces that promote the fee onto their always-visible confirm
 * face. All untrusted review copy passes through the shared escaped renderers.
 */
const reviewDetailsHtml = (review: TransferReview): string =>
  `${reviewCallsList(review.summaries)}${reviewPanel(
    [
      ...riskFlagMessages(review.flags),
      ...(review.requiresDeployment
        ? ["This account is not deployed yet; the first send also submits its deployment."]
        : []),
    ],
    "No additional wallet warnings were detected. Verify the recipient and decoded action before confirming.",
  )}`;

/**
 * Decoded calls, risk flags, and the fee state together — the full technical
 * face, for surfaces that still show one. Send no longer does: its confirm face
 * carries the summary, the cost, and any warning directly.
 */
export const reviewPanelHtml = (review: TransferReview): string =>
  `${reviewDetailsHtml(review)}${reviewFeeHtml(review)}`;

// A truncated address beside a copy control carrying the full value, so the
// receipt reads as a sentence yet every party can still be checked exactly.
const receiptAddress = (address: string, copyLabel: string): string =>
  `<span class="send-receipt-address"><code title="${escapeHtml(address)}">${escapeHtml(accountLabel(address))}</code>${inlineCopyButton(address, copyLabel)}</span>`;

/**
 * Renders the Send receipt sentence: "<sender> sent <amount> to <recipient>",
 * each party named when a name is known and its address copyable. A shield or
 * unshield moves value within the user's own account, so it keeps the plain
 * own-account sentence. An empty sender address (no account on the form)
 * drops the subject rather than inventing one. All dynamic copy is escaped;
 * the caller binds `[data-copy]` after mounting.
 */
export const successReceiptHtml = (
  fields: TransferFields,
  sender: { readonly address: string; readonly label: string },
  mode: TransferMode,
): string => {
  const label = fields.recipientLabel || accountLabel(fields.recipient);
  if (mode !== "send") {
    return escapeHtml(transferSuccessSummary(mode, fields.amount, fields.tokenSymbol, label));
  }
  const amount = `<strong>${escapeHtml(fields.amount)} ${escapeHtml(fields.tokenSymbol)}</strong>`;
  const recipientName = fields.recipientLabel
    ? `<strong>${escapeHtml(fields.recipientLabel)}</strong> `
    : "";
  const senderName = sender.label ? `<strong>${escapeHtml(sender.label)}</strong> ` : "";
  const subject = sender.address
    ? `${senderName}${receiptAddress(sender.address, "Copy sender address")} sent`
    : "Sent";
  return `${subject} ${amount} to ${recipientName}${receiptAddress(fields.recipient, "Copy recipient address")}`;
};
