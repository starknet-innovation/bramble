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
import { t, th } from "../../../i18n/messages";
import { icon } from "../../shared/icons";
import { formatUtcClock, formatUtcDate } from "../../shared/timestamp";

// The meta word beside the site.
const meta = (relay: RelaySignature): string =>
  relay.status === "nonce-used"
    ? t("portfolio.relay.nonceUsed")
    : relay.status === "expired"
      ? t("portfolio.relay.expired")
      : relay.checkable
        ? t("portfolio.relay.notSeen")
        : t("portfolio.relay.notTracked");

// The row glyph's status hue.

const HUE: Readonly<Record<RelaySignature["status"], string>> = {
  "nonce-used": "accepted",
  expired: "",
  signed: "pending",
};

// The one sentence the expansion adds about the status.
const statusNote = (relay: RelaySignature): string => {
  if (relay.status === "nonce-used") {
    return t("portfolio.relay.nonceUsedNote");
  }
  if (relay.status === "expired") {
    return t("portfolio.relay.expiredNote");
  }
  if (!relay.checkable) {
    return t("portfolio.relay.uncheckableNote");
  }
  // A failed or never-made read leaves a row signed, so this must hold whatever
  // the last read said: no claim that the chain was checked.
  return relay.executeBefore === undefined
    ? t("portfolio.relay.pendingNote")
    : t("portfolio.relay.pendingUntilNote");
};

const when = (epochMs: number): string =>
  [formatUtcDate(epochMs), formatUtcClock(epochMs)].filter((part) => part !== null).join(", ");

const detail = (term: string, value: string): string =>
  value === "" ? "" : `<div><dt>${escapeHtml(term)}</dt><dd>${value}</dd></div>`;

/** Renders one signed-for-relay record as an expandable Activity row. */
export const relayRow = (relay: RelaySignature): string => {
  const status = meta(relay);
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
      <summary aria-label="${th("portfolio.relay.rowLabel", { origin: relay.origin, status })}">
        <span class="tx-kind-icon ${HUE[relay.status]}" aria-hidden="true">${icon("keyRound")}</span>
        <span class="tx-copy"><strong class="tx-title">${escapeHtml(relay.origin)}</strong></span>
        <span class="tx-meta ${HUE[relay.status]}">${escapeHtml(status)}</span>
        <span class="disclosure-mark">${icon("chevronRight")}</span>
      </summary>
      <div class="disclosure-body">
        <dl class="request-detail">
          ${detail(t("portfolio.activity.status"), escapeHtml(statusNote(relay)))}
          ${detail(t("portfolio.relay.calls"), String(relay.callCount))}
          ${detail(t("portfolio.relay.signed"), escapeHtml(when(relay.signedAt)))}
          ${detail(t("portfolio.relay.validUntil"), deadline)}
          ${detail(t("portfolio.activity.networkFee"), escapeHtml(feeText))}
          ${detail(t("portfolio.relay.messageHash"), `<code class="tx-hash is-plain" title="${escapeHtml(relay.messageHash)}">${escapeHtml(relay.messageHash)}</code>`)}
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
    : `<section class="section tx-day relay-section" aria-label="${th("portfolio.relay.title")}">
      <h3 class="tx-day-label">${th("portfolio.relay.title")}</h3>
      <ul class="tx-list">${relays.map(relayRow).join("")}</ul>
    </section>`;
