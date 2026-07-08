/**
 * Pure popup validators for dapp approval and connected-site data returned by
 * the background boundary.
 */

import { isUuid } from "../shared/ids";
import { hasOnlyKnownKeys, isJson, isRecord, type Json } from "../shared/json";
import { isWalletOrigin } from "../shared/origin";
import { isStarkFieldElement, isStarknetNetworkId } from "../starknet/networks";

const hasUniqueStrings = (values: readonly string[]): boolean =>
  new Set(values).size === values.length;

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
 * Pending dapp approval item shown in the popup. `kind` defaults to a
 * connection prompt when absent; watch-asset prompts also carry `token`; invoke
 * prompts carry decoded call `summaries` and risk `flags`; `blocked`/`insights`
 * carry phishing and site-reputation signals.
 */
export type PendingApproval = {
  readonly blocked?: boolean;
  readonly flags?: readonly ApprovalRiskFlag[];
  readonly id: string;
  readonly insights?: readonly string[];
  readonly kind?: "connect" | "invoke" | "sign-typed-data" | "switch-chain" | "watch-asset";
  readonly origin: string;
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
  typeof value.address === "string" &&
  isStarkFieldElement(value.address) &&
  typeof value.decimals === "number" &&
  Number.isSafeInteger(value.decimals) &&
  value.decimals >= 0 &&
  value.decimals <= 36 &&
  typeof value.name === "string" &&
  value.name.length > 0 &&
  value.name.length <= 64 &&
  isStarknetNetworkId(value.networkId) &&
  typeof value.symbol === "string" &&
  /^[A-Z0-9]{2,12}$/.test(value.symbol);

const isInsightText = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 200;

const isSummaryText = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 300;

const isApprovalRiskFlag = (value: unknown): value is ApprovalRiskFlag =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["code", "message"]) &&
  typeof value.code === "string" &&
  /^[a-z][a-z-]{1,40}$/.test(value.code) &&
  typeof value.message === "string" &&
  value.message.length > 0 &&
  value.message.length <= 300;

const isPendingApproval = (value: unknown): value is PendingApproval => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, [
      "blocked",
      "flags",
      "id",
      "insights",
      "kind",
      "origin",
      "summaries",
      "token",
      "typedData",
    ]) ||
    typeof value.id !== "string" ||
    !isUuid(value.id) ||
    typeof value.origin !== "string" ||
    !isWalletOrigin(value.origin) ||
    (value.typedData !== undefined && !isJson(value.typedData)) ||
    (value.kind !== undefined &&
      value.kind !== "connect" &&
      value.kind !== "invoke" &&
      value.kind !== "sign-typed-data" &&
      value.kind !== "switch-chain" &&
      value.kind !== "watch-asset") ||
    (value.blocked !== undefined && typeof value.blocked !== "boolean") ||
    (value.insights !== undefined &&
      !(Array.isArray(value.insights) && value.insights.every(isInsightText))) ||
    (value.summaries !== undefined &&
      !(Array.isArray(value.summaries) && value.summaries.every(isSummaryText))) ||
    (value.flags !== undefined &&
      !(Array.isArray(value.flags) && value.flags.every(isApprovalRiskFlag)))
  ) {
    return false;
  }
  return value.kind === "watch-asset" ? isWatchAssetToken(value.token) : value.token === undefined;
};

const isConnectedSite = (value: unknown): value is ConnectedSite =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["accountCount", "origin"]) &&
  typeof value.accountCount === "number" &&
  Number.isSafeInteger(value.accountCount) &&
  value.accountCount >= 0 &&
  typeof value.origin === "string" &&
  isWalletOrigin(value.origin);

/**
 * Checks pending approval responses before rendering.
 */
export const isPendingApprovalsResponse = (value: unknown): value is PendingApprovalsResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["ok", "pending"]) &&
  value.ok === true &&
  Array.isArray(value.pending) &&
  value.pending.every(isPendingApproval) &&
  hasUniqueStrings(value.pending.map((approval) => approval.id)) &&
  hasUniqueStrings(
    value.pending
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
  value.ok === true &&
  Array.isArray(value.sites) &&
  value.sites.every(isConnectedSite) &&
  hasUniqueStrings(value.sites.map((site) => site.origin));
