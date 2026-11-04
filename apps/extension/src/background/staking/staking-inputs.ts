/**
 * Pure parsers for staking runtime messages from extension pages. The UI
 * names a validator id, a tracked token id, an action and a decimal amount;
 * it never supplies an address, a pool or calldata.
 */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { type FeeEstimate, isFeeEstimate } from "@bramble/starknet/fee-bounds";
import { STAKING_ACTIONS, type StakingAction } from "@bramble/transactions/staking-calls";

const MAX_ID_LENGTH = 120;
const MAX_AMOUNT_LENGTH = 80;
const AMOUNT_PATTERN = /^\d+(?:\.\d+)?$/;

/**
 * A validated staking action request.
 */
export type StakingActionInput = {
  readonly action: StakingAction;
  readonly amount: string | null;
  readonly reviewedFee?: FeeEstimate;
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
 * Parses `wallet.stakingAction`. `amount` is required exactly for the actions
 * that move an amount (stake, unstake) and refused for the others.
 */
export const readStakingActionInput = (message: unknown): StakingActionInput | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, [
      "action",
      "amount",
      "reviewedFee",
      "tokenId",
      "type",
      "validatorId",
    ]) ||
    message["type"] !== "wallet.stakingAction" ||
    !isAction(message["action"]) ||
    !isId(message["tokenId"]) ||
    !isId(message["validatorId"]) ||
    (message["reviewedFee"] !== undefined && !isFeeEstimate(message["reviewedFee"]))
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
    ...(isFeeEstimate(message["reviewedFee"]) ? { reviewedFee: message["reviewedFee"] } : {}),
    tokenId: message["tokenId"],
    validatorId: message["validatorId"],
  };
};
