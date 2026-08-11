/**
 * Pure popup validators for dapp approval and connected-site data returned by
 * the background boundary.
 */

import { isUuid } from "@mc-wallet/core/ids";
import {
  hasOnlyKnownKeys,
  hasUniqueStrings,
  isJson,
  isRecord,
  type Json,
} from "@mc-wallet/core/json";
import { isWalletOrigin } from "@mc-wallet/core/origin";
import { isAccountIdForNetwork } from "@mc-wallet/wallet-model/accounts";
import {
  isStarkFieldElement,
  isStarknetNetworkId,
  STARKNET_NETWORKS,
} from "@mc-wallet/wallet-model/networks";
import {
  readStrk20Action,
  readStrk20Actions,
  type Strk20Action,
  type Strk20WithdrawAction,
} from "@mc-wallet/wallet-protocol/strk20";

/**
 * ERC20 token metadata carried by a watch-asset approval.
 */
export type WatchAssetToken = {
  readonly address: string;
  readonly decimals: number;
  readonly name: string;
  readonly networkId: string;
  readonly symbol: string;
};

/**
 * One decoded risk flag surfaced on an invoke approval card.
 */
export type ApprovalRiskFlag = {
  readonly code: string;
  readonly message: string;
};

/**
 * Display-safe declaration facts returned without exposing the contract class.
 */
export type DeclarationReview = {
  readonly abiEntryCount: number;
  readonly accountDeployment: "deployed" | "undeployed" | "unknown";
  readonly classHash?: string;
  readonly compiledClassHash: string;
  readonly deploymentFee: { readonly overallFee: string; readonly unit: string } | null;
  readonly deploymentFeeEstimateFailed: boolean;
  readonly entryPointCount: number;
  readonly fee: { readonly overallFee: string; readonly unit: string } | null;
  readonly feeEstimateFailed: boolean;
  readonly sierraProgramLength: number;
};

/**
 * Exact account, network, chain, and private-payload digest reviewed by the
 * user for a security-sensitive approval.
 */
export type ApprovalContext = {
  readonly accountId: string;
  readonly chainId: string;
  readonly networkId: string;
  readonly payloadDigest: string;
};

/**
 * Pending dapp approval item shown in the popup. `kind` defaults to a
 * connection prompt when absent; watch-asset prompts also carry `token`; invoke
 * prompts carry decoded call `summaries`, risk `flags`, and the fee review
 * (`fee`/`feeEstimateFailed`/`requiresDeployment`, classified like the Send
 * review); `blocked`/`insights` carry phishing and site-reputation signals.
 */
export type PendingApproval = {
  readonly actionReviews?: readonly Strk20Action[];
  readonly blocked?: boolean;
  readonly context?: ApprovalContext;
  readonly declaration?: DeclarationReview;
  readonly fee?: { readonly overallFee: string; readonly unit: string } | null;
  readonly feeAffordability?: "insufficient" | "ok" | "unknown";
  readonly feeEstimateFailed?: boolean;
  readonly feeEstimatePending?: boolean;
  readonly flags?: readonly ApprovalRiskFlag[];
  readonly id: string;
  readonly insights?: readonly string[];
  readonly kind?:
    | "add-chain"
    | "connect"
    | "declare"
    | "invoke"
    | "sign-typed-data"
    | "strk20-balances"
    | "strk20-invoke"
    | "strk20-prepare"
    | "strk20-register"
    | "strk20-subaccount"
    | "switch-chain"
    | "watch-asset";
  readonly origin: string;
  readonly relayFeeAction?: Strk20WithdrawAction;
  readonly requiresDeployment?: boolean;
  readonly summaries?: readonly string[];
  readonly token?: WatchAssetToken;
  readonly typedData?: Json;
};

/**
 * A site with an active connection grant plus the number of accounts it can
 * see, shown in the connected-sites manager.
 */
export type ConnectedSite = {
  readonly accountCount: number;
  readonly origin: string;
};

/**
 * Connected-sites response accepted from the background boundary.
 */
export type ConnectedSitesResponse = {
  readonly ok: true;
  readonly sites: readonly ConnectedSite[];
};

/**
 * Pending approval response accepted from the background boundary.
 */
export type PendingApprovalsResponse = {
  readonly ok: true;
  readonly pending: readonly PendingApproval[];
};

const isWatchAssetToken = (value: unknown): value is WatchAssetToken =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["address", "decimals", "name", "networkId", "symbol"]) &&
  typeof value["address"] === "string" &&
  isStarkFieldElement(value["address"]) &&
  typeof value["decimals"] === "number" &&
  Number.isSafeInteger(value["decimals"]) &&
  value["decimals"] >= 0 &&
  value["decimals"] <= 36 &&
  typeof value["name"] === "string" &&
  value["name"].length > 0 &&
  value["name"].length <= 64 &&
  isStarknetNetworkId(value["networkId"]) &&
  typeof value["symbol"] === "string" &&
  /^[A-Z0-9]{2,12}$/.test(value["symbol"]);

