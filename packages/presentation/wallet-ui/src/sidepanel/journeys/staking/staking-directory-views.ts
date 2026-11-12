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
import { canonical, shortAddress } from "@bramble/transactions/verify-decode";
import { emptyState } from "@bramble/ui-kit/content";
import { button } from "@bramble/ui-kit/controls";
import { inputControl } from "@bramble/ui-kit/fields";
import { t, th } from "../../../i18n/messages";
import { icon } from "../../shared/icons";
import type { StakingDirectoryEntry, StakingState } from "./staking-directory-client";

// Below a listed directory the paste field is the fallback, so it says so.
const pasteForm = (listed: boolean): string => `
  ${listed ? `<p class="hint staking-paste-label">${th("staking.directory.notListed")}</p>` : ""}
  <form class="staking-form staking-paste" data-staking-paste novalidate>
    ${inputControl({
      ariaLabel: t("staking.directory.validatorAddress"),
      attributes: { "data-staking-paste-input": "" },
      autocapitalize: "none",
      autocomplete: "off",
      maxlength: 80,
      placeholder: t("staking.directory.pasteAddress"),
      spellcheck: false,
    })}
    ${button({ label: t("staking.directory.open"), size: "small", type: "submit", variant: "ghost" })}
  </form>
  <p class="hint" data-staking-paste-error role="alert" hidden></p>`;

const figuresLine = (entry: StakingDirectoryEntry): string =>
  t("staking.directory.figures", {
    commission: entry.commission ?? t("staking.directory.unknown"),
    uptime: entry.uptime ?? t("staking.directory.unknown"),
  });

const poolLine = (pool: StakingDirectoryEntry["pools"][number]): string =>
  pool.delegated === null
    ? t("staking.directory.poolUnknown", { symbol: pool.symbol })
    : t("staking.directory.pool", { delegated: pool.delegated, symbol: pool.symbol });

// The whole card is one button that opens the validator; its text is inline
// (a button holds no block elements).
const entryRow = (entry: StakingDirectoryEntry): string => `
  <li class="allowance-row staking-row staking-card-row" data-staking-entry="${escapeHtml(entry.staker)}">
    <button class="staking-card" type="button" data-staking-open="${escapeHtml(entry.staker)}">
      <span class="allowance-copy staking-copy">
        <strong>${escapeHtml(entry.name ?? t("staking.directory.unnamed"))}</strong>
        <code>${escapeHtml(shortAddress(canonical(entry.staker)))}</code>
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
  <p class="hint">${th("staking.directory.listedBy")}</p>
  ${
    directory.entries.length === 0
      ? emptyState(t("staking.directory.noValidators"))
      : `<ul class="allowance-list staking-list">${directory.entries.map(entryRow).join("")}</ul>`
  }
  ${directory.moreError ? `<p class="hint" role="alert">${escapeHtml(directory.moreError)}</p>` : ""}
  ${
    directory.nextCursor
      ? `<div class="staking-more">${button({ attributes: { "data-staking-more": "" }, label: t("staking.directory.showMore"), size: "small", variant: "ghost" })}</div>`
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
      ? emptyState(t("staking.directory.loading"))
      : "off" in directory
        ? ""
        : "incomplete" in directory
          ? emptyState(t("staking.directory.incomplete"), "alert")
          : "unavailable" in directory
            ? emptyState(directory.unavailable, "alert")
            : listed(directory)
  }${pasteForm("entries" in directory)}`;
};
