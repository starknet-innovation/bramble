/**
 * The account's position lines for one staking row, shared by a validator's
 * screen and "Your stakes". Every figure is a background string from an
 * on-chain read; every line is escaped.
 */
import { escapeHtml } from "@bramble/core/html";
import { canonical, shortAddress } from "@bramble/transactions/verify-decode";
import { t } from "../../../i18n/messages";
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
  if (row.staked && row.staked !== "0") {
    lines.push(t("staking.position.staked", { amount: amount(row.staked), symbol: row.symbol }));
  }
  if (row.unclaimed && row.unclaimed !== "0") {
    lines.push(
      t("staking.position.rewards", {
        amount: amount(row.unclaimed),
        symbol: row.rewardSymbol ?? "STRK",
      }),
    );
  }
  if (row.rewardsTo) {
    lines.push(
      t("staking.position.rewardsTo", { address: shortAddress(canonical(row.rewardsTo)) }),
    );
  }
  if (row.state === "exit-pending" && row.unpoolTime !== undefined) {
    lines.push(
      t("staking.position.unstaking", {
        amount: amount(row.unpoolAmount),
        symbol: row.symbol,
        time: unlockText(row.unpoolTime),
      }),
    );
  }
  if (row.state === "withdrawable") {
    lines.push(
      t("staking.position.readyToWithdraw", {
        amount: amount(row.unpoolAmount),
        symbol: row.symbol,
      }),
    );
  }
  return lines.map((line) => `<${tag} class="hint">${escapeHtml(line)}</${tag}>`).join("");
};
