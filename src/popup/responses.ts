/**
 * Pure popup response validators for background runtime data.
 */

import { isUuid } from "../shared/ids";
import { hasOnlyKnownKeys, isJson, isRecord } from "../shared/json";
import { isWalletOrigin } from "../shared/origin";
import { isStarkFieldElement, isStarknetNetworkId } from "../starknet/networks";
import { type ActivityEntry, isActivityEntry } from "../storage/activity-store";
import { isWalletPreferences, type WalletPreferences } from "../storage/preferences-store";
import { type AccountRef, isAccountId, isAccountRef } from "../storage/vault-schema";

/**
 * Popup wallet status response accepted from the background boundary.
 */
export type WalletStatus = {
  readonly accountCount: number;
  readonly activeAccountId: string | null;
  readonly accounts: readonly AccountRef[];
  readonly hasVault: boolean;
  readonly locked: boolean;
  readonly network: string;
  readonly networkId: string;
  readonly networks: readonly NetworkOption[];
  readonly ready: boolean;
};

/**
 * Popup network option accepted from background status.
 */
export type NetworkOption = {
  readonly id: string;
  readonly name: string;
};

/**
 * Popup account-import response accepted from the background boundary.
 */
export type CreateAccountResponse = {
  readonly account: AccountRef;
  readonly ok: true;
};

/**
 * Granted-account response accepted from approval decisions.
 */
export type AccountsResponse = {
  readonly accounts: readonly AccountRef[];
  readonly ok: true;
};

/**
 * Popup error response accepted from the background boundary.
 */
export type ErrorResponse = {
  readonly error: string;
};

/**
 * Popup mnemonic-generation response accepted from the background boundary.
 */
export type GenerateMnemonicResponse = {
  readonly mnemonic: string;
  readonly ok: true;
};

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
 * Pending dapp approval item shown in the popup. `kind` defaults to a
 * connection prompt when absent; watch-asset prompts also carry `token`;
 * `blocked`/`insights` carry phishing and site-reputation signals.
 */
export type PendingApproval = {
  readonly blocked?: boolean;
  readonly id: string;
  readonly insights?: readonly string[];
  readonly kind?: "connect" | "watch-asset";
  readonly origin: string;
  readonly token?: WatchAssetToken;
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

/**
 * Popup preferences response accepted from the background boundary.
 */
export type PreferencesResponse = {
  readonly ok: true;
  readonly preferences: WalletPreferences;
};

/**
 * Popup token balance item accepted from the background boundary.
 */
export type TokenBalance = {
  readonly address: string;
  readonly balance: string;
  readonly decimals: number;
  readonly formatted: string;
  readonly id: string;
  readonly name: string;
  readonly networkId: string;
  readonly symbol: string;
};

/**
 * Popup token balances response accepted from the background boundary.
 */
export type BalancesResponse = {
  readonly accountId: string;
  readonly balances: readonly TokenBalance[];
  readonly networkId: string;
  readonly ok: true;
};

/**
 * Popup transfer response accepted from the background boundary.
 */
export type TransferResponse = {
  readonly ok: true;
  readonly transactionHash: string;
};

/**
 * Popup account deployment status accepted from the background boundary.
 */
export type DeploymentStatusResponse = {
  readonly accountId: string;
  readonly deployed: boolean;
  readonly ok: true;
};

/**
 * Popup approval decision response accepted from the background boundary.
 */
export type ApprovalDecisionResponse = AccountsResponse | PendingApprovalsResponse;

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

const isPendingApproval = (value: unknown): value is PendingApproval => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["blocked", "id", "insights", "kind", "origin", "token"]) ||
    typeof value.id !== "string" ||
    !isUuid(value.id) ||
    typeof value.origin !== "string" ||
    !isWalletOrigin(value.origin) ||
    (value.kind !== undefined && value.kind !== "connect" && value.kind !== "watch-asset") ||
    (value.blocked !== undefined && typeof value.blocked !== "boolean") ||
    (value.insights !== undefined &&
      !(Array.isArray(value.insights) && value.insights.every(isInsightText)))
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

