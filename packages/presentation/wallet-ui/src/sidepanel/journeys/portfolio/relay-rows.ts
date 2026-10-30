/**
 * The Activity dock's "Signed for relay" list (issue 299): OutsideExecution
 * messages this device signed for a site or relayer. They sit above the
 * transaction feed and never inside it: a signed message is not a transaction, has
 * no transaction hash or explorer page, and is never filtered, sorted or
 * exported as one. Each row says only what the record proves — signed, its
 * nonce used on chain, or past its deadline unused. A used nonce does not prove
 * this message ran: a dapp chooses the nonce, so another message may share it.
 */
import { escapeHtml } from "@bramble/core/html";
import { formatTokenAmount } from "@bramble/starknet/rpc";
import type { RelaySignature } from "@bramble/transactions/relay-signatures";
import { icon } from "../../shared/icons";
import { formatUtcClock, formatUtcDate } from "../../shared/timestamp";

// The meta word beside the site, and the row glyph's status hue.
const META: Readonly<Record<RelaySignature["status"], string>> = {
  "nonce-used": "Nonce used on chain",
  expired: "Expired",
  signed: "Not seen on chain",
};

const HUE: Readonly<Record<RelaySignature["status"], string>> = {
  "nonce-used": "accepted",
  expired: "",
  signed: "pending",
};

// The one sentence the expansion adds about the status.
const statusNote = (relay: RelaySignature): string => {
  if (relay.status === "nonce-used") {
    return "Its nonce is used on chain, so this request can no longer run. Bramble can't confirm it was this request that ran.";
  }
  if (relay.status === "expired") {
    return "It passed its deadline unused and can no longer run.";
  }
  if (!relay.checkable) {
    return "Bramble can't check relayed requests for this account type.";
  }
  // A failed or never-made read leaves a row signed, so this must hold whatever
  // the last read said: no claim that the chain was checked.
  return relay.executeBefore === undefined
    ? "Not seen on chain yet. A relayer may still be able to submit it."
    : "Not seen on chain yet. A relayer may still be able to submit it until it expires.";
};

const when = (epochMs: number): string =>
  [formatUtcDate(epochMs), formatUtcClock(epochMs)].filter((part) => part !== null).join(", ");

const detail = (term: string, value: string): string =>
  value === "" ? "" : `<div><dt>${escapeHtml(term)}</dt><dd>${value}</dd></div>`;

/** Renders one signed-for-relay record as an expandable Activity row. */
export const relayRow = (relay: RelaySignature): string => {
  const meta = relay.status === "signed" && !relay.checkable ? "Not tracked" : META[relay.status];
  const deadline =
    relay.executeBefore === undefined ? "" : escapeHtml(when(relay.executeBefore * 1000));
  const fee = relay.userFee;
  let feeText = "";
  if (fee) {
    try {
      feeText = `${formatTokenAmount(BigInt(fee.amount), fee.decimals)} ${fee.token}`;
    } catch {
      feeText = "";
    }
  }
  return `
  <li class="tx-row relay-row">
    <details class="disclosure tx-disclosure" data-disclosure="relay:${escapeHtml(relay.messageHash)}">
      <summary aria-label="Signed for ${escapeHtml(relay.origin)}. ${escapeHtml(meta)}">
        <span class="tx-kind-icon ${HUE[relay.status]}" aria-hidden="true">${icon("keyRound")}</span>
        <span class="tx-copy"><strong class="tx-title">${escapeHtml(relay.origin)}</strong></span>
        <span class="tx-meta ${HUE[relay.status]}">${escapeHtml(meta)}</span>
        <span class="disclosure-mark">${icon("chevronRight")}</span>
      </summary>
      <div class="disclosure-body">
        <dl class="request-detail">
          ${detail("Status", escapeHtml(statusNote(relay)))}
          ${detail("Calls", String(relay.callCount))}
          ${detail("Signed", escapeHtml(when(relay.signedAt)))}
          ${detail("Valid until", deadline)}
          ${detail("Network fee", escapeHtml(feeText))}
          ${detail("Message hash", `<code class="tx-hash is-plain" title="${escapeHtml(relay.messageHash)}">${escapeHtml(relay.messageHash)}</code>`)}
        </dl>
      </div>
    </details>
  </li>`;
};

/**
 * Renders the "Signed for relay" section, or nothing when there are no
 * records. Its rows sit outside `#activity-feed`, so the feed's filters and
 * search never hide or count them.
 */
export const relaySection = (relays: readonly RelaySignature[]): string =>
  relays.length === 0
    ? ""
    : `<section class="section tx-day relay-section" aria-label="Signed for relay">
      <h3 class="tx-day-label">Signed for relay</h3>
      <ul class="tx-list">${relays.map(relayRow).join("")}</ul>
    </section>`;
