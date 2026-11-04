/**
 * Strict runtime client for the staking screen (issue 750). The overview is
 * display strings only and is validated key by key before it reaches render
 * state; an answer that does not match reads as "unavailable", never as an
 * empty list. Actions name a validator id, a token id and an amount; the
 * background resolves and verifies everything else.
 */

import { isSha256Digest } from "@bramble/core/ids";
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { type FeeEstimate, isFeeEstimate } from "@bramble/starknet/fee-bounds";
import { isTransferResponse } from "../../../popup/responses/responses";
import { refusalText, relabelLostReply, responseError } from "../../runtime/runtime-errors";

const MAX_ROWS = 64;
const MAX_TEXT = 120;

/** Where the account stands in one pool; mirrors the background's states. */
type StakingPositionState = "exit-pending" | "none" | "staked" | "withdrawable";

/** One validator and token row as the screen shows it. */
export type StakingRow = {
  readonly accepting?: boolean;
  readonly commission?: string;
  readonly delegated?: string;
  readonly refusal?: string;
  readonly rewardSymbol?: string;
  readonly rewardsTo?: string;
  readonly staked?: string;
  readonly state?: StakingPositionState;
  readonly symbol: string;
  readonly tokenId: string;
  readonly unclaimed?: string;
  readonly unpoolAmount?: string;
  readonly unpoolTime?: number;
  readonly validatorId: string;
  readonly validatorName: string;
};

/** The screen's data: loading, a reason it could not load, or the overview. */
export type StakingState =
  | { readonly loading: true }
  | { readonly unavailable: string }
  | { readonly exitWindowSeconds: number; readonly rows: readonly StakingRow[] };

/** The state before the first read. */
export const STAKING_LOADING: StakingState = { loading: true };

/** The staking actions the screen offers. */
export type StakingAction = "cancel-unstake" | "claim" | "stake" | "unstake" | "withdraw";

const STATES: readonly string[] = ["exit-pending", "none", "staked", "withdrawable"];
const ROW_KEYS = [
  "accepting",
  "commission",
  "delegated",
  "refusal",
  "rewardSymbol",
  "rewardsTo",
  "staked",
  "state",
  "symbol",
  "tokenId",
  "unclaimed",
  "unpoolAmount",
  "unpoolTime",
  "validatorId",
  "validatorName",
];

const isText = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_TEXT;

const optional = (value: unknown, check: (item: unknown) => boolean): boolean =>
  value === undefined || check(value);

const isRow = (value: unknown): value is StakingRow =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ROW_KEYS) &&
  isText(value["symbol"]) &&
  isText(value["tokenId"]) &&
  isText(value["validatorId"]) &&
  isText(value["validatorName"]) &&
  optional(value["accepting"], (item) => typeof item === "boolean") &&
  optional(value["state"], (item) => typeof item === "string" && STATES.includes(item)) &&
  optional(value["unpoolTime"], (item) => Number.isSafeInteger(item) && (item as number) >= 0) &&
  [
    "commission",
    "delegated",
    "refusal",
    "rewardSymbol",
    "rewardsTo",
    "staked",
    "unclaimed",
    "unpoolAmount",
  ].every((key) => optional(value[key], isText));

/**
 * Reads a `wallet.stakingOverview` reply into screen state. A refusal keeps the
 * background's own sentence; anything unrecognised reads as unavailable.
 */
export const stakingStateFrom = (response: unknown): StakingState => {
  const staking = isRecord(response) ? response["staking"] : undefined;
  if (
    isRecord(response) &&
    hasOnlyKnownKeys(response, ["ok", "staking"]) &&
    response["ok"] === true &&
    isRecord(staking) &&
    hasOnlyKnownKeys(staking, ["exitWindowSeconds", "rows"]) &&
    Number.isSafeInteger(staking["exitWindowSeconds"]) &&
    (staking["exitWindowSeconds"] as number) >= 0 &&
    Array.isArray(staking["rows"]) &&
    staking["rows"].length <= MAX_ROWS &&
    staking["rows"].every(isRow)
  ) {
    return {
      exitWindowSeconds: staking["exitWindowSeconds"] as number,
      rows: staking["rows"] as readonly StakingRow[],
    };
  }
  return {
    unavailable: refusalText(response, "Couldn't read staking on this network. Try again."),
  };
};

/** Inputs for one staking action. */
export type StakingActionRequest = {
  readonly action: StakingAction;
  readonly amount?: string;
  readonly tokenId: string;
  readonly validatorId: string;
};

/** A frozen, priced action awaiting its one confirm. */
export type StakingPreparation = {
  readonly id: string;
  /** The background's sentence for what will be signed. */
  readonly review: string;
  readonly reviewedFee: FeeEstimate;
};

const MAX_REVIEW = 400;

const readPreparation = (response: unknown): StakingPreparation | null => {
  const value = isRecord(response) ? response["stakingPreparation"] : undefined;
  return isRecord(response) &&
    hasOnlyKnownKeys(response, ["ok", "stakingPreparation"]) &&
    response["ok"] === true &&
    isRecord(value) &&
    hasOnlyKnownKeys(value, ["id", "review", "reviewedFee"]) &&
    typeof value["id"] === "string" &&
    isSha256Digest(value["id"]) &&
    typeof value["review"] === "string" &&
    value["review"].length > 0 &&
    value["review"].length <= MAX_REVIEW &&
    isFeeEstimate(value["reviewedFee"])
    ? { id: value["id"], review: value["review"], reviewedFee: value["reviewedFee"] }
    : null;
};

/**
 * Creates the staking client over the panel's message sender.
 */
export const createStakingRuntimeClient = (
  sendMessage: (message: unknown) => Promise<unknown>,
) => ({
  async loadStaking(): Promise<StakingState> {
    return stakingStateFrom(
      await sendMessage({ type: "wallet.stakingOverview" }).catch(() => null),
    );
  },
  /**
   * Asks the background to build, verify and price one action. Nothing is
   * signed; the answer is what the confirm will sign and its maximum fee.
   */
  async prepareStaking(request: StakingActionRequest): Promise<StakingPreparation> {
    const response = await sendMessage({
      action: request.action,
      ...(request.amount === undefined ? {} : { amount: request.amount }),
      tokenId: request.tokenId,
      type: "wallet.stakingPrepare",
      validatorId: request.validatorId,
    });
    const preparation = readPreparation(response);
    if (preparation) return preparation;
    throw responseError(response, "staking preparation failed");
  },
  /**
   * Confirms a prepared action and resolves with its transaction hash. A lost
   * reply here is "may not have gone through".
   */
  async executeStaking(preparationId: string): Promise<string> {
    const response = await sendMessage({ preparationId, type: "wallet.stakingExecute" }).catch(
      (error: unknown) => {
        throw relabelLostReply(error, "staking action failed");
      },
    );
    if (isTransferResponse(response)) return response.transactionHash;
    throw responseError(response, "staking action failed");
  },
});
