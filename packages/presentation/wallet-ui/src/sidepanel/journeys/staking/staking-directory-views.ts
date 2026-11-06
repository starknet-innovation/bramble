/**
 * The staking screen with no validator open (issue 750): a field to paste a
 * validator address, always shown, and Starkscan's validator directory when
 * the gateway serves one.
 *
 * Every directory string is third-party text: it is escaped, a website is
 * shown only as its hostname and never as a link, nothing remote is loaded,
 * and an unknown figure says "unknown" rather than 0. The list names its
 * source and shows each address, because a name is not a check.
 */
import { escapeHtml } from "@bramble/core/html";
import { emptyState } from "@bramble/ui-kit/content";
import { button } from "@bramble/ui-kit/controls";
import { inputControl, selectField } from "@bramble/ui-kit/fields";
import { accountLabel as shortAddress } from "../../shared/parts";
import {
  type StakingDirectoryEntry,
  type StakingSort,
  type StakingState,
  sortedEntries,
} from "./staking-directory-client";

const SORTS: readonly { readonly label: string; readonly value: StakingSort }[] = [
  { label: "Most staked", value: "stake" },
  { label: "Lowest commission", value: "commission" },
  { label: "Highest uptime", value: "uptime" },
];

const pasteForm = (): string => `
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

const entryRow = (entry: StakingDirectoryEntry): string => `
  <li class="allowance-row staking-row" data-staking-entry="${escapeHtml(entry.staker)}">
    <div class="allowance-copy staking-copy">
      <strong>${escapeHtml(entry.name ?? "Unnamed validator")}</strong>
      <code>${escapeHtml(shortAddress(entry.staker))}</code>
      <p class="hint">${escapeHtml(figuresLine(entry))}</p>
      ${entry.pools.map((pool) => `<p class="hint">${escapeHtml(poolLine(pool))}</p>`).join("")}
      ${entry.website ? `<p class="hint">${escapeHtml(entry.website)}</p>` : ""}
      <div class="staking-actions">
        ${button({ attributes: { "data-staking-open": entry.staker }, label: "View", size: "small", variant: "ghost" })}
      </div>
    </div>
  </li>`;

const listed = (
  directory: Extract<StakingState["directory"], { readonly entries: unknown }>,
  sort: StakingSort,
): string => `
  <p class="hint">Listed by Starkscan. Check the address before you stake.</p>
  ${selectField({
    attributes: { "data-staking-sort": "" },
    label: "Sort by",
    name: "staking-sort",
    options: SORTS,
    selected: sort,
  })}
  ${
    directory.entries.length === 0
      ? emptyState("No validators with a pool for tokens you track.")
      : `<ul class="allowance-list staking-list">${sortedEntries(directory.entries, sort).map(entryRow).join("")}</ul>`
  }
  ${directory.moreError ? `<p class="hint" role="alert">${escapeHtml(directory.moreError)}</p>` : ""}
  ${
    directory.nextCursor
      ? `<div class="staking-more">${button({ attributes: { "data-staking-more": "" }, label: "Show more", size: "small", variant: "ghost" })}</div>`
      : ""
  }`;

/**
 * The paste field, then the directory in whatever state it is in.
 */
export const stakingDirectorySection = (state: StakingState): string => {
  const { directory } = state;
  return `${pasteForm()}${
    "loading" in directory
      ? emptyState("Loading validators…")
      : "off" in directory
        ? ""
        : "incomplete" in directory
          ? emptyState("Starkscan's validator list is incomplete right now.", "alert")
          : "unavailable" in directory
            ? emptyState(directory.unavailable, "alert")
            : listed(directory, state.sort)
  }`;
};