const isInsightText = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 200;

const isSummaryText = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 300;

const isApprovalRiskFlag = (value: unknown): value is ApprovalRiskFlag =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["code", "message"]) &&
  typeof value["code"] === "string" &&
  /^[a-z][a-z-]{1,40}$/.test(value["code"]) &&
  typeof value["message"] === "string" &&
  value["message"].length > 0 &&
  value["message"].length <= 300;

const isApprovalContext = (value: unknown): value is ApprovalContext =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["accountId", "chainId", "networkId", "payloadDigest"]) &&
  isStarknetNetworkId(value["networkId"]) &&
  isAccountIdForNetwork(value["accountId"], value["networkId"]) &&
  value["chainId"] === STARKNET_NETWORKS[value["networkId"]].chainId &&
  typeof value["payloadDigest"] === "string" &&
  /^sha256:[0-9a-f]{64}$/.test(value["payloadDigest"]);

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isFee = (value: unknown): value is { readonly overallFee: string; readonly unit: string } =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["overallFee", "unit"]) &&
  typeof value["overallFee"] === "string" &&
  /^(?:0|[1-9][0-9]*)$/.test(value["overallFee"]) &&
  (value["unit"] === "FRI" || value["unit"] === "WEI");

const isDeclarationReview = (value: unknown): value is DeclarationReview =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, [
    "abiEntryCount",
    "accountDeployment",
    "classHash",
    "compiledClassHash",
    "deploymentFee",
    "deploymentFeeEstimateFailed",
    "entryPointCount",
    "fee",
    "feeEstimateFailed",
    "sierraProgramLength",
  ]) &&
  isCount(value["abiEntryCount"]) &&
  (value["accountDeployment"] === "deployed" ||
    value["accountDeployment"] === "undeployed" ||
    value["accountDeployment"] === "unknown") &&
  (value["classHash"] === undefined ||
    (typeof value["classHash"] === "string" && isStarkFieldElement(value["classHash"]))) &&
  typeof value["compiledClassHash"] === "string" &&
  isStarkFieldElement(value["compiledClassHash"]) &&
  (value["deploymentFee"] === null || isFee(value["deploymentFee"])) &&
  typeof value["deploymentFeeEstimateFailed"] === "boolean" &&
  (value["accountDeployment"] === "undeployed"
    ? value["deploymentFeeEstimateFailed"] === (value["deploymentFee"] === null)
    : value["deploymentFee"] === null && value["deploymentFeeEstimateFailed"] === false) &&
  isCount(value["entryPointCount"]) &&
  (value["fee"] === null || isFee(value["fee"])) &&
  typeof value["feeEstimateFailed"] === "boolean" &&
  value["feeEstimateFailed"] === (value["fee"] === null) &&
  isCount(value["sierraProgramLength"]);

const isInvokeFeeReview = (value: Readonly<Record<string, unknown>>): boolean =>
  (value["fee"] === undefined || value["fee"] === null || isFee(value["fee"])) &&
  (value["feeAffordability"] === undefined ||
    value["feeAffordability"] === "insufficient" ||
    value["feeAffordability"] === "ok" ||
    value["feeAffordability"] === "unknown") &&
  (value["feeEstimateFailed"] === undefined || typeof value["feeEstimateFailed"] === "boolean") &&
  (value["feeEstimatePending"] === undefined || typeof value["feeEstimatePending"] === "boolean") &&
  (value["requiresDeployment"] === undefined || typeof value["requiresDeployment"] === "boolean") &&
  (value["requiresDeployment"] !== true ||
    ((value["fee"] ?? null) === null && value["feeEstimateFailed"] !== true)) &&
  (value["feeEstimateFailed"] !== true || (value["fee"] ?? null) === null) &&
  (value["feeEstimatePending"] !== true ||
    ((value["fee"] ?? null) === null &&
      value["feeEstimateFailed"] !== true &&
      value["requiresDeployment"] !== true)) &&
  ((value["fee"] ?? null) !== null ||
    value["feeAffordability"] === undefined ||
    value["feeAffordability"] === "unknown");

