/**
 * "Your stakes" at the top of the staking list (issue 750): each position the
 * chain confirmed for this account, as one button that opens that validator's
 * own screen. Every figure is a background string from an on-chain read and is
 * escaped; a directory name, when the list already holds one, is third-party
 * text shown escaped beside the address.
 *
 * Absent while loading, with no route, or when a complete list is empty. A
 * failed read is one short line. An incomplete list says so, never "none".
 */

import { escapeHtml } from "@bramble/core/html";
import { localizeErrorCopy } from "../../../i18n/error-copy";
import { th } from "../../../i18n/messages";
import type { StakingState } from "./staking-directory-client";
import { stakingPositionCard } from "./staking-home";

/**
 * The "Your stakes" section for the list screen, or "" when there is nothing
 * to say.
 */
export const stakingPositionsSection = (state: StakingState): string => {
  const { directory, positions } = state;
  if ("loading" in positions || "off" in positions) return "";
  if ("unavailable" in positions) {
    return `<p class="eyebrow">${th("staking.positions.title")}</p>
      <p class="hint" role="alert">${escapeHtml(localizeErrorCopy(positions.unavailable))}</p>`;
  }
  if (positions.complete && positions.rows.length === 0) return "";
  const listed = "entries" in directory ? directory.entries : [];
  const nameOf = (staker: string): string | null =>
    listed.find((entry) => entry.staker === staker)?.name ?? null;
  return `<section class="staking-positions" data-staking-positions>
    <p class="eyebrow">${th("staking.positions.title")}</p>
    ${
      positions.rows.length === 0
        ? ""
        : `<ul class="allowance-list staking-list">${positions.rows.map((row) => stakingPositionCard(row, nameOf(row.staker), "data-staking-open")).join("")}</ul>`
    }
    ${positions.complete ? "" : `<p class="hint" role="status">${th("staking.positions.mayNotBeListed")}</p>`}
  </section>`;
};
