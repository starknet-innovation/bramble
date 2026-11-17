/**
 * Strict reader for Starkscan's staking positions of one address
 * (`GET /v1/{chain}/staking/address/{address}`, schema `StakingAddressView`),
 * read directly from Starkscan's keyless API ("Your stakes", issue 750).
 *
 * Trust boundary: the answer is untrusted third-party data. It only says which
 * validators and tokens to ask the chain about; it never supplies an amount
 * that is shown, a pool that is used, or anything that is signed. Every field
 * the wallet reads is checked, the list is bounded, and anything malformed
 * rejects the whole answer (null). Fields the wallet does not read (the
 * history, Starkscan's own amounts) are ignored.
 *
 * Completeness: the list is complete only when `positionsTruncated` is false
 * and `stakingCoverage` (./staking-coverage) does not call the snapshot
 * incomplete: `prepared`, or `catching_up` and only just behind, the same rule
 * the validator directory uses. Anything else is incomplete, never "no
 * stakes".
 */
import { isRecord } from "@bramble/core/json";
import { sameFelt } from "@bramble/wallet-model/networks";
import { stakingCoverage } from "./staking-coverage";
import { type StakingDirectoryChain, starkscanFelt, starkscanRaw } from "./staking-directory";
import { stakerAddress } from "./staking-networks";

/** The most positions Starkscan's schema allows in one answer. */
export const MAX_STAKING_POSITIONS = 256;

/**
 * The most Starkscan candidates the background reads on chain per request,
 * and so the most rows "Your stakes" shows; more makes the list incomplete.
 */
export const MAX_CHECKED_POSITIONS = 16;

const STATUSES: readonly string[] = ["active", "exiting"];

/** One position Starkscan lists: a candidate for an on-chain read, no more. */
export type StakingPositionCandidate = {
  readonly staker: string;
  readonly token: string;
};

/** One validated answer. */
export type StakingPositionsPage = {
  /** True only for usable coverage (not incomplete) with nothing truncated. */
  readonly complete: boolean;
  readonly positions: readonly StakingPositionCandidate[];
};

const positionOf = (value: unknown, account: string): StakingPositionCandidate | null => {
  if (!isRecord(value)) return null;
  const staker = stakerAddress(starkscanFelt(value["validatorAddress"]));
  const token = starkscanFelt(value["tokenAddress"]);
  const pending = starkscanRaw(value["pendingExitRaw"]);
  const status = value["status"];
  return staker &&
    token &&
    starkscanFelt(value["poolAddress"]) &&
    sameFelt(starkscanFelt(value["address"]), account) &&
    typeof starkscanRaw(value["delegatedRaw"]) === "bigint" &&
    pending !== undefined &&
    typeof status === "string" &&
    STATUSES.includes(status)
    ? { staker, token }
    : null;
};

/**
 * Validates one answer for `account` on `chain`. Null when anything the wallet
 * reads is malformed or out of bounds, when it answers for another chain or
 * address, or lists a validator and token twice. Pure.
 */
export const parseStakingPositions = (
  value: unknown,
  chain: StakingDirectoryChain,
  account: string,
): StakingPositionsPage | null => {
  if (!isRecord(value)) return null;
  const coverage = stakingCoverage(value["coverage"]);
  const items = value["positions"];
  const truncated = value["positionsTruncated"];
  if (
    value["chainId"] !== chain ||
    value["source"] !== "finalized_prepared_staking_snapshot" ||
    !sameFelt(starkscanFelt(value["address"]), account) ||
    coverage === null ||
    typeof truncated !== "boolean" ||
    !Array.isArray(items) ||
    items.length > MAX_STAKING_POSITIONS
  ) {
    return null;
  }
  const positions: StakingPositionCandidate[] = [];
  for (const item of items) {
    const position = positionOf(item, account);
    if (
      !position ||
      positions.some(
        (seen) => sameFelt(seen.staker, position.staker) && sameFelt(seen.token, position.token),
      )
    ) {
      return null;
    }
    positions.push(position);
  }
  return { complete: coverage === "usable" && !truncated, positions };
};
