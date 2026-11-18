/**
 * The staking screen with no validator open (issue 750): Starkscan's validator
 * directory when it can be read, each card one button that opens it, and
 * below it a field to paste a validator address, always shown (a failure
 * leaves one short line and the paste field).
 *
 * Every directory string is third-party text: it is escaped, a website is
 * shown only as its hostname and never as a link, nothing remote is loaded,
 * and an unknown figure says "unknown" rather than 0. The list names its
 * source and shows each address, because a name is not a check.
 */

import { escapeHtml } from "@bramble/core/html";
import { emptyState } from "@bramble/ui-kit/content";
import { button } from "@bramble/ui-kit/controls";
import { inputControl } from "@bramble/ui-kit/fields";
import { addressLabel } from "@bramble/wallet-model/networks";
import { icon } from "../../shared/icons";
import type { StakingDirectoryEntry, StakingState } from "./staking-directory-client";

// Below a listed directory the paste field is the fallback, so it says so.
const pasteForm = (listed: boolean): string => `
  ${listed ? '<p class="hint staking-paste-label">Validator not listed? Paste its address</p>' : ""}
  <form class="staking-form staking-paste" data-staking-paste novalidate>
    ${inputControl({
      ariaLabel: "Validator address",
      attributes: { "data-staking-paste-input": "" },
      autocapitalize: "none",
      autocomplete: "off",
      maxlength: 80,
      placeholder: "Paste a validator address",
      spellcheck: false,
    })}
    ${button({ label: "Open", size: "small", type: "submit", variant: "ghost" })}
  </form>
  <p class="hint" data-staking-paste-error role="alert" hidden></p>`;

const figuresLine = (entry: StakingDirectoryEntry): string =>
  `Commission ${entry.commission ?? "unknown"} · 30-day uptime ${entry.uptime ?? "unknown"}`;

const poolLine = (pool: StakingDirectoryEntry["pools"][number]): string =>
  pool.delegated === null
    ? `${pool.symbol} delegated unknown`
    : `${pool.delegated} ${pool.symbol} delegated`;

// The whole card is one button that opens the validator; its text is inline
// (a button holds no block elements).
const entryRow = (entry: StakingDirectoryEntry): string => `
  <li class="allowance-row staking-row staking-card-row" data-staking-entry="${escapeHtml(entry.staker)}">
    <button class="staking-card" type="button" data-staking-open="${escapeHtml(entry.staker)}">
      <span class="allowance-copy staking-copy">
        <strong>${escapeHtml(entry.name ?? "Unnamed validator")}</strong>
        <code>${escapeHtml(addressLabel(entry.staker))}</code>
        <span class="hint">${escapeHtml(figuresLine(entry))}</span>
        ${entry.pools.map((pool) => `<span class="hint">${escapeHtml(poolLine(pool))}</span>`).join("")}
        ${entry.website ? `<span class="hint">${escapeHtml(entry.website)}</span>` : ""}
      </span>
      <span class="disclosure-mark" aria-hidden="true">${icon("chevronRight")}</span>
    </button>
  </li>`;

// Starkscan's own order (most STRK staked first), as loaded page by page.
const listed = (
  directory: Extract<StakingState["directory"], { readonly entries: unknown }>,
): string => `
  <p class="hint">Listed by Starkscan. Check the address before you stake.</p>
  ${
    directory.entries.length === 0
      ? emptyState("No validators with a pool for tokens you track.")
      : `<ul class="allowance-list staking-list">${directory.entries.map(entryRow).join("")}</ul>`
  }
  ${directory.moreError ? `<p class="hint" role="alert">${escapeHtml(directory.moreError)}</p>` : ""}
  ${
    directory.nextCursor
      ? `<div class="staking-more">${button({ attributes: { "data-staking-more": "" }, label: "Show more", size: "small", variant: "ghost" })}</div>`
      : ""
  }`;

/**
 * The directory in whatever state it is in, then the paste field: under the
 * list as the fallback, or after the line saying the list couldn't load.
 */
export const stakingDirectorySection = (state: StakingState): string => {
  const { directory } = state;
  return `${
    "loading" in directory
      ? emptyState("Loading validators…")
      : "off" in directory
        ? ""
        : "incomplete" in directory
          ? emptyState("Starkscan's validator list is incomplete right now.", "alert")
          : "unavailable" in directory
            ? emptyState(directory.unavailable, "alert")
            : listed(directory)
  }${pasteForm("entries" in directory)}`;
};
