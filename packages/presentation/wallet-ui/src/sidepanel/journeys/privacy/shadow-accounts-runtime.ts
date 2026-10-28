/**
 * Strict runtime client for the Shadow accounts view (issue 443, PR 5). Every
 * response is validated before it reaches render state; the records name
 * sites the user used privately and are never persisted by the panel.
 */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { isWalletOrigin } from "@bramble/core/origin";
import { isNonZeroStarkFieldElement, isStarkFieldElement } from "@bramble/wallet-model/networks";
import { isTokenId } from "@bramble/wallet-model/preferences";
import { isStrk20DappName } from "@bramble/wallet-protocol/strk20";
import { responseError } from "../../runtime/runtime-errors";
import { type PrivacyPreparation, readPrivacyPreparation } from "./privacy-runtime";

// Stable error codes for an unrecognised answer, each with reviewed copy in the
// friendly-error privacy table.
const SHADOW_ACCOUNTS_UNAVAILABLE = "shadow_accounts_unavailable";
const SHADOW_ACCOUNT_BALANCES_UNAVAILABLE = "shadow_account_balances_unavailable";
const SHADOW_ACCOUNT_SWEEP_UNAVAILABLE = "shadow_account_sweep_unavailable";

const MAX_SCOPES = 128;
const MAX_NONCES = 64;
const MAX_ACCOUNTS = 80;
const MAX_BALANCES = 64;

/** One recorded scope as the view lists it. */
export type ShadowScopeView = {
  readonly anonymizer: string;
  readonly current: boolean;
  readonly label: string;
  readonly nonces: readonly string[];
  readonly origin: string;
};

/** One shadow account of a scope with its non-zero tracked balances. */
export type ShadowAccountView = {
  readonly address: string;
  readonly balances: readonly {
    readonly balance: string;
    readonly formatted: string;
    readonly symbol: string;
    readonly tokenId: string;
  }[];
  readonly deployed: boolean;
  readonly nonce: string;
  readonly recorded: boolean;
};

const isFeltList = (value: unknown, max: number): value is readonly string[] =>
  Array.isArray(value) &&
  value.length <= max &&
  value.every((item) => typeof item === "string" && isStarkFieldElement(item));

const isScope = (value: unknown): value is ShadowScopeView =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["anonymizer", "current", "label", "nonces", "origin"]) &&
  typeof value["anonymizer"] === "string" &&
  isNonZeroStarkFieldElement(value["anonymizer"]) &&
  typeof value["current"] === "boolean" &&
  isStrk20DappName(value["label"]) &&
  typeof value["origin"] === "string" &&
  isWalletOrigin(value["origin"]) &&
  isFeltList(value["nonces"], MAX_NONCES);

const isText = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 128;

const isAccount = (value: unknown): value is ShadowAccountView =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["address", "balances", "deployed", "nonce", "recorded"]) &&
  typeof value["address"] === "string" &&
  isNonZeroStarkFieldElement(value["address"]) &&
  typeof value["deployed"] === "boolean" &&
  typeof value["recorded"] === "boolean" &&
  typeof value["nonce"] === "string" &&
  isStarkFieldElement(value["nonce"]) &&
  Array.isArray(value["balances"]) &&
  value["balances"].length <= MAX_BALANCES &&
  value["balances"].every(
    (balance) =>
      isRecord(balance) &&
      hasOnlyKnownKeys(balance, ["balance", "formatted", "symbol", "tokenId"]) &&
      typeof balance["balance"] === "string" &&
      isStarkFieldElement(balance["balance"]) &&
      isText(balance["formatted"]) &&
      isText(balance["symbol"]) &&
      isTokenId(balance["tokenId"]),
  );

/**
 * Creates the Shadow accounts methods over the panel's privileged channel.
 * Malformed responses reject with the background's refusal or a fallback.
 */
export const createShadowAccountsRuntimeClient = (
  sendMessage: (message: unknown) => Promise<unknown>,
) => ({
  async loadShadowAccounts(): Promise<readonly ShadowScopeView[]> {
    const response = await sendMessage({ type: "wallet.strk20ShadowAccounts" });
    const listing =
      isRecord(response) &&
      hasOnlyKnownKeys(response, ["ok", "strk20ShadowAccounts"]) &&
      response["ok"] === true &&
      isRecord(response["strk20ShadowAccounts"]) &&
      hasOnlyKnownKeys(response["strk20ShadowAccounts"], ["scopes"])
        ? response["strk20ShadowAccounts"]["scopes"]
        : null;
    if (Array.isArray(listing) && listing.length <= MAX_SCOPES && listing.every(isScope)) {
      return listing;
    }
    throw responseError(response, SHADOW_ACCOUNTS_UNAVAILABLE);
  },
  async loadShadowAccountBalances(
    origin: string,
    label: string,
  ): Promise<{
    readonly accounts: readonly ShadowAccountView[];
    readonly unlisted: readonly string[];
  }> {
    const response = await sendMessage({
      label,
      origin,
      type: "wallet.strk20ShadowAccountBalances",
    });
    const read =
      isRecord(response) &&
      hasOnlyKnownKeys(response, ["ok", "strk20ShadowAccountBalances"]) &&
      response["ok"] === true &&
      isRecord(response["strk20ShadowAccountBalances"]) &&
      hasOnlyKnownKeys(response["strk20ShadowAccountBalances"], ["accounts", "unlisted"])
        ? response["strk20ShadowAccountBalances"]
        : null;
    const accounts = read?.["accounts"];
    const unlisted = read?.["unlisted"];
    if (
      Array.isArray(accounts) &&
      accounts.length <= MAX_ACCOUNTS &&
      accounts.every(isAccount) &&
      isFeltList(unlisted, MAX_NONCES)
    ) {
      return { accounts, unlisted };
    }
    throw responseError(response, SHADOW_ACCOUNT_BALANCES_UNAVAILABLE);
  },
  async prepareShadowSweep(
    origin: string,
    label: string,
    nonce: string,
  ): Promise<PrivacyPreparation> {
    const response = await sendMessage({
      label,
      nonce,
      origin,
      type: "wallet.strk20PrepareShadowSweep",
    });
    const preparation = readPrivacyPreparation(response, { kind: "shadow-sweep" });
    if (preparation) {
      return preparation;
    }
    throw responseError(response, SHADOW_ACCOUNT_SWEEP_UNAVAILABLE);
  },
});
