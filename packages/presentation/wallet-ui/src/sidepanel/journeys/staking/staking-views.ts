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
import type { WalletStatus } from "../../../popup/responses/responses";
import { flowHeader, flowScreen } from "../../shared/parts";
import type { StakingAction, StakingRow, StakingValidatorState } from "./staking-client";
import type { StakingState } from "./staking-directory-client";
import { stakingDirectorySection } from "./staking-directory-views";
import { positionLines } from "./staking-position-lines";
import { stakingPositionsSection } from "./staking-positions-views";

const UNIT_SECONDS: readonly (readonly [number, string])[] = [
  [86_400, "day"],
  [3_600, "hour"],
  [60, "minute"],
];

/**
 * The exit window in words, rounded down to its largest whole unit
 * ("7 days", "5 minutes"). Pure.
 */
export const exitWindowText = (seconds: number): string => {
  for (const [unit, name] of UNIT_SECONDS) {
    if (seconds >= unit) {
      const count = Math.floor(seconds / unit);
      return `${count} ${name}${count === 1 ? "" : "s"}`;
    }
  }
  return `${seconds} seconds`;
};

const rowKey = (row: StakingRow): string => `${row.staker}|${row.tokenId}`;

const actionButton = (
  row: StakingRow,
  action: StakingAction,
  label: string,
  variant: "ghost" | "primary" = "ghost",
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
      ariaLabel: `${label} amount in ${row.symbol}`,
      attributes: { "data-staking-amount": `${action}|${rowKey(row)}` },
      inputmode: "decimal",
      maxlength: 40,
      placeholder: `0 ${row.symbol}`,
    })}
    ${actionButton(row, action, label, action === "stake" ? "primary" : "ghost")}
  </div>`;

const rowActions = (row: StakingRow): string => {
  const parts: string[] = [];
  if (row.unclaimed && row.unclaimed !== "0")
    parts.push(actionButton(row, "claim", "Claim rewards"));
  if (row.state === "withdrawable")
    parts.push(actionButton(row, "withdraw", "Withdraw", "primary"));
  if (row.state === "exit-pending" || row.state === "withdrawable") {
    parts.push(actionButton(row, "cancel-unstake", "Cancel unstake"));
  }
  return `${parts.length > 0 ? `<div class="staking-actions">${parts.join("")}</div>` : ""}
    ${row.accepting ? amountForm(row, "stake", "Stake") : `<p class="hint">${escapeHtml("This validator is leaving staking.")}</p>`}
    ${row.state === "staked" ? amountForm(row, "unstake", "Unstake") : ""}`;
};

const stakingRow = (row: StakingRow): string => `
  <li class="allowance-row staking-row" data-staking-symbol="${escapeHtml(row.symbol)}">
    <div class="allowance-copy staking-copy">
      <strong>${escapeHtml(row.symbol)}</strong>
      ${
        row.refusal
          ? `<p class="hint">${escapeHtml(row.refusal)}</p>`
          : `<p class="hint">${escapeHtml(`Commission ${row.commission ?? ""} · ${row.delegated ?? ""} ${row.symbol} delegated`)}</p>
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
    ${button({ attributes: { "data-staking-back": "" }, label: "All validators", size: "small", variant: "ghost" })}
    <strong>${escapeHtml(selected.name ?? "Validator")}</strong>
    <code>${escapeHtml(selected.staker)}</code>
  </div>
  ${
    "loading" in state
      ? emptyState("Loading staking…")
      : "unavailable" in state
        ? emptyState(state.unavailable, "alert")
        : `<p class="lede">${escapeHtml(`Unstaking takes ${exitWindowText(state.exitWindowSeconds)}, with no rewards while you wait.`)}</p>
           ${
             state.rows.length === 0
               ? emptyState("No tokens you track can be staked here.")
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
  flowHeader("Staking", status) +
  flowScreen(
    "staking",
    `<section class="section">
      ${
        account === null
          ? emptyState("Unlock an account on this network to stake.")
          : state.selected
            ? validatorSection(state.selected, state.validator)
            : `${stakingPositionsSection(state)}${stakingDirectorySection(state)}`
      }
    </section>`,
  );
