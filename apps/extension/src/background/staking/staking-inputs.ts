/**
 * Pure parsers for staking runtime messages from extension pages. The UI
 * names a staker address, a tracked token id, an action and a decimal amount;
 * it never supplies a pool or calldata. The staker is only a candidate: the
 * background verifies it on chain before reading or building anything for it.
 */

import { isSha256Digest } from "@bramble/core/ids";
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { STAKING_ACTIONS, type StakingAction } from "@bramble/transactions/staking-calls";
import { isDirectoryCursor } from "@bramble/transactions/staking-directory";
import { stakerAddress } from "@bramble/transactions/staking-networks";

const MAX_ID_LENGTH = 120;
const MAX_AMOUNT_LENGTH = 80;
const AMOUNT_PATTERN = /^\d+(?:\.\d+)?$/;

/**
 * A validated staking prepare request.
 */
export type StakingPrepareInput = {
  readonly action: StakingAction;
  readonly amount: string | null;
  /** Canonical staker address. */
  readonly staker: string;
  readonly tokenId: string;
};

const isId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH;

const isAction = (value: unknown): value is StakingAction =>
  typeof value === "string" && (STAKING_ACTIONS as readonly string[]).includes(value);

const isAmount = (value: unknown): value is string =>
  typeof value === "string" && value.length <= MAX_AMOUNT_LENGTH && AMOUNT_PATTERN.test(value);

/**
 * Parses `wallet.stakingPrepare`. `amount` is required exactly for the actions
 * that move an amount (stake, unstake) and refused for the others.
 */
export const readStakingPrepareInput = (message: unknown): StakingPrepareInput | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["action", "amount", "staker", "tokenId", "type"]) ||
    message["type"] !== "wallet.stakingPrepare" ||
    !isAction(message["action"]) ||
    !isId(message["tokenId"])
  ) {
    return null;
  }
  const staker = stakerAddress(message["staker"]);
  if (staker === null) return null;
  const action = message["action"];
  const needsAmount = action === "stake" || action === "unstake";
  const amount = message["amount"];
  if (needsAmount ? !isAmount(amount) : amount !== undefined) return null;
  return {
    action,
    amount: needsAmount && isAmount(amount) ? amount : null,
    staker,
    tokenId: message["tokenId"],
  };
};

/**
 * Parses `wallet.stakingExecute`: only the preparation id travels.
 */
export const readStakingExecuteInput = (
  message: unknown,
): { readonly preparationId: string } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["preparationId", "type"]) &&
  message["type"] === "wallet.stakingExecute" &&
  typeof message["preparationId"] === "string" &&
  isSha256Digest(message["preparationId"])
    ? { preparationId: message["preparationId"] }
    : null;

/**
 * Parses `wallet.stakingOverview`: the one staker whose pools to read, as a
 * canonical address, or null.
 */
export const readStakingOverviewInput = (message: unknown): { readonly staker: string } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["staker", "type"]) ||
    message["type"] !== "wallet.stakingOverview"
  ) {
    return null;
  }
  const staker = stakerAddress(message["staker"]);
  return staker === null ? null : { staker };
};

/**
 * Parses `wallet.stakingDirectory`: an optional opaque cursor from the
 * previous page, bounded before it is echoed to Starkscan.
 */
export const readStakingDirectoryInput = (
  message: unknown,
): { readonly cursor: string | null } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["cursor", "type"]) &&
  message["type"] === "wallet.stakingDirectory" &&
  (message["cursor"] === undefined || isDirectoryCursor(message["cursor"]))
    ? { cursor: typeof message["cursor"] === "string" ? message["cursor"] : null }
    : null;

/**
 * Parses `wallet.stakingPositions`: no fields beyond the type. The address is
 * always the active account's, never one the panel names.
 */
export const isStakingPositionsInput = (message: unknown): boolean =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["type"]) &&
  message["type"] === "wallet.stakingPositions";
