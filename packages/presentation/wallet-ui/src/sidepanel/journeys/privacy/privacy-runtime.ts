/**
 * Strict extension-runtime client for wallet-owned STRK20 journeys.
 */

import { isSha256Digest } from "@bramble/core/ids";
import { hasOnlyKnownKeys, isDecimalAmountText, isRecord, isStringArray } from "@bramble/core/json";
import type { PaymasterAuthorizationReview } from "@bramble/privacy/paymaster-typed-data";
import { canonicalStrk20PoolFee } from "@bramble/privacy/service";
import { isAccountIdForNetwork } from "@bramble/wallet-model/accounts";

import {
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
  isStarknetNetworkId,
  sameFelt,
} from "@bramble/wallet-model/networks";
import { isTokenId } from "@bramble/wallet-model/preferences";
import { type FeeEstimate, isFeeEstimate } from "@bramble/wallet-protocol/fee-estimate";
import { STRK20_LIMITS } from "@bramble/wallet-protocol/strk20";
import { responseError } from "../../runtime/runtime-errors";
import {
  type PreparationJobOptions,
  type PreparationProgress,
  runPreparationJob,
} from "./privacy-preparation-job";
import { type PrivacyRelayFee, readPrivacyRelayFee } from "./privacy-relay-fee";

/**
 * Receives the progress of a tracked job on every poll while it runs. Optional
 * on every job-backed method: a caller with no working screen passes nothing.
 */
export type PreparationProgressSink = (progress: PreparationProgress) => void;

/**
 * Display-safe private balance derived from validated SDK note totals.
 */
export type PrivateBalanceView = {
  readonly balance: string;
  readonly formatted: string;
  readonly symbol: string;
  readonly token: string;
  readonly tokenId: string;
};

/**
 * Account/network-scoped disclosure returned to the side panel.
 */
export type PrivacyAccountState = {
  readonly accountId: string;
  readonly balances: readonly PrivateBalanceView[];
  readonly networkId: string;
  /** Pool action fee in FRI. A failed read rejects the whole disclosure request. */
  readonly poolFeeFri: string;
  /** Whether the active network has an unlinkable private submission route. */
  readonly relayConfigured: boolean;
  /**
   * `pending` means the wallet broadcast a registration that the privacy
   * indexer has not reflected yet. It is not a shieldable state, but it must
   * never be treated as `unregistered` either: offering to register again in
   * that window is how a duplicate registration gets broadcast.
   */
  readonly registration: "pending" | "registered" | "unregistered";
};

/**
 * Immutable review metadata for one register, deposit, or private-send
 * operation.
 */
export type PrivacyPreparation = {
  readonly amount?: string;
  readonly authorization?: PaymasterAuthorizationReview;
  readonly id: string;
  readonly kind: "deposit" | "register" | "transfer" | "withdraw";
  readonly networkFee?: FeeEstimate;
  readonly payloadDigest: string;
  readonly poolAddress: string;
  readonly poolFeeFri?: string;
  readonly recipient?: string;
  readonly route: "private-relay" | "public-account";
  readonly relayFee?: PrivacyRelayFee;
  readonly summaries: readonly string[];
  readonly symbol: string;
  readonly tokenId: string;
};

const MAX_SUMMARIES = 32;
const MAX_SUMMARY_CHARACTERS = 256;
const MAX_DISPLAY_CHARACTERS = 128;

const isDisplayString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_DISPLAY_CHARACTERS;

// The review card's summary list: the shared string-array guard (which also
// rejects a sparse or property-carrying array) plus the two display bounds this
// screen owns. It composes the shared guard rather than shadowing its name with
// a private, stricter copy — the previous local `isStringArray` read at every
// call site as if it were the shared one.
const isSummaryList = (value: unknown): value is readonly string[] =>
  isStringArray(value) &&
  value.length <= MAX_SUMMARIES &&
  value.every((entry) => entry.length > 0 && entry.length <= MAX_SUMMARY_CHARACTERS);

