/**
 * The side panel watch-asset card, and its close-only already-tracked notice.
 * Split from approval-cards.ts to keep each file within the size budget.
 */

import { escapeHtml } from "@bramble/core/html";
import { type SpamReason, tokenSpamReasons } from "@bramble/portfolio/token-registry";
import { addressLabel, STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import type { PendingApproval } from "../../../popup/responses/responses";
import { inlineCopyButton } from "../../shared/parts";
import { reviewConstraints, reviewOutcome, reviewPanel } from "../../shared/review-render";
import { tokenGlyph } from "../portfolio/token-row";
import { decisionRow, denyButton, requestIdentity } from "./approval-card-parts";

const SPAM_WARNINGS: Readonly<Record<SpamReason, string>> = {
  "absurd-decimals": "This token reports an implausible number of decimals.",
  "empty-name": "This token has no name.",
  "symbol-spoof": "This token uses the ticker of a different, known token contract.",
};

const watchAssetWarnings = (token: NonNullable<PendingApproval["token"]>): readonly string[] => {
  const reasons = tokenSpamReasons(token);
  return reasons.length === 0
    ? []
    : [
        ...reasons.map((reason) => SPAM_WARNINGS[reason]),
        "If added, it stays hidden until you show it.",
      ];
};

// Reuses the approved duplicate-account badge wording.
const ALREADY_TRACKED_NOTICE = "Already in this wallet";

// The token is already tracked: nothing to add, so the card is a close-only
// notice. Closing it is when the site gets its answer (audit M1).
const watchAssetTrackedCard = (
  approval: PendingApproval,
  token: NonNullable<PendingApproval["token"]>,
): string => `
  <li class="request-card" data-approval-notice>
    <div class="request-copy">
      ${requestIdentity(approval.origin, "Add token request")}
      <dl class="request-detail"><div><dt>Token</dt><dd class="request-token">${tokenGlyph(token.address, token.symbol)}<strong>${escapeHtml(token.symbol)}</strong></dd></div><div><dt>Address</dt><dd><code title="${escapeHtml(token.address)}">${escapeHtml(addressLabel(token.address))}</code>${inlineCopyButton(token.address, "Copy token address")}</dd></div></dl>
      <p>${escapeHtml(ALREADY_TRACKED_NOTICE)}</p>
    </div>
    <div class="button-row">${denyButton(approval, "Close")}</div>
  </li>`;

// With NFTs turned off the card can only be closed, which answers the site as
// a decline. The site cannot tell this from a decline.
const NFTS_OFF_NOTICE =
  "NFTs are turned off. Turn on Show NFTs on Home in Appearance & currency to watch one.";

// A site asked to watch a collectible (ahead of the Starknet wallet API). The
// wallet re-proves ownership on approve, so the card promises only that check.
const watchNftCard = (
  approval: PendingApproval,
  nft: NonNullable<PendingApproval["nft"]>,
  preview: boolean,
): string => `
  <li class="request-card"${preview ? "" : " data-approval-notice"}>
    <div class="request-copy">
      ${requestIdentity(approval.origin, "Watch NFT request")}
      <dl class="request-detail"><div><dt>Contract</dt><dd><code>${escapeHtml(nft.contract)}</code>${inlineCopyButton(nft.contract, "Copy contract address")}</dd></div><div><dt>Token ID</dt><dd><code>${escapeHtml(nft.tokenId)}</code></dd></div><div><dt>Network</dt><dd>${escapeHtml(STARKNET_NETWORKS[nft.networkId].name)}</dd></div></dl>
      ${
        preview
          ? reviewOutcome("Show this NFT on Home once Bramble confirms this account owns it.")
          : `<p>${escapeHtml(NFTS_OFF_NOTICE)}</p>`
      }
    </div>
    ${
      preview
        ? `${reviewPanel(approval.insights ?? [])}
    ${reviewConstraints("No transaction is signed and no network fee is charged.")}
    ${decisionRow(approval, "Watch NFT", false)}`
        : `<div class="button-row">${denyButton(approval, "Close")}</div>`
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
      ${requestIdentity(approval.origin, "Add token request")}
      <dl class="request-detail"><div><dt>Token</dt><dd class="request-token">${tokenGlyph(token.address, token.symbol)}<strong>${escapeHtml(token.symbol)}</strong></dd></div><div><dt>Name</dt><dd>${escapeHtml(token.name)}</dd></div><div><dt>Address</dt><dd><code title="${escapeHtml(token.address)}">${escapeHtml(addressLabel(token.address))}</code>${inlineCopyButton(token.address, "Copy token address")}</dd></div></dl>
      ${reviewOutcome("Add this token contract to the wallet's tracked asset list.")}
    </div>
    ${reviewPanel([...watchAssetWarnings(token), ...(approval.insights ?? [])])}
    ${reviewConstraints("No transaction is signed and no network fee is charged.")}
    ${decisionRow(approval, "Add token", false)}
  </li>`;
};
