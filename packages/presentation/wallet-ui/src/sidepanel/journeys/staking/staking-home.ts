/**
 * Staking on Home (issue 750): a "Staking" tab beside Tokens, and a small
 * "Staked {amount}" line under the total, both shown only where staking is
 * switched on. Everything here is the "Your stakes" state the staking screen
 * already holds: positions Starkscan listed and the chain confirmed. Nothing
 * is read for Home alone, and staked amounts never join the Home total.
 *
 * Every figure is a background string from an on-chain read and is escaped.
 * Rows and buttons are real buttons: the Stake button opens the validator
 * list; a row opens that validator.
 */

import { escapeHtml } from "@bramble/core/html";
import type { TokenConfig } from "@bramble/settings/preferences";
import { formatTokenAmount, parseTokenAmount } from "@bramble/starknet/rpc";
import { canonical, shortAddress } from "@bramble/transactions/verify-decode";
import { emptyState } from "@bramble/ui-kit/content";
import { button } from "@bramble/ui-kit/controls";
import { localizeErrorCopy } from "../../../i18n/error-copy";
import { t, th } from "../../../i18n/messages";
import { icon } from "../../shared/icons";
import { compactAmount } from "../portfolio/token-row";
import type { StakingRow } from "./staking-client";
import type { StakingState } from "./staking-directory-client";
import { positionLines } from "./staking-position-lines";

/** The Home portfolio tabs, in order: Tokens · Staking · NFTs. */
export type HomeTab = "nfts" | "staking" | "tokens";

const stakeButton = (): string =>
  button({
    attributes: { "data-staking-list": "" },
    icon: "trendingUp",
    label: t("staking.action.stake"),
  });

/**
 * One confirmed position as a whole-row button that opens its validator. The
 * directory name is shown when the list already holds one.
 */
export const stakingPositionCard = (
  row: StakingRow,
  name: string | null,
  attribute: "data-staking-go" | "data-staking-open",
): string => `
  <li class="allowance-row staking-row staking-card-row" data-staking-position="${escapeHtml(`${row.staker}|${row.tokenId}`)}">
    <button class="staking-card" type="button" ${attribute}="${escapeHtml(row.staker)}">
      <span class="allowance-copy staking-copy">
        <strong>${escapeHtml(name ?? t("staking.validator.name"))}</strong>
        <code>${escapeHtml(shortAddress(canonical(row.staker)))}</code>
        ${positionLines(row, "span")}
      </span>
      <span class="disclosure-mark" aria-hidden="true">${icon("chevronRight")}</span>
    </button>
  </li>`;

const nameIn = (state: StakingState, staker: string): string | null =>
  "entries" in state.directory
    ? (state.directory.entries.find((entry) => entry.staker === staker)?.name ?? null)
    : null;

/**
 * The Staking tab's panel: the Stake button first, then the confirmed
 * positions or the state the read is in. A failed or incomplete read never
 * reads as "no stakes".
 */
const homeStakingPanel = (state: StakingState): string => {
  const { positions } = state;
  const body =
    "loading" in positions
      ? emptyState(t("staking.validator.loading"))
      : "off" in positions
        ? ""
        : "unavailable" in positions
          ? `<p class="hint" role="alert">${escapeHtml(localizeErrorCopy(positions.unavailable))}</p>`
          : positions.rows.length === 0 && positions.complete
            ? emptyState(t("staking.home.empty"))
            : `${
                positions.rows.length === 0
                  ? ""
                  : `<ul class="allowance-list staking-list">${positions.rows
                      .map((row) =>
                        stakingPositionCard(row, nameIn(state, row.staker), "data-staking-go"),
                      )
                      .join("")}</ul>`
              }${positions.complete ? "" : `<p class="hint" role="status">${th("staking.positions.mayNotBeListed")}</p>`}`;
  return `<div class="home-staking">${stakeButton()}${body}</div>`;
};

/**
 * Home's tab bar and panels: Tokens, then Staking when staking is on, then
 * NFTs when an NFTs panel is given (NFTs turned on), with `selected` open (or
 * Tokens when `selected` is not offered); `open` names the tab shown. The other
 * panels are rendered hidden so the tabs switch without a read.
 */
export const homeTabPanels = (
  selected: HomeTab,
  tokens: string,
  staking: StakingState | null,
  nfts: string | null = null,
): { readonly bar: string; readonly open: HomeTab; readonly panels: string } => {
  const offered: ReadonlyArray<readonly [HomeTab, string, string]> = [
    ["tokens", th("staking.home.tabTokens"), tokens],
    ...(staking
      ? [["staking", th("staking.home.tabStaking"), homeStakingPanel(staking)] as const]
      : []),
    ...(nfts === null ? [] : [["nfts", th("staking.home.tabNfts"), nfts] as const]),
  ];
  const open = offered.some(([value]) => value === selected) ? selected : "tokens";
  const tab = (value: HomeTab, label: string): string =>
    `<button class="home-tab" id="home-tab-${value}" data-home-tab="${value}" type="button" role="tab" aria-controls="home-panel-${value}" aria-selected="${value === open}" tabindex="${value === open ? "0" : "-1"}">${label}</button>`;
  const panel = (value: HomeTab, body: string): string =>
    `<div id="home-panel-${value}" role="tabpanel" aria-labelledby="home-tab-${value}"${value === open ? "" : " hidden"}>${body}</div>`;
  return {
    open,
    bar: `<div class="tab-set" role="tablist" aria-label="${th("staking.home.tabs")}">${offered.map(([value, label]) => tab(value, label)).join("")}</div>`,
    panels: offered.map(([value, , body]) => panel(value, body)).join(""),
  };
};

/**
 * "Staked 1,250 STRK" (per token, summed across validators) for the line
 * under the Home total, or null when no confirmed stake is held. Pure.
 */
export const stakedSummary = (
  state: StakingState,
  tokens: readonly TokenConfig[],
): string | null => {
  if (!("rows" in state.positions)) return null;
  const totals = new Map<string, { raw: bigint; readonly token: TokenConfig }>();
  for (const row of state.positions.rows) {
    const token = tokens.find((entry) => entry.id === row.tokenId);
    if (!token || !row.staked) continue;
    let raw: bigint;
    try {
      // Rejects zero too, so a membership holding only rewards adds nothing.
      raw = parseTokenAmount(row.staked, token.decimals);
    } catch {
      continue;
    }
    const total = totals.get(token.id);
    if (total) total.raw += raw;
    else totals.set(token.id, { raw, token });
  }
  if (totals.size === 0) return null;
  return t("staking.home.staked", {
    amounts: [...totals.values()]
      .map(
        ({ raw, token }) =>
          `${compactAmount(formatTokenAmount(raw, token.decimals))} ${token.symbol}`,
      )
      .join(" · "),
  });
};

/**
 * The "Staked {amount}" line under the Home total, a button that opens the
 * Staking tab, or "" without a confirmed stake.
 */
export const stakedLine = (state: StakingState, tokens: readonly TokenConfig[]): string => {
  const summary = stakedSummary(state, tokens);
  return summary === null
    ? ""
    : `<button class="hero-staked" type="button" data-home-tab-open="staking">${icon("trendingUp")}<span>${escapeHtml(summary)}</span></button>`;
};
