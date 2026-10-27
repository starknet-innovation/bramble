/**
 * Pure popup validators for dapp approval and connected-site data returned by
 * the background boundary.
 */

import { isSha256Digest, isUuid } from "@bramble/core/ids";
import {
  hasOnlyArrayEntries,
  hasOnlyKnownKeys,
  hasUniqueStrings,
  isJson,
  isOwnDataProperty,
  isRecord,
  isRiskFlagCode,
  isSafeDecimals,
  isTokenName,
  isTokenSymbol,
  JSON_BUDGETS,
} from "@bramble/core/json";
import { isWalletOrigin } from "@bramble/core/origin";
import { isGaslessFeeOffer } from "@bramble/privacy/gasless-request";
import { isFeeEstimate as isFee } from "@bramble/starknet/fee-bounds";
import { isAccountIdForNetwork } from "@bramble/wallet-model/accounts";
import {
  isStarkFieldElement,
  isStarknetNetworkId,
  STARKNET_NETWORKS,
} from "@bramble/wallet-model/networks";
import {
  APPROVAL_SUMMARY_MAX_LENGTH,
  type ApprovalContext,
  type ApprovalRiskFlag,
  type ConnectedSite,
  type DeclarationReview,
  type PendingApproval,
  type WatchAssetToken,
} from "@bramble/wallet-protocol/extension-responses";
import { readProviderInvokeCall } from "@bramble/wallet-protocol/invoke";
import { readStrk20Action, readStrk20Actions } from "@bramble/wallet-protocol/strk20";

/**
 * Shared approval and connected-site wire shapes after runtime validation.
 */
export type {
  ApprovalReviewAsset,
  ConnectedSite,
  PendingApproval,
  WatchAssetToken,
} from "@bramble/wallet-protocol/extension-responses";

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
  isSafeDecimals(value["decimals"]) &&
  isTokenName(value["name"]) &&
  isStarknetNetworkId(value["networkId"]) &&
  isTokenSymbol(value["symbol"]);

const isApprovalReviewAsset = (value: unknown): boolean =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["address", "symbol"]) &&
  typeof value["address"] === "string" &&
  isStarkFieldElement(value["address"]) &&
  typeof value["symbol"] === "string" &&
  isTokenSymbol(value["symbol"]);

const isInsightText = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 200;

const isSummaryText = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= APPROVAL_SUMMARY_MAX_LENGTH;

const isApprovalRiskFlag = (value: unknown): value is ApprovalRiskFlag =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["code", "message"]) &&
  isRiskFlagCode(value["code"]) &&
  typeof value["message"] === "string" &&
  value["message"].length > 0 &&
  value["message"].length <= 300;

const isApprovalContext = (value: unknown): value is ApprovalContext =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["accountId", "chainId", "networkId", "payloadDigest"]) &&
  isStarknetNetworkId(value["networkId"]) &&
  isAccountIdForNetwork(value["accountId"], value["networkId"]) &&
  value["chainId"] === STARKNET_NETWORKS[value["networkId"]].chainId &&
  isSha256Digest(value["payloadDigest"]);

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

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

// A deploy-first review (undeployed Braavos) is exactly one shape: no fee, no
// failure, nothing pending, and a deployment required.
const isDeployFirstReview = (value: Readonly<Record<string, unknown>>): boolean =>
  value["deployFirst"] === undefined ||
  (value["deployFirst"] === true &&
    (value["fee"] ?? null) === null &&
    value["feeEstimateFailed"] !== true &&
    value["feeEstimatePending"] !== true &&
    value["requiresDeployment"] === true);

const isInvokeFeeReview = (value: Readonly<Record<string, unknown>>): boolean =>
  isDeployFirstReview(value) &&
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
  (value["gaslessFees"] === undefined ||
    (Array.isArray(value["gaslessFees"]) &&
      value["gaslessFees"].length > 0 &&
      value["gaslessFees"].length <= 3 &&
      value["gaslessFees"].every(isGaslessFeeOffer) &&
      (value["fee"] ?? null) !== null)) &&
  ((value["fee"] ?? null) !== null ||
    value["feeAffordability"] === undefined ||
    value["feeAffordability"] === "unknown");

