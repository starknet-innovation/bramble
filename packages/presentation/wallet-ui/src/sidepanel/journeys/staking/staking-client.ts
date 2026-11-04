/**
 * Strict runtime client for the staking screen (issue 750). The overview is
 * display strings only and is validated key by key before it reaches render
 * state; an answer that does not match reads as "unavailable", never as an
 * empty list. Actions name a validator id, a token id and an amount; the
 * background resolves and verifies everything else.
 */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import type { FeeEstimate } from "@bramble/starknet/fee-bounds";
import { isTransferResponse } from "../../../popup/responses/responses";
import { isFeeReviewResponse } from "../../../popup/responses/responses-transfer";
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
  ["commission", "delegated", "refusal", "staked", "unclaimed", "unpoolAmount"].every((key) =>
    optional(value[key], isText),
  );

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
   * Without `reviewedFee`, asks for the network fee and resolves with it. With
   * the fee the user reviewed, signs and submits, and resolves with the
   * transaction hash. Only that second call's lost reply is a staking
   * "may not have gone through".
   */
  async stakingAction(
    request: StakingActionRequest,
    reviewedFee?: FeeEstimate,
  ): Promise<FeeEstimate | string> {
    const response = await sendMessage({
      action: request.action,
      ...(request.amount === undefined ? {} : { amount: request.amount }),
      ...(reviewedFee ? { reviewedFee } : {}),
      tokenId: request.tokenId,
      type: "wallet.stakingAction",
      validatorId: request.validatorId,
    }).catch((error: unknown) => {
      throw reviewedFee ? relabelLostReply(error, "staking action failed") : error;
    });
    if (isFeeReviewResponse(response)) return response.feeReview;
    if (isTransferResponse(response)) return response.transactionHash;
    throw responseError(response, "staking action failed");
  },
});
