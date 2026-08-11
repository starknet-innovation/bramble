/**
 * Selectable rows for accounts a recovery phrase already has on chain.
 *
 * Shared by setup and the accounts surface so a discovered account looks and
 * reads the same wherever it is offered, and so neither surface can drift into
 * describing the same on-chain fact differently.
 *
 * Pure markup. All dynamic text is escaped; selection state and clicks belong to
 * the binding that renders these.
 */

import { escapeHtml } from "@mc-wallet/core/html";
import type { SeedScanCandidate } from "../../../popup/responses/responses";
import { icon } from "../../shared/icons";
import { accountLabel } from "../../shared/parts";

/**
 * Why this account is being offered, in the user's terms.
 *
 * Deployed and funded are different facts and the distinction matters: a deployed
 * account has transacted, while a funded-but-undeployed one holds value at an
 * address that has never been activated. Both are reasons to restore it.
 */
const reasonFor = (candidate: SeedScanCandidate): string => {
  if (candidate.deployed) {
    return "Already active on chain";
  }
  return candidate.funded ? "Holds a balance" : "Found on chain";
};

/**
 * Renders one selectable discovered-account row.
 *
 * `selected` drives `aria-pressed`, which is what the binding reads back — the
 * DOM holds the selection, so no separate copy of it can go stale. An account the
 * wallet already holds renders disabled rather than hidden, so a user comparing
 * the list against their own memory can see it was found and accounted for.
 */
export const discoveredAccountRow = (
  candidate: SeedScanCandidate,
  selected: boolean,
): string => `<button
    class="onboarding-account"
    data-discovered-index="${candidate.accountIndex}"
    type="button"
    aria-pressed="${selected}"
    ${candidate.alreadyAdded ? "disabled" : ""}
  >
    <span class="onboarding-account-avatar">${String(candidate.accountIndex + 1).padStart(2, "0")}</span>
    <span class="onboarding-account-copy">
      <strong>Account ${candidate.accountIndex + 1}</strong>
      <span>${escapeHtml(accountLabel(candidate.address))}</span>
      <small>${escapeHtml(candidate.alreadyAdded ? "Already in this wallet" : reasonFor(candidate))}</small>
    </span>
    <span class="onboarding-account-check">${icon("check")}</span>
  </button>`;

/**
 * Renders the discovered-account list, selecting every row by default.
 *
 * Default-selected because every candidate has on-chain evidence behind it, so
 * the common case is wanting all of them; the user unselects what they do not
 * want rather than hunting for what they do. Already-held accounts are never
 * counted as selected — they cannot be added twice.
 */
export const discoveredAccountList = (
  candidates: readonly SeedScanCandidate[],
  selected: ReadonlySet<number>,
): string =>
  candidates
    .map((candidate) => discoveredAccountRow(candidate, selected.has(candidate.accountIndex)))
    .join("");
