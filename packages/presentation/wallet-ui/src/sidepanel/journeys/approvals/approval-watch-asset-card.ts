/**
 * The side panel watch-asset card, and its close-only already-tracked notice.
 * Split from approval-cards.ts to keep each file within the size budget.
 */

import { escapeHtml } from "@bramble/core/html";
import { type SpamReason, tokenSpamReasons } from "@bramble/portfolio/token-registry";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { t, th } from "../../../i18n/messages";
import type { PendingApproval } from "../../../popup/responses/responses";
import { accountLabel, inlineCopyButton } from "../../shared/parts";
import { reviewConstraints, reviewOutcome, reviewPanel } from "../../shared/review-render";
import { tokenGlyph } from "../portfolio/token-row";
import { decisionRow, denyButton, requestIdentity } from "./approval-card-parts";

const spamWarning = (reason: SpamReason): string =>
  reason === "absurd-decimals"
    ? t("detail.watch.absurdDecimals")
    : reason === "empty-name"
      ? t("detail.watch.emptyName")
      : t("detail.watch.symbolSpoof");

const watchAssetWarnings = (token: NonNullable<PendingApproval["token"]>): readonly string[] => {
  const reasons = tokenSpamReasons(token);
  return reasons.length === 0 ? [] : [...reasons.map(spamWarning), t("detail.watch.hidden")];
};

// The token is already tracked: nothing to add, so the card is a close-only
// notice. Closing it is when the site gets its answer (audit M1).
const watchAssetTrackedCard = (
  approval: PendingApproval,
  token: NonNullable<PendingApproval["token"]>,
): string => `
  <li class="request-card" data-approval-notice>
    <div class="request-copy">
      ${requestIdentity(approval.origin, t("detail.watch.title"))}
      <dl class="request-detail"><div><dt>${th("detail.params.token")}</dt><dd class="request-token">${tokenGlyph(token.address, token.symbol)}<strong>${escapeHtml(token.symbol)}</strong></dd></div><div><dt>${th("detail.watch.address")}</dt><dd><code title="${escapeHtml(token.address)}">${escapeHtml(accountLabel(token.address))}</code>${inlineCopyButton(token.address, t("detail.watch.copyToken"))}</dd></div></dl>
      <p>${th("detail.watch.alreadyTracked")}</p>
    </div>
    <div class="button-row">${denyButton(approval, t("approval.card.close"))}</div>
  </li>`;

// With NFTs turned off the card can only be closed, which answers the site as
// a decline. The site cannot tell this from a decline.

// A site asked to watch a collectible (ahead of the Starknet wallet API). The
// wallet re-proves ownership on approve, so the card promises only that check.
const watchNftCard = (
  approval: PendingApproval,
  nft: NonNullable<PendingApproval["nft"]>,
  preview: boolean,
): string => `
  <li class="request-card"${preview ? "" : " data-approval-notice"}>
    <div class="request-copy">
      ${requestIdentity(approval.origin, t("detail.watch.nftTitle"))}
      <dl class="request-detail"><div><dt>${th("detail.params.contract")}</dt><dd><code>${escapeHtml(nft.contract)}</code>${inlineCopyButton(nft.contract, t("detail.watch.copyContract"))}</dd></div><div><dt>${th("detail.watch.tokenId")}</dt><dd><code>${escapeHtml(nft.tokenId)}</code></dd></div><div><dt>${th("approval.context.network")}</dt><dd>${escapeHtml(STARKNET_NETWORKS[nft.networkId].name)}</dd></div></dl>
      ${
        preview
          ? reviewOutcome(t("detail.watch.nftOutcome"))
          : `<p>${th("detail.watch.nftsOff")}</p>`
      }
    </div>
    ${
      preview
        ? `${reviewPanel(approval.insights ?? [])}
    ${reviewConstraints(t("approval.noFee"))}
    ${decisionRow(approval, t("detail.watch.nftAction"), false)}`
        : `<div class="button-row">${denyButton(approval, t("approval.card.close"))}</div>`
    }
  </li>`;

/**
 * Renders a watch-asset request: an add-token card, a close-only notice when
 * the wallet already tracks the token, or a watch-collectible card.
 */
export const watchAssetCard = (approval: PendingApproval, preview = false): string => {
  if (approval.nft) {
    return watchNftCard(approval, approval.nft, preview);
  }
  const token = approval.token;
  if (!token) {
    return "";
  }
  if (approval.alreadyTracked === true) {
    return watchAssetTrackedCard(approval, token);
  }
  return `
  <li class="request-card">
    <div class="request-copy">
      ${requestIdentity(approval.origin, t("detail.watch.title"))}
      <dl class="request-detail"><div><dt>${th("detail.params.token")}</dt><dd class="request-token">${tokenGlyph(token.address, token.symbol)}<strong>${escapeHtml(token.symbol)}</strong></dd></div><div><dt>${th("detail.watch.name")}</dt><dd>${escapeHtml(token.name)}</dd></div><div><dt>${th("detail.watch.address")}</dt><dd><code title="${escapeHtml(token.address)}">${escapeHtml(accountLabel(token.address))}</code>${inlineCopyButton(token.address, t("detail.watch.copyToken"))}</dd></div></dl>
      ${reviewOutcome(t("detail.watch.outcome"))}
    </div>
    ${reviewPanel([...watchAssetWarnings(token), ...(approval.insights ?? [])])}
    ${reviewConstraints(t("approval.noFee"))}
    ${decisionRow(approval, t("detail.watch.action"), false)}
  </li>`;
};