const readAuthorization = (value: unknown): PaymasterAuthorizationReview | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["caller", "executeAfter", "executeBefore", "publicCallCount"]) ||
    typeof value["caller"] !== "string" ||
    !isNonZeroStarkFieldElement(value["caller"]) ||
    typeof value["executeAfter"] !== "string" ||
    !isStarkFieldElement(value["executeAfter"]) ||
    typeof value["executeBefore"] !== "string" ||
    !isStarkFieldElement(value["executeBefore"]) ||
    typeof value["publicCallCount"] !== "number" ||
    !Number.isSafeInteger(value["publicCallCount"]) ||
    value["publicCallCount"] < 0 ||
    value["publicCallCount"] > STRK20_LIMITS.actions
  ) {
    return null;
  }
  return {
    caller: value["caller"],
    executeAfter: value["executeAfter"],
    executeBefore: value["executeBefore"],
    publicCallCount: value["publicCallCount"],
  };
};

const isPoolFee = (value: unknown): value is string => {
  if (typeof value !== "string") {
    return false;
  }
  try {
    return canonicalStrk20PoolFee(value) === value;
  } catch {
    return false;
  }
};

type ExpectedPreparation = {
  readonly amount?: string;
  readonly kind: PrivacyPreparation["kind"];
  readonly recipient?: string;
  readonly tokenId?: string;
};

const hasRouteFee = (route: unknown, fee: unknown): boolean =>
  route === "public-account" ? isFeeEstimate(fee) : fee === undefined;

const readPreparation = (
  response: unknown,
  expected: ExpectedPreparation,
): PrivacyPreparation | null => {
  if (
    !isRecord(response) ||
    !hasOnlyKnownKeys(response, ["ok", "strk20Preparation"]) ||
    response["ok"] !== true ||
    !isRecord(response["strk20Preparation"])
  ) {
    return null;
  }
  const value = response["strk20Preparation"];
  const authorization =
    value["authorization"] === undefined ? undefined : readAuthorization(value["authorization"]);
  const relayFee =
    value["relayFee"] === undefined ? undefined : readPrivacyRelayFee(value["relayFee"]);
  if (
    !hasOnlyKnownKeys(value, [
      "amount",
      "authorization",
      "id",
      "kind",
      "networkFee",
      "payloadDigest",
      "poolAddress",
      "poolFeeFri",
      "recipient",
      "relayFee",
      "route",
      "summaries",
      "symbol",
      "tokenId",
    ]) ||
    value["kind"] !== expected.kind ||
    !hasRouteFee(value["route"], value["networkFee"]) ||
    (value["route"] !== "private-relay" && value["route"] !== "public-account") ||
    !isSha256Digest(value["id"]) ||
    typeof value["payloadDigest"] !== "string" ||
    value["id"] !== value["payloadDigest"] ||
    typeof value["poolAddress"] !== "string" ||
    !isNonZeroStarkFieldElement(value["poolAddress"]) ||
    !isSummaryList(value["summaries"]) ||
    !isDisplayString(value["symbol"]) ||
    !isTokenId(value["tokenId"]) ||
    (expected.tokenId !== undefined && value["tokenId"] !== expected.tokenId) ||
    (value["amount"] !== undefined &&
      (!isDecimalAmountText(value["amount"]) || value["amount"].length > MAX_DISPLAY_CHARACTERS)) ||
    (value["authorization"] !== undefined && !authorization) ||
    (value["relayFee"] !== undefined && !relayFee) ||
    (value["route"] === "private-relay" && !relayFee) ||
    (value["route"] === "private-relay" && value["poolFeeFri"] !== undefined) ||
    (value["route"] === "public-account" &&
      (value["authorization"] !== undefined ||
        value["relayFee"] !== undefined ||
        !isPoolFee(value["poolFeeFri"]))) ||
    (value["recipient"] !== undefined &&
      (typeof value["recipient"] !== "string" ||
        !isNonZeroStarkFieldElement(value["recipient"]))) ||
    (expected.amount !== undefined && value["amount"] !== expected.amount) ||
    (expected.recipient !== undefined &&
      (typeof value["recipient"] !== "string" ||
        !sameFelt(value["recipient"], expected.recipient))) ||
    // A deposit names whose private balance it credits — the depositor for a
    // shield, a registered third party otherwise — so the recipient is required
    // here exactly as it is for a transfer or a withdrawal.
    (value["kind"] === "deposit" &&
      (typeof value["amount"] !== "string" || typeof value["recipient"] !== "string")) ||
    ((value["kind"] === "transfer" || value["kind"] === "withdraw") &&
      (typeof value["amount"] !== "string" ||
        typeof value["recipient"] !== "string" ||
        value["route"] !== "private-relay")) ||
    (value["kind"] === "register" &&
      (value["amount"] !== undefined ||
        value["recipient"] !== undefined ||
        value["route"] !== "public-account"))
  ) {
    return null;
  }
  return {
    ...(typeof value["amount"] === "string" ? { amount: value["amount"] } : {}),
    ...(authorization ? { authorization } : {}),
    id: value["id"],
    kind: expected.kind,
    ...(isFeeEstimate(value["networkFee"]) ? { networkFee: value["networkFee"] } : {}),
    payloadDigest: value["payloadDigest"],
    poolAddress: value["poolAddress"],
    ...(typeof value["poolFeeFri"] === "string" ? { poolFeeFri: value["poolFeeFri"] } : {}),
    ...(typeof value["recipient"] === "string" ? { recipient: value["recipient"] } : {}),
    ...(relayFee ? { relayFee } : {}),
    route: value["route"],
    summaries: [...value["summaries"]],
    symbol: value["symbol"],
    tokenId: value["tokenId"],
  };
};

