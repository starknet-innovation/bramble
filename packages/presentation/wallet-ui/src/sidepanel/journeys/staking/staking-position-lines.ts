/**
 * The account's position lines for one staking row, shared by a validator's
 * screen and "Your stakes". Every figure is a background string from an
 * on-chain read; every line is escaped.
 */

import { escapeHtml } from "@bramble/core/html";
import { addressLabel } from "@bramble/wallet-model/networks";
import { formatUtcClock, formatUtcDate } from "../../shared/timestamp";
import { compactAmount } from "../portfolio/token-row";
import type { StakingRow } from "./staking-client";

// Fixed UTC, like the recovery timelines: no implicit clock or locale.
const unlockText = (seconds: number): string =>
  `${formatUtcDate(seconds * 1000) ?? ""}, ${formatUtcClock(seconds * 1000) ?? ""}`;

/**
 * The account's position in one verified pool as escaped lines: staked,
 * rewards, a reward address that isn't this account, and a pending or
 * withdrawable unstake with its UTC unlock time. Empty for no position. `tag`
 * is "span" inside a button, where block elements aren't allowed. Pure.
 */
export const positionLines = (row: StakingRow, tag: "p" | "span" = "p"): string => {
  // The background sends plain decimals; they read through the shared display
  // formatter (grouped thousands), like every other amount on screen.
  const amount = (value: string | undefined): string => (value ? compactAmount(value) : "");
  const lines: string[] = [];
  if (row.staked && row.staked !== "0") lines.push(`Staked ${amount(row.staked)} ${row.symbol}`);
  if (row.unclaimed && row.unclaimed !== "0")
    lines.push(`Rewards ${amount(row.unclaimed)} ${row.rewardSymbol ?? "STRK"}`);
  if (row.rewardsTo) lines.push(`Rewards are paid to ${addressLabel(row.rewardsTo)}`);
  if (row.state === "exit-pending" && row.unpoolTime !== undefined) {
    lines.push(
      `Unstaking ${amount(row.unpoolAmount)} ${row.symbol} · withdraw from ${unlockText(row.unpoolTime)}`,
    );
  }
  if (row.state === "withdrawable") {
    lines.push(`${amount(row.unpoolAmount)} ${row.symbol} ready to withdraw`);
  }
  return lines.map((line) => `<${tag} class="hint">${escapeHtml(line)}</${tag}>`).join("");
};
