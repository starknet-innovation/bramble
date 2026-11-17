/**
 * Strict reader for Starkscan's staking coverage (schema `StakingCoverage`),
 * the one decision both staking reads share: the validator directory and an
 * address's positions ("Your stakes").
 *
 * Trust boundary: the coverage block is untrusted third-party data, like the
 * rest of the answer. Every field the decision reads is checked for type and
 * bounds, and anything malformed is null, which rejects the whole answer.
 * Fields the decision does not read are ignored, so an added Starkscan field
 * cannot take a list down.
 *
 * What it decides is only whether a list is offered as whole.
 * Nothing here makes a listed validator trusted: one picked from the list is
 * verified on chain exactly like a pasted address, and a listed position is
 * shown only after the chain confirms it.
 */
import { isRecord } from "@bramble/core/json";

/**
 * The most blocks a `catching_up` snapshot may trail Starkscan's latest
 * finalized block and still be offered.
 *
 * Starkscan reports `catching_up` as its steady state: it materialises staking
 * activity in a bounded window, so it keeps a few dozen finalized blocks
 * behind (18 to 28 observed on Mainnet, 2026-11-08). The state it serves
 * (status, commission, stake, pools) is then only that far behind, and the
 * 30-day uptime window sat inside its liveness coverage in the sample checked,
 * so the list is shown exactly as a `prepared` one. 100 blocks is a few minutes of Mainnet: past
 * it, the snapshot is no longer "just behind" but stalled, and the list is
 * withheld as incomplete. A `prepared` snapshot is not bounded by this.
 */
export const MAX_CATCHING_UP_LAG_BLOCKS = 100;

// Starkscan's interval lists: only emptiness is read, but a list is still
// bounded so an oversized answer is refused rather than walked.
const MAX_COVERAGE_INTERVALS = 1024;

const STATUSES: readonly string[] = ["catching_up", "prepared", "unavailable"];

/**
 * Whether a snapshot's list can be offered as whole:
 * - `usable`: Starkscan reports it `prepared`, or `catching_up` but
 *   finalized-only, with no gap and nothing outstanding, and at most
 *   {@link MAX_CATCHING_UP_LAG_BLOCKS} behind;
 * - `incomplete`: anything else.
 */
export type StakingCoverage = "incomplete" | "usable";

const isIntervalList = (value: unknown): value is readonly unknown[] =>
  Array.isArray(value) && value.length <= MAX_COVERAGE_INTERVALS;

/**
 * Reads one `coverage` block. Null when it is not an object, its status is
 * not one Starkscan defines, `finalizedOnly` is not a boolean, `lagBlocks` is
 * not a non-negative safe integer, or either interval list is not a bounded
 * array. Pure.
 */
export const stakingCoverage = (value: unknown): StakingCoverage | null => {
  if (!isRecord(value)) return null;
  const status = value["status"];
  const finalizedOnly = value["finalizedOnly"];
  const lagBlocks = value["lagBlocks"];
  const gaps = value["gapIntervals"];
  const outstanding = value["outstandingMaterializationIntervals"];
  if (
    typeof status !== "string" ||
    !STATUSES.includes(status) ||
    typeof finalizedOnly !== "boolean" ||
    typeof lagBlocks !== "number" ||
    !Number.isSafeInteger(lagBlocks) ||
    lagBlocks < 0 ||
    !isIntervalList(gaps) ||
    !isIntervalList(outstanding)
  ) {
    return null;
  }
  const justBehind =
    status === "catching_up" &&
    finalizedOnly &&
    gaps.length === 0 &&
    outstanding.length === 0 &&
    lagBlocks <= MAX_CATCHING_UP_LAG_BLOCKS;
  return status === "prepared" || justBehind ? "usable" : "incomplete";
};