const readState = (response: unknown): PrivacyAccountState | null => {
  if (
    !isRecord(response) ||
    !hasOnlyKnownKeys(response, ["ok", "strk20State"]) ||
    response["ok"] !== true ||
    !isRecord(response["strk20State"])
  ) {
    return null;
  }
  const state = response["strk20State"];
  if (
    !hasOnlyKnownKeys(state, [
      "accountId",
      "balances",
      "networkId",
      "poolFeeFri",
      "relayConfigured",
      "registration",
    ]) ||
    !isStarknetNetworkId(state["networkId"]) ||
    !isAccountIdForNetwork(state["accountId"], state["networkId"]) ||
    !isPoolFee(state["poolFeeFri"]) ||
    typeof state["relayConfigured"] !== "boolean" ||
    (state["registration"] !== "pending" &&
      state["registration"] !== "registered" &&
      state["registration"] !== "unregistered") ||
    !Array.isArray(state["balances"]) ||
    state["balances"].length > STRK20_LIMITS.balances
  ) {
    return null;
  }
  const balances: PrivateBalanceView[] = [];
  for (const value of state["balances"]) {
    if (
      !isRecord(value) ||
      !hasOnlyKnownKeys(value, ["balance", "formatted", "symbol", "token", "tokenId"]) ||
      typeof value["balance"] !== "string" ||
      !isStarkFieldElement(value["balance"]) ||
      !isDisplayString(value["formatted"]) ||
      !isDisplayString(value["symbol"]) ||
      typeof value["token"] !== "string" ||
      !isNonZeroStarkFieldElement(value["token"]) ||
      !isTokenId(value["tokenId"]) ||
      value["tokenId"] !== `${state["networkId"]}:${value["symbol"]}:${value["token"]}`
    ) {
      return null;
    }
    balances.push({
      balance: value["balance"],
      formatted: value["formatted"],
      symbol: value["symbol"],
      token: value["token"],
      tokenId: value["tokenId"],
    });
  }
  if (new Set(balances.map((balance) => BigInt(balance.token))).size !== balances.length) {
    return null;
  }
  return {
    accountId: state["accountId"],
    balances,
    networkId: state["networkId"],
    poolFeeFri: state["poolFeeFri"],
    relayConfigured: state["relayConfigured"],
    registration: state["registration"],
  };
};

/**
 * Creates privacy journey methods over the side panel's privileged send
 * function. Every response is validated before entering render state.
 *
 * A shield's proof, an activation's proof, and every confirmed execution are
 * run by a tracked background job and polled for (see
 * ./privacy-preparation-job); `options.pause` is that poll's timing seam, and
 * each of those methods takes an optional progress sink for its working screen.
 */