const isPendingApproval = (value: unknown): value is PendingApproval => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, [
      "actionReviews",
      "alreadyTracked",
      "blocked",
      "callReviews",
      "context",
      "declaration",
      "deployFirst",
      "existingGrant",
      "fee",
      "feeAffordability",
      "feeEstimateFailed",
      "feeEstimatePending",
      "flags",
      "gaslessFees",
      "id",
      "insights",
      "kind",
      "notice",
      "origin",
      "relayFeeAction",
      "reviewAssets",
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
    (value["existingGrant"] !== undefined && typeof value["existingGrant"] !== "boolean") ||
    (value["kind"] !== "add-chain" &&
      value["kind"] !== "connect" &&
      value["kind"] !== "declare" &&
      value["kind"] !== "invoke" &&
      value["kind"] !== "sign-typed-data" &&
      value["kind"] !== "strk20-balances" &&
      value["kind"] !== "strk20-invoke" &&
      value["kind"] !== "strk20-prepare" &&
      value["kind"] !== "strk20-register" &&
      value["kind"] !== "strk20-shadow-account" &&
      value["kind"] !== "strk20-unavailable" &&
      value["kind"] !== "switch-chain" &&
      value["kind"] !== "watch-asset") ||
    (value["blocked"] !== undefined && typeof value["blocked"] !== "boolean") ||
    (value["insights"] !== undefined &&
      !(Array.isArray(value["insights"]) && value["insights"].every(isInsightText))) ||
    (value["summaries"] !== undefined &&
      !(Array.isArray(value["summaries"]) && value["summaries"].every(isSummaryText))) ||
    (value["reviewAssets"] !== undefined &&
      !(
        Array.isArray(value["reviewAssets"]) && value["reviewAssets"].every(isApprovalReviewAsset)
      )) ||
    (value["flags"] !== undefined &&
      !(Array.isArray(value["flags"]) && value["flags"].every(isApprovalRiskFlag))) ||
    (value["callReviews"] !== undefined &&
      !(
        value["kind"] === "invoke" &&
        Array.isArray(value["callReviews"]) &&
        value["callReviews"].length > 0 &&
        value["callReviews"].every(
          (call) =>
            isRecord(call) &&
            hasOnlyKnownKeys(call, ["calldata", "contractAddress", "entrypoint"]) &&
            readProviderInvokeCall(call) !== null,
        )
      ))
  ) {
    return false;
  }
  const tokenValid =
    value["kind"] === "watch-asset"
      ? isWatchAssetToken(value["token"]) &&
        (value["alreadyTracked"] === undefined || value["alreadyTracked"] === true)
      : value["token"] === undefined && value["alreadyTracked"] === undefined;
  // The fee review travels only on invoke prompts and must be internally
  // consistent, mirroring `resolveReviewFee`: an undeployed account has no
  // estimate and no failure; a failed estimate carries no amount. Inconsistent
  // combinations are rejected at the boundary rather than rendered.
  const feeValid =
    value["kind"] === "invoke"
      ? isInvokeFeeReview(value)
      : value["deployFirst"] === undefined &&
        value["fee"] === undefined &&
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
    value["kind"] === "strk20-shadow-account";
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
  const noticeValid =
    value["notice"] === undefined ||
    (value["kind"] === "strk20-unavailable" &&
      (value["notice"] === "record-limit" || value["notice"] === "request-failed"));
  return (
    actionReviewValid &&
    noticeValid &&
    relayFeeValid &&
    tokenValid &&
    feeValid &&
    declarationValid &&
    (needsContext ? isApprovalContext(value["context"]) : value["context"] === undefined)
  );
};

type ParsedPendingApprovals = {
  readonly approvals: readonly PendingApproval[];
  readonly dropped: boolean;
};

// Each queued approval is budgeted on its own. A shared budget over the whole
// response is a denial-of-service lever: a handful of individually legal
// typed-data prompts sum past it and blank every prompt in the queue, including
// the ones the user still has to reject.
const readApprovalSlot = (pending: readonly unknown[], index: number): PendingApproval | null => {
  const descriptor = Object.getOwnPropertyDescriptor(pending, index);
  if (!isOwnDataProperty(descriptor)) {
    return null;
  }
  const entry: unknown = descriptor.value;
  return isJson(entry) && isPendingApproval(entry) ? entry : null;
};

// Only connection prompts dedupe per origin; watch-asset and invoke prompts
// legitimately queue multiple entries for the same site.
const dedupesByOrigin = (approval: PendingApproval): boolean => approval.kind === "connect";

const parsePendingApprovals = (value: unknown): ParsedPendingApprovals | null => {
  // Budgeting each entry on its own replaced the whole-envelope `isJson` gate,
  // so the queue itself still needs the two bounds that gate used to supply:
  // the shared provider array cap (an unbounded list is handed straight to the
  // renderer) and the "indices and length only" shape check (an own non-index
  // property survives a validator that walks indices).
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["ok", "pending"]) ||
    value["ok"] !== true ||
    !Array.isArray(value["pending"]) ||
    value["pending"].length > JSON_BUDGETS.provider.maxArrayLength ||
    !hasOnlyArrayEntries(value["pending"])
  ) {
    return null;
  }
  const pending: readonly unknown[] = value["pending"];
  const approvals: PendingApproval[] = [];
  const seenIds = new Set<string>();
  const seenConnectOrigins = new Set<string>();
  let dropped = false;
  for (let index = 0; index < pending.length; index += 1) {
    const approval = readApprovalSlot(pending, index);
    const byOrigin = approval !== null && dedupesByOrigin(approval);
    if (
      approval === null ||
      seenIds.has(approval.id) ||
      (byOrigin && seenConnectOrigins.has(approval.origin))
    ) {
      dropped = true;
      continue;
    }
    seenIds.add(approval.id);
    if (byOrigin) {
      seenConnectOrigins.add(approval.origin);
    }
    approvals.push(approval);
  }
  return { approvals, dropped };
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
 * Reads the reviewable approvals out of a pending-approval response.
 *
 * Returns `null` when the envelope itself is not a pending-approval response —
 * wrong shape, a queue past the shared provider array bound, or an array
 * carrying own non-index properties — so a forged, unbounded, or smuggling
 * reply never reaches the consent queue. Otherwise every returned approval was
 * validated on its own, and an entry that fails —
 * unknown `kind`, inconsistent fee review, duplicate id, duplicate connection
 * origin, missing array slot, or a payload past the per-message JSON budget —
 * is dropped while the remaining prompts stay reviewable. One malformed entry
 * must never blank a queue the user still has to approve or reject.
 */
export const readPendingApprovals = (value: unknown): readonly PendingApproval[] | null => {
  const parsed = parsePendingApprovals(value);
  return parsed === null ? null : parsed.approvals;
};

/**
 * Checks pending approval responses before rendering. This is the all-or-nothing
 * form: it holds only when every queued entry validates, so it answers "did the
 * background return an intact queue", not "what is safe to render" — a caller
 * that renders the queue should use `readPendingApprovals`, which keeps the
 * sound entries when one is malformed rather than blanking the queue.
 */
export const isPendingApprovalsResponse = (value: unknown): value is PendingApprovalsResponse => {
  const parsed = parsePendingApprovals(value);
  return parsed !== null && !parsed.dropped;
};

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
