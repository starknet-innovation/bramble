/**
 * Pure parsers for staking runtime messages from extension pages. The UI
 * names a validator id, a tracked token id, an action and a decimal amount;
 * it never supplies an address, a pool or calldata.
 */

import { isSha256Digest } from "@bramble/core/ids";
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { STAKING_ACTIONS, type StakingAction } from "@bramble/transactions/staking-calls";

const MAX_ID_LENGTH = 120;
const MAX_AMOUNT_LENGTH = 80;
const AMOUNT_PATTERN = /^\d+(?:\.\d+)?$/;

/**
 * A validated staking prepare request.
 */
export type StakingPrepareInput = {
  readonly action: StakingAction;
  readonly amount: string | null;
  readonly tokenId: string;
  readonly validatorId: string;
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
    !hasOnlyKnownKeys(message, ["action", "amount", "tokenId", "type", "validatorId"]) ||
    message["type"] !== "wallet.stakingPrepare" ||
    !isAction(message["action"]) ||
    !isId(message["tokenId"]) ||
    !isId(message["validatorId"])
  ) {
    return null;
  }
  const action = message["action"];
  const needsAmount = action === "stake" || action === "unstake";
  const amount = message["amount"];
  if (needsAmount ? !isAmount(amount) : amount !== undefined) return null;
  return {
    action,
    amount: needsAmount && isAmount(amount) ? amount : null,
    tokenId: message["tokenId"],
    validatorId: message["validatorId"],
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