export const createPrivacyRuntimeClient = (
  sendMessage: (message: unknown) => Promise<unknown>,
  options: PreparationJobOptions = {},
) => {
  const job = (
    start: Readonly<Record<string, unknown>>,
    onProgress: PreparationProgressSink | undefined,
  ): Promise<unknown> =>
    runPreparationJob(sendMessage, start, {
      ...options,
      ...(onProgress ? { onProgress } : {}),
    });
  return {
    async executePrivacyPreparation(
      preparationId: string,
      onProgress?: PreparationProgressSink,
    ): Promise<string> {
      // The hash is the job's stored outcome: a poll after settlement returns it
      // again and submits nothing, and the one-time claim behind it means the
      // same preparation cannot be executed twice.
      const response = await job({ preparationId, type: "wallet.strk20Execute" }, onProgress);
      if (
        isRecord(response) &&
        hasOnlyKnownKeys(response, ["ok", "transactionHash"]) &&
        response["ok"] === true &&
        typeof response["transactionHash"] === "string" &&
        isNonZeroStarkFieldElement(response["transactionHash"])
      ) {
        return response["transactionHash"];
      }
      throw responseError(response, "Private transaction failed");
    },
    async loadPrivacyState(): Promise<PrivacyAccountState> {
      const response = await sendMessage({ type: "wallet.strk20State" });
      const state = readState(response);
      if (state) {
        return state;
      }
      throw responseError(response, "Private balances unavailable");
    },
    async preparePrivacyDeposit(
      tokenId: string,
      amount: string,
      recipient: string,
      onProgress?: PreparationProgressSink,
    ): Promise<PrivacyPreparation> {
      const response = await job(
        { amount, recipient, tokenId, type: "wallet.strk20PrepareDeposit" },
        onProgress,
      );
      const preparation = readPreparation(response, {
        amount,
        kind: "deposit",
        recipient,
        tokenId,
      });
      if (preparation) {
        return preparation;
      }
      throw responseError(response, "Shielding preparation failed");
    },
    async preparePrivacyRegistration(
      onProgress?: PreparationProgressSink,
    ): Promise<PrivacyPreparation> {
      const response = await job({ type: "wallet.strk20PrepareRegistration" }, onProgress);
      const preparation = readPreparation(response, { kind: "register" });
      if (preparation) {
        return preparation;
      }
      throw responseError(response, "Privacy activation preparation failed");
    },
    async preparePrivacyTransfer(
      tokenId: string,
      recipient: string,
      amount: string,
    ): Promise<PrivacyPreparation> {
      const response = await sendMessage({
        amount,
        recipient,
        tokenId,
        type: "wallet.strk20PrepareTransfer",
      });
      const preparation = readPreparation(response, {
        amount,
        kind: "transfer",
        recipient,
        tokenId,
      });
      if (preparation) {
        return preparation;
      }
      throw responseError(response, "Private send preparation failed");
    },
    async preparePrivacyWithdraw(
      tokenId: string,
      recipient: string,
      amount: string,
    ): Promise<PrivacyPreparation> {
      const response = await sendMessage({
        amount,
        recipient,
        tokenId,
        type: "wallet.strk20PrepareWithdraw",
      });
      const preparation = readPreparation(response, {
        amount,
        kind: "withdraw",
        recipient,
        tokenId,
      });
      if (preparation) {
        return preparation;
      }
      throw responseError(response, "Unshielding preparation failed");
    },
    async loadPrivacyRecipientStatus(
      tokenId: string,
      address: string,
    ): Promise<"registered" | "unregistered"> {
      const response = await sendMessage({
        address,
        tokenId,
        type: "wallet.strk20RecipientStatus",
      });
      if (
        isRecord(response) &&
        hasOnlyKnownKeys(response, ["ok", "strk20RecipientRegistration"]) &&
        response["ok"] === true &&
        (response["strk20RecipientRegistration"] === "registered" ||
          response["strk20RecipientRegistration"] === "unregistered")
      ) {
        return response["strk20RecipientRegistration"];
      }
      throw responseError(response, "Recipient check unavailable");
    },
  };
};
