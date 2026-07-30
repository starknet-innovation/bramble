/**
 * Strict extension-runtime client for wallet-owned STRK20 journeys.
 */

import { isErrorResponse } from "../popup/responses";
import { isRecord } from "../shared/json";

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
  readonly registration: "registered" | "unregistered";
};

/**
 * Immutable review metadata for one register or deposit operation.
 */
export type PrivacyPreparation = {
  readonly amount?: string;
  readonly id: string;
  readonly kind: "deposit" | "register";
  readonly payloadDigest: string;
  readonly poolAddress: string;
  readonly route: "private-relay" | "public-account";
  readonly summaries: readonly string[];
  readonly symbol: string;
  readonly tokenId: string;
};

const errorFrom = (response: unknown, fallback: string): Error =>
  new Error(isErrorResponse(response) ? response.error : fallback);

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const readPreparation = (response: unknown): PrivacyPreparation | null => {
  if (!isRecord(response) || response["ok"] !== true || !isRecord(response["strk20Preparation"])) {
    return null;
  }
  const value = response["strk20Preparation"];
  if (
    (value["kind"] !== "deposit" && value["kind"] !== "register") ||
    (value["route"] !== "private-relay" && value["route"] !== "public-account") ||
    typeof value["id"] !== "string" ||
    typeof value["payloadDigest"] !== "string" ||
    value["id"] !== value["payloadDigest"] ||
    typeof value["poolAddress"] !== "string" ||
    !isStringArray(value["summaries"]) ||
    typeof value["symbol"] !== "string" ||
    typeof value["tokenId"] !== "string" ||
    (value["amount"] !== undefined && typeof value["amount"] !== "string")
  ) {
    return null;
  }
  return value as PrivacyPreparation;
};

const readState = (response: unknown): PrivacyAccountState | null => {
  if (!isRecord(response) || response["ok"] !== true || !isRecord(response["strk20State"])) {
    return null;
  }
  const state = response["strk20State"];
  if (
    typeof state["accountId"] !== "string" ||
    typeof state["networkId"] !== "string" ||
    (state["registration"] !== "registered" && state["registration"] !== "unregistered") ||
    !Array.isArray(state["balances"])
  ) {
    return null;
  }
  const balances: PrivateBalanceView[] = [];
  for (const value of state["balances"]) {
    if (
      !isRecord(value) ||
      !["balance", "formatted", "symbol", "token", "tokenId"].every(
        (key) => typeof value[key] === "string",
      )
    ) {
      return null;
    }
    balances.push(value as PrivateBalanceView);
  }
  return {
    accountId: state["accountId"],
    balances,
    networkId: state["networkId"],
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
      response["ok"] === true &&
      typeof response["transactionHash"] === "string"
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
    const preparation = readPreparation(response);
    if (preparation) {
      return preparation;
    }
    throw errorFrom(response, "Shielding preparation failed");
  },
  async preparePrivacyRegistration(): Promise<PrivacyPreparation> {
    const response = await sendMessage({ type: "wallet.strk20PrepareRegistration" });
    const preparation = readPreparation(response);
    if (preparation) {
      return preparation;
    }
    throw errorFrom(response, "Privacy activation preparation failed");
  },
});
