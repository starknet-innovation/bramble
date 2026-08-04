/**
 * Strict extension-runtime client for wallet-owned STRK20 journeys.
 */

import { isErrorResponse } from "../popup/responses";
import { hasOnlyKnownKeys, isRecord } from "../shared/json";
import {
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
  isStarknetNetworkId,
} from "../starknet/networks";
import type { PaymasterAuthorizationReview } from "../starknet/strk20/paymaster-typed-data";
import { STRK20_LIMITS } from "../starknet/strk20/schemas";
import { isTokenId } from "../storage/preferences-entries";
import { isAccountId } from "../storage/vault-schema";

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
  /** Pool action fee in FRI when known, for pre-quote fee display. */
  readonly poolFeeFri?: string;
  readonly registration: "registered" | "unregistered";
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
  readonly payloadDigest: string;
  readonly poolAddress: string;
  readonly recipient?: string;
  readonly route: "private-relay" | "public-account";
  readonly relayFee?: {
    readonly amount: string;
    readonly recipient: string;
    readonly token: string;
  };
  readonly summaries: readonly string[];
  readonly symbol: string;
  readonly tokenId: string;
};

const errorFrom = (response: unknown, fallback: string): Error =>
  new Error(isErrorResponse(response) ? response.error : fallback);

const PREPARATION_ID_PATTERN = /^sha256:[0-9a-f]{64}$/;
const DISPLAY_AMOUNT_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const MAX_SUMMARIES = 32;
const MAX_SUMMARY_CHARACTERS = 256;
const MAX_DISPLAY_CHARACTERS = 128;

const isDisplayString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_DISPLAY_CHARACTERS;

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) &&
  value.length <= MAX_SUMMARIES &&
  value.every(
    (entry) =>
      typeof entry === "string" && entry.length > 0 && entry.length <= MAX_SUMMARY_CHARACTERS,
  );

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

const readRelayFee = (value: unknown): NonNullable<PrivacyPreparation["relayFee"]> | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["amount", "recipient", "token"]) ||
    typeof value["amount"] !== "string" ||
    !isStarkFieldElement(value["amount"]) ||
    typeof value["recipient"] !== "string" ||
    !isNonZeroStarkFieldElement(value["recipient"]) ||
    typeof value["token"] !== "string" ||
    !isNonZeroStarkFieldElement(value["token"])
  ) {
    return null;
  }
  return { amount: value["amount"], recipient: value["recipient"], token: value["token"] };
};

const readPreparation = (
  response: unknown,
  expectedKind: PrivacyPreparation["kind"],
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
  const relayFee = value["relayFee"] === undefined ? undefined : readRelayFee(value["relayFee"]);
  if (
    !hasOnlyKnownKeys(value, [
      "amount",
      "authorization",
      "id",
      "kind",
      "payloadDigest",
      "poolAddress",
      "recipient",
      "relayFee",
      "route",
      "summaries",
      "symbol",
      "tokenId",
    ]) ||
    value["kind"] !== expectedKind ||
    (value["route"] !== "private-relay" && value["route"] !== "public-account") ||
    typeof value["id"] !== "string" ||
    !PREPARATION_ID_PATTERN.test(value["id"]) ||
    typeof value["payloadDigest"] !== "string" ||
    value["id"] !== value["payloadDigest"] ||
    typeof value["poolAddress"] !== "string" ||
    !isNonZeroStarkFieldElement(value["poolAddress"]) ||
    !isStringArray(value["summaries"]) ||
    !isDisplayString(value["symbol"]) ||
    !isTokenId(value["tokenId"]) ||
    (value["amount"] !== undefined &&
      (typeof value["amount"] !== "string" ||
        value["amount"].length > MAX_DISPLAY_CHARACTERS ||
        !DISPLAY_AMOUNT_PATTERN.test(value["amount"]))) ||
    (value["authorization"] !== undefined && !authorization) ||
    (value["relayFee"] !== undefined && !relayFee) ||
    (value["route"] === "private-relay" && !relayFee) ||
    (value["route"] === "public-account" &&
      (value["authorization"] !== undefined || value["relayFee"] !== undefined)) ||
    (value["recipient"] !== undefined &&
      (typeof value["recipient"] !== "string" ||
        !isNonZeroStarkFieldElement(value["recipient"]))) ||
    (value["kind"] === "deposit" &&
      (typeof value["amount"] !== "string" || value["recipient"] !== undefined)) ||
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
    kind: expectedKind,
    payloadDigest: value["payloadDigest"],
    poolAddress: value["poolAddress"],
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
      "registration",
    ]) ||
    !isAccountId(state["accountId"]) ||
    !isStarknetNetworkId(state["networkId"]) ||
    (state["poolFeeFri"] !== undefined &&
      (typeof state["poolFeeFri"] !== "string" || !isStarkFieldElement(state["poolFeeFri"]))) ||
    (state["registration"] !== "registered" && state["registration"] !== "unregistered") ||
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
      !isTokenId(value["tokenId"])
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
    ...(typeof state["poolFeeFri"] === "string" ? { poolFeeFri: state["poolFeeFri"] } : {}),
    registration: state["registration"],
  };
};

/**
 * Creates privacy journey methods over the side panel's privileged send
 * function. Every response is validated before entering render state.
 */
export const createPrivacyRuntimeClient = (
  sendMessage: (message: unknown) => Promise<unknown>,
) => ({
  async executePrivacyPreparation(preparationId: string): Promise<string> {
    const response = await sendMessage({
      preparationId,
      type: "wallet.strk20Execute",
    });
    if (
      isRecord(response) &&
      hasOnlyKnownKeys(response, ["ok", "transactionHash"]) &&
      response["ok"] === true &&
      typeof response["transactionHash"] === "string" &&
      isNonZeroStarkFieldElement(response["transactionHash"])
    ) {
      return response["transactionHash"];
    }
    throw errorFrom(response, "Private transaction failed");
  },
  async loadPrivacyState(): Promise<PrivacyAccountState> {
    const response = await sendMessage({ type: "wallet.strk20State" });
    const state = readState(response);
    if (state) {
      return state;
    }
    throw errorFrom(response, "Private balances unavailable");
  },
  async preparePrivacyDeposit(tokenId: string, amount: string): Promise<PrivacyPreparation> {
    const response = await sendMessage({
      amount,
      tokenId,
      type: "wallet.strk20PrepareDeposit",
    });
    const preparation = readPreparation(response, "deposit");
    if (preparation) {
      return preparation;
    }
    throw errorFrom(response, "Shielding preparation failed");
  },
  async preparePrivacyRegistration(): Promise<PrivacyPreparation> {
    const response = await sendMessage({ type: "wallet.strk20PrepareRegistration" });
    const preparation = readPreparation(response, "register");
    if (preparation) {
      return preparation;
    }
    throw errorFrom(response, "Privacy activation preparation failed");
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
    const preparation = readPreparation(response, "transfer");
    if (preparation) {
      return preparation;
    }
    throw errorFrom(response, "Private send preparation failed");
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
    const preparation = readPreparation(response, "withdraw");
    if (preparation) {
      return preparation;
    }
    throw errorFrom(response, "Unshielding preparation failed");
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
    throw errorFrom(response, "Recipient check unavailable");
  },
});