const isPendingApproval = (value: unknown): value is PendingApproval => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, [
      "actionReviews",
      "blocked",
      "context",
      "declaration",
      "fee",
      "feeAffordability",
      "feeEstimateFailed",
      "feeEstimatePending",
      "flags",
      "id",
      "insights",
      "kind",
      "origin",
      "relayFeeAction",
      "requiresDeployment",
      "summaries",
      "token",
      "typedData",
    ]) ||
    typeof value["id"] !== "string" ||
    !isUuid(value["id"]) ||
    typeof value["origin"] !== "string" ||
    !isWalletOrigin(value["origin"]) ||
    (value["typedData"] !== undefined && !isJson(value["typedData"])) ||
    (value["kind"] !== undefined &&
      value["kind"] !== "add-chain" &&
      value["kind"] !== "connect" &&
      value["kind"] !== "declare" &&
      value["kind"] !== "invoke" &&
      value["kind"] !== "sign-typed-data" &&
      value["kind"] !== "strk20-balances" &&
      value["kind"] !== "strk20-invoke" &&
      value["kind"] !== "strk20-prepare" &&
      value["kind"] !== "strk20-register" &&
      value["kind"] !== "strk20-subaccount" &&
      value["kind"] !== "switch-chain" &&
      value["kind"] !== "watch-asset") ||
    (value["blocked"] !== undefined && typeof value["blocked"] !== "boolean") ||
    (value["insights"] !== undefined &&
      !(Array.isArray(value["insights"]) && value["insights"].every(isInsightText))) ||
    (value["summaries"] !== undefined &&
      !(Array.isArray(value["summaries"]) && value["summaries"].every(isSummaryText))) ||
    (value["flags"] !== undefined &&
      !(Array.isArray(value["flags"]) && value["flags"].every(isApprovalRiskFlag)))
  ) {
    return false;
  }
  const tokenValid =
    value["kind"] === "watch-asset"
      ? isWatchAssetToken(value["token"])
      : value["token"] === undefined;
  // The fee review travels only on invoke prompts and must be internally
  // consistent, mirroring `resolveReviewFee`: an undeployed account has no
  // estimate and no failure; a failed estimate carries no amount. Inconsistent
  // combinations are rejected at the boundary rather than rendered.
  const feeValid =
    value["kind"] === "invoke"
      ? isInvokeFeeReview(value)
      : value["fee"] === undefined &&
        value["feeAffordability"] === undefined &&
        value["feeEstimateFailed"] === undefined &&
        value["feeEstimatePending"] === undefined &&
        value["requiresDeployment"] === undefined;
  const needsContext =
    value["kind"] === "declare" ||
    value["kind"] === "invoke" ||
    value["kind"] === "sign-typed-data" ||
    value["kind"] === "strk20-balances" ||
    value["kind"] === "strk20-invoke" ||
    value["kind"] === "strk20-prepare" ||
    value["kind"] === "strk20-register" ||
    value["kind"] === "strk20-subaccount";
  const declarationValid =
    value["kind"] === "declare"
      ? isDeclarationReview(value["declaration"])
      : value["declaration"] === undefined;
  const needsActionReview = value["kind"] === "strk20-invoke" || value["kind"] === "strk20-prepare";
  const actionReviewValid = needsActionReview
    ? readStrk20Actions(value["actionReviews"]) !== null
    : value["actionReviews"] === undefined;
  const relayFeeAction =
    value["relayFeeAction"] === undefined ? undefined : readStrk20Action(value["relayFeeAction"]);
  const relayFeeValid =
    relayFeeAction === undefined ||
    (value["kind"] === "strk20-invoke" && relayFeeAction?.type === "withdraw");
  return (
    actionReviewValid &&
    relayFeeValid &&
    tokenValid &&
    feeValid &&
    declarationValid &&
    (needsContext ? isApprovalContext(value["context"]) : value["context"] === undefined)
  );
};

const isConnectedSite = (value: unknown): value is ConnectedSite =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["accountCount", "origin"]) &&
  typeof value["accountCount"] === "number" &&
  Number.isSafeInteger(value["accountCount"]) &&
  value["accountCount"] >= 0 &&
  typeof value["origin"] === "string" &&
  isWalletOrigin(value["origin"]);

/**
 * Checks pending approval responses before rendering.
 */
export const isPendingApprovalsResponse = (value: unknown): value is PendingApprovalsResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["ok", "pending"]) &&
  value["ok"] === true &&
  Array.isArray(value["pending"]) &&
  value["pending"].every(isPendingApproval) &&
  hasUniqueStrings(value["pending"].map((approval) => approval.id)) &&
  hasUniqueStrings(
    value["pending"]
      // Only connection prompts dedupe per origin; watch-asset and invoke
      // prompts legitimately queue multiple entries for the same site.
      .filter((approval) => approval.kind === undefined || approval.kind === "connect")
      .map((approval) => approval.origin),
  );

/**
 * Checks connected-sites responses before rendering the permissions manager.
 */
export const isConnectedSitesResponse = (value: unknown): value is ConnectedSitesResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["ok", "sites"]) &&
  value["ok"] === true &&
  Array.isArray(value["sites"]) &&
  value["sites"].every(isConnectedSite) &&
  hasUniqueStrings(value["sites"].map((site) => site.origin));
