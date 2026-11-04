/**
 * Staking screen (issue 750): one row per curated validator and token, with
 * the account's position in that pool and the actions its state allows. Every
 * figure comes from the background's on-chain reads; the screen derives none.
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
import { formatUtcClock, formatUtcDate } from "../../shared/timestamp";
import type { StakingAction, StakingRow, StakingState } from "./staking-client";

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

// Fixed UTC, like the recovery timelines: no implicit clock or locale.
const unlockText = (seconds: number): string =>
  `${formatUtcDate(seconds * 1000) ?? ""}, ${formatUtcClock(seconds * 1000) ?? ""}`;

const rowKey = (row: StakingRow): string => `${row.validatorId}|${row.tokenId}`;

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

const positionLines = (row: StakingRow): string => {
  const lines: string[] = [];
  if (row.staked && row.staked !== "0") lines.push(`Staked ${row.staked} ${row.symbol}`);
  if (row.unclaimed && row.unclaimed !== "0") lines.push(`Rewards ${row.unclaimed} ${row.symbol}`);
  if (row.state === "exit-pending" && row.unpoolTime !== undefined) {
    lines.push(
      `Unstaking ${row.unpoolAmount ?? ""} ${row.symbol} · withdraw from ${unlockText(row.unpoolTime)}`,
    );
  }
  if (row.state === "withdrawable") {
    lines.push(`${row.unpoolAmount ?? ""} ${row.symbol} ready to withdraw`);
  }
  return lines.map((line) => `<p class="hint">${escapeHtml(line)}</p>`).join("");
};

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
  <li class="allowance-row staking-row" data-staking-symbol="${escapeHtml(row.symbol)}" data-staking-validator="${escapeHtml(row.validatorName)}">
    <div class="allowance-copy staking-copy">
      <strong>${escapeHtml(row.validatorName)} · ${escapeHtml(row.symbol)}</strong>
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

/**
 * Staking flow for the active account and network.
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
          : "loading" in state
            ? emptyState("Loading staking…")
            : "unavailable" in state
              ? emptyState(state.unavailable, "alert")
              : `<p class="lede">${escapeHtml(`Unstaking takes ${exitWindowText(state.exitWindowSeconds)}, with no rewards while you wait.`)}</p>
                 ${
                   state.rows.length === 0
                     ? emptyState("No validators to stake with on tokens you track.")
                     : `<ul class="allowance-list staking-list">${state.rows.map(stakingRow).join("")}</ul>`
                 }`
      }
    </section>`,
  );