const hasUniqueStrings = (values: readonly string[]): boolean =>
  new Set(values).size === values.length;

const isNetworkOption = (value: unknown): value is NetworkOption =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["id", "name"]) &&
  isStarknetNetworkId(value.id) &&
  typeof value.name === "string" &&
  value.name.length > 0;

const isTokenBalance = (value: unknown): value is TokenBalance =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, [
    "address",
    "balance",
    "decimals",
    "formatted",
    "id",
    "name",
    "networkId",
    "symbol",
  ]) &&
  typeof value.address === "string" &&
  isStarkFieldElement(value.address) &&
  typeof value.balance === "string" &&
  /^(?:0|[1-9][0-9]*)$/.test(value.balance) &&
  typeof value.decimals === "number" &&
  Number.isSafeInteger(value.decimals) &&
  value.decimals >= 0 &&
  value.decimals <= 36 &&
  typeof value.formatted === "string" &&
  value.formatted.length > 0 &&
  typeof value.id === "string" &&
  value.id.length > 0 &&
  typeof value.name === "string" &&
  value.name.length > 0 &&
  isStarknetNetworkId(value.networkId) &&
  typeof value.symbol === "string" &&
  /^[A-Z0-9]{2,12}$/.test(value.symbol);

/**
 * Checks popup status responses before rendering.
 */
export const isWalletStatus = (value: unknown): value is WalletStatus =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, [
    "accountCount",
    "activeAccountId",
    "accounts",
    "hasVault",
    "locked",
    "network",
    "networkId",
    "networks",
    "ready",
  ]) &&
  typeof value.accountCount === "number" &&
  Number.isSafeInteger(value.accountCount) &&
  value.accountCount >= 0 &&
  (isAccountId(value.activeAccountId) || value.activeAccountId === null) &&
  Array.isArray(value.accounts) &&
  value.accounts.every(isAccountRef) &&
  hasUniqueStrings(value.accounts.map((account) => account.id)) &&
  value.accounts.length === value.accountCount &&
  typeof value.hasVault === "boolean" &&
  typeof value.locked === "boolean" &&
  typeof value.network === "string" &&
  value.network.length > 0 &&
  isStarknetNetworkId(value.networkId) &&
  Array.isArray(value.networks) &&
  value.networks.every(isNetworkOption) &&
  hasUniqueStrings(value.networks.map((network) => network.id)) &&
  typeof value.ready === "boolean" &&
  (value.hasVault || (value.accountCount === 0 && value.activeAccountId === null)) &&
  (value.activeAccountId === null ||
    value.accounts.some((account) => account.id === value.activeAccountId));

/**
 * Checks account-import responses before rendering.
 */
export const isCreateAccountResponse = (value: unknown): value is CreateAccountResponse =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["account", "ok"]) &&
  value.ok === true &&
  isAccountRef(value.account);

/**
 * Checks granted-account responses before treating approval decisions as done.
 */
export const isAccountsResponse = (value: unknown): value is AccountsResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["accounts", "ok"]) &&
  value.ok === true &&
  Array.isArray(value.accounts) &&
  value.accounts.every(isAccountRef) &&
  hasUniqueStrings(value.accounts.map((account) => account.id));

/**
 * Checks error responses before displaying text.
 */
export const isErrorResponse = (value: unknown): value is ErrorResponse =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["error"]) &&
  typeof value.error === "string" &&
  value.error.length > 0;

/**
 * Checks generated mnemonic responses before filling import forms.
 */
export const isGenerateMnemonicResponse = (value: unknown): value is GenerateMnemonicResponse =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["mnemonic", "ok"]) &&
  value.ok === true &&
  typeof value.mnemonic === "string" &&
  value.mnemonic.trim().split(/\s+/).length >= 12;

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
      .filter((approval) => approval.kind !== "watch-asset")
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

