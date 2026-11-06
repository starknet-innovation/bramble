/**
 * The account's position lines for one staking row, shared by a validator's
 * screen and "Your stakes". Every figure is a background string from an
 * on-chain read; every line is escaped.
 */
import { escapeHtml } from "@bramble/core/html";
import { accountLabel as shortAddress } from "../../shared/parts";
import { formatUtcClock, formatUtcDate } from "../../shared/timestamp";
import type { StakingRow } from "./staking-client";

// Fixed UTC, like the recovery timelines: no implicit clock or locale.
const unlockText = (seconds: number): string =>
  `${formatUtcDate(seconds * 1000) ?? ""}, ${formatUtcClock(seconds * 1000) ?? ""}`;

/**
 * The account's position in one verified pool as escaped lines: staked,
 * rewards, a reward address that isn't this account, and a pending or
 * withdrawable unstake with its UTC unlock time. Empty for no position. Pure.
 */
export const positionLines = (row: StakingRow): string => {
  const lines: string[] = [];
  if (row.staked && row.staked !== "0") lines.push(`Staked ${row.staked} ${row.symbol}`);
  if (row.unclaimed && row.unclaimed !== "0")
    lines.push(`Rewards ${row.unclaimed} ${row.rewardSymbol ?? "STRK"}`);
  if (row.rewardsTo) lines.push(`Rewards are paid to ${shortAddress(row.rewardsTo)}`);
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
