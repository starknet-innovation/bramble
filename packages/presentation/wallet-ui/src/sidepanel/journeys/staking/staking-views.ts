/**
 * Staking screen (issue 750). With no validator open it shows the directory
 * and the paste field (./staking-directory-views). With one open it shows a
 * row per tracked token, with the account's position in that pool and the
 * actions its state allows. Every figure on that screen comes from the
 * background's on-chain reads; the screen derives none. The directory name, if
 * any, is shown beside the full address, which is what the review names.
 *
 * Copy states the two facts a delegator acts on: an unstake waits out the
 * exit window the staking contract reports (7 days on Mainnet), and earns no
 * rewards while it waits. No yield figure is shown (see the PR's decisions).
 */

import { escapeHtml } from "@bramble/core/html";
import { emptyState } from "@bramble/ui-kit/content";
import { button } from "@bramble/ui-kit/controls";
import { inputControl } from "@bramble/ui-kit/fields";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { localizeErrorCopy } from "../../../i18n/error-copy";
import { t, th } from "../../../i18n/messages";
import type { WalletStatus } from "../../../popup/responses/responses";
import { flowHeader, flowScreen } from "../../shared/parts";
import type { StakingAction, StakingRow, StakingValidatorState } from "./staking-client";
import type { StakingState } from "./staking-directory-client";
import { stakingDirectorySection } from "./staking-directory-views";
import { positionLines } from "./staking-position-lines";
import { stakingPositionsSection } from "./staking-positions-views";

const UNIT_SECONDS = [
  [86_400, "staking.duration.day", "staking.duration.days"],
  [3_600, "staking.duration.hour", "staking.duration.hours"],
  [60, "staking.duration.minute", "staking.duration.minutes"],
] as const;

/**
 * The exit window in words, rounded down to its largest whole unit
 * ("7 days", "5 minutes"). Pure.
 */
export const exitWindowText = (seconds: number): string => {
  for (const [unit, one, many] of UNIT_SECONDS) {
    if (seconds >= unit) {
      const count = Math.floor(seconds / unit);
      return t(count === 1 ? one : many, { count: String(count) });
    }
  }
  return t("staking.duration.seconds", { count: String(seconds) });
};

const rowKey = (row: StakingRow): string => `${row.staker}|${row.tokenId}`;

const actionButton = (
  row: StakingRow,
  action: StakingAction,
  label: string,
  variant: "primary" | "secondary",
): string =>
  button({
    attributes: { "data-staking-action": action, "data-staking-row": rowKey(row) },
    label,
    size: "small",
    variant,
  });

const amountForm = (row: StakingRow, action: "stake" | "unstake", label: string): string => `
  <div class="staking-form">
    ${inputControl({
      ariaLabel: t(
        action === "stake" ? "staking.action.stakeAmount" : "staking.action.unstakeAmount",
        { symbol: row.symbol },
      ),
      attributes: { "data-staking-amount": `${action}|${rowKey(row)}` },
      inputmode: "decimal",
      maxlength: 40,
      placeholder: `0 ${row.symbol}`,
    })}
    ${actionButton(row, action, label, action === "stake" ? "primary" : "secondary")}
  </div>`;

const rowActions = (row: StakingRow): string => {
  const parts: string[] = [];
  if (row.unclaimed && row.unclaimed !== "0")
    parts.push(actionButton(row, "claim", t("staking.action.claim"), "secondary"));
  if (row.state === "withdrawable")
    parts.push(actionButton(row, "withdraw", t("staking.action.withdraw"), "primary"));
  if (row.state === "exit-pending" || row.state === "withdrawable") {
    parts.push(actionButton(row, "cancel-unstake", t("staking.action.cancelUnstake"), "secondary"));
  }
  // Cancel closes a claim, withdraw or cancel-unstake review: those reviews
  // hide the row's other controls, so it is the way back to them.
  if (parts.length > 0) {
    parts.push(
      button({
        attributes: { "data-staking-cancel": rowKey(row), hidden: true },
        label: t("staking.action.cancel"),
        size: "small",
        variant: "ghost",
      }),
    );
  }
  return `${parts.length > 0 ? `<div class="staking-actions">${parts.join("")}</div>` : ""}
    ${row.accepting ? amountForm(row, "stake", t("staking.action.stake")) : `<p class="hint">${th("staking.validator.leaving")}</p>`}
    ${row.state === "staked" ? amountForm(row, "unstake", t("staking.action.unstake")) : ""}`;
};

const stakingRow = (row: StakingRow): string => `
  <li class="allowance-row staking-row" data-staking-symbol="${escapeHtml(row.symbol)}">
    <div class="allowance-copy staking-copy">
      <strong>${escapeHtml(row.symbol)}</strong>
      ${
        row.refusal
          ? `<p class="hint">${escapeHtml(localizeErrorCopy(row.refusal))}</p>`
          : `<p class="hint">${th("staking.validator.commission", { commission: row.commission ?? "", delegated: row.delegated ?? "", symbol: row.symbol })}</p>
             ${positionLines(row)}
             ${rowActions(row)}`
      }
      <p class="staking-review" data-staking-review-for="${escapeHtml(rowKey(row))}" role="status" hidden></p>
    </div>
  </li>`;

const validatorSection = (
  selected: NonNullable<StakingState["selected"]>,
  state: StakingValidatorState,
): string => `
  <div class="staking-validator">
    ${button({ attributes: { "data-staking-back": "" }, label: t("staking.validator.allValidators"), size: "small", variant: "ghost" })}
    <strong>${escapeHtml(selected.name ?? t("staking.validator.name"))}</strong>
    <code>${escapeHtml(selected.staker)}</code>
  </div>
  ${
    "loading" in state
      ? emptyState(t("staking.validator.loading"))
      : "unavailable" in state
        ? emptyState(localizeErrorCopy(state.unavailable), "alert")
        : `<p class="lede">${th("staking.validator.exitWindow", { window: exitWindowText(state.exitWindowSeconds) })}</p>
           ${
             state.rows.length === 0
               ? emptyState(t("staking.validator.noTokens"))
               : `<ul class="allowance-list staking-list">${state.rows.map(stakingRow).join("")}</ul>`
           }`
  }`;

/**
 * Staking flow for the active account and network: the directory, or the one
 * validator the user opened.
 */
export const stakingFlow = (
  status: WalletStatus,
  account: AccountRef | null,
  state: StakingState,
): string =>
  flowHeader(t("staking.title"), status) +
  flowScreen(
    "staking",
    `<section class="section">
      ${
        account === null
          ? emptyState(t("staking.validator.unlockAccount"))
          : state.selected
            ? validatorSection(state.selected, state.validator)
            : `${stakingPositionsSection(state)}${stakingDirectorySection(state)}`
      }
    </section>`,
  );