/**
 * Checks plain preferences responses before rendering.
 */
export const isPreferencesResponse = (value: unknown): value is PreferencesResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["ok", "preferences"]) &&
  value.ok === true &&
  isWalletPreferences(value.preferences);

/**
 * Checks balance responses before rendering.
 */
export const isBalancesResponse = (value: unknown): value is BalancesResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["accountId", "balances", "networkId", "ok"]) &&
  value.ok === true &&
  isAccountId(value.accountId) &&
  Array.isArray(value.balances) &&
  value.balances.every(isTokenBalance) &&
  hasUniqueStrings(value.balances.map((balance) => balance.id)) &&
  isStarknetNetworkId(value.networkId);

/**
 * Checks transfer submission responses before rendering.
 */
export const isTransferResponse = (value: unknown): value is TransferResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["ok", "transactionHash"]) &&
  value.ok === true &&
  typeof value.transactionHash === "string" &&
  isStarkFieldElement(value.transactionHash);

/**
 * Checks approval decision responses before updating popup state.
 */
export const isApprovalDecisionResponse = (value: unknown): value is ApprovalDecisionResponse =>
  isAccountsResponse(value) || isPendingApprovalsResponse(value);

/**
 * Activity feed response accepted from the background boundary.
 */
export type ActivityResponse = {
  readonly activity: readonly ActivityEntry[];
  readonly ok: true;
};

/**
 * Pre-sign transfer review accepted from the background boundary.
 */
export type TransferReviewResponse = {
  readonly ok: true;
  readonly review: {
    readonly fee: { readonly overallFee: string; readonly unit: string } | null;
    readonly flags: readonly { readonly code: string; readonly message: string }[];
    readonly requiresDeployment: boolean;
    readonly summaries: readonly string[];
  };
};

const isRiskFlagShape = (value: unknown): value is { code: string; message: string } =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["code", "message"]) &&
  typeof value.code === "string" &&
  /^[a-z][a-z-]{1,40}$/.test(value.code) &&
  typeof value.message === "string" &&
  value.message.length > 0 &&
  value.message.length <= 300;

const isFeeShape = (value: unknown): value is { overallFee: string; unit: string } =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["overallFee", "unit"]) &&
  typeof value.overallFee === "string" &&
  /^(?:0|[1-9][0-9]*)$/.test(value.overallFee) &&
  typeof value.unit === "string" &&
  /^[A-Z]{2,10}$/.test(value.unit);

/**
 * Checks activity feed responses before rendering.
 */
export const isActivityResponse = (value: unknown): value is ActivityResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["activity", "ok"]) &&
  value.ok === true &&
  Array.isArray(value.activity) &&
  value.activity.every(isActivityEntry);

/**
 * Checks transfer review responses before rendering the review step.
 */
export const isTransferReviewResponse = (value: unknown): value is TransferReviewResponse => {
  if (
    !isRecord(value) ||
    !isJson(value) ||
    !hasOnlyKnownKeys(value, ["ok", "review"]) ||
    value.ok !== true ||
    !isRecord(value.review) ||
    !hasOnlyKnownKeys(value.review, ["fee", "flags", "requiresDeployment", "summaries"])
  ) {
    return false;
  }
  const review = value.review;
  return (
    (review.fee === null || isFeeShape(review.fee)) &&
    Array.isArray(review.flags) &&
    review.flags.every(isRiskFlagShape) &&
    typeof review.requiresDeployment === "boolean" &&
    Array.isArray(review.summaries) &&
    review.summaries.every(
      (summary) => typeof summary === "string" && summary.length > 0 && summary.length <= 300,
    )
  );
};

/**
 * Checks account deployment status responses before rendering.
 */
export const isDeploymentStatusResponse = (value: unknown): value is DeploymentStatusResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["accountId", "deployed", "ok"]) &&
  value.ok === true &&
  isAccountId(value.accountId) &&
  typeof value.deployed === "boolean";
