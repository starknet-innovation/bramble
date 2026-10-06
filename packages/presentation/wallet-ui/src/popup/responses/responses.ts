/**
 * Pure popup response validators for background runtime data.
 */

import { hasOnlyKnownKeys, hasUniqueStrings, isJson, isRecord } from "@bramble/core/json";
import { type ActivityEntry, isActivityEntry } from "@bramble/transactions/activity";
import {
  isHexChainId,
  isStarkFieldElement,
  isStarknetNetworkId,
} from "@bramble/wallet-model/networks";

/**
 * Re-exported approval and connected-site validators for one import path.
 */
export {
  type ApprovalReviewAsset,
  type ConnectedSite,
  type ConnectedSitesResponse,
  isConnectedSitesResponse,
  isPendingApprovalsResponse,
  type PendingApproval,
  type PendingApprovalsResponse,
  readPendingApprovals,
  type WatchAssetToken,
} from "./approvals-responses";
/**
 * Re-exported token-balance validators for one import path.
 */
export {
  type BalancesResponse,
  type DetectTokensResponse,
  isBalancesResponse,
  isDetectTokensResponse,
  type TokenBalance,
} from "./responses-balances";
/**
 * Re-exported Ledger response validators for one import path.
 */
export {
  isLedgerAccountStatusResponse,
  isLedgerAccountsResponse,
  isLedgerSignPendingResponse,
  isOkResponse,
  type LedgerAccountStatusResponse,
  type LedgerAccountsResponse,
  type LedgerSignPendingResponse,
  type LedgerSignRequestSummary,
  type OkResponse,
} from "./responses-ledger";
/**
 * Re-exported NFT auto-discovery validators for one import path.
 */
export {
  type DiscoveredNft,
  type DiscoverNftsResponse,
  isDiscoverNftsResponse,
} from "./responses-nft";
export {
  isTransactionAlertsResponse,
  type TransactionAlertsResponse,
} from "./responses-transaction-alerts";
/**
 * Re-exported transfer-review validators for one import path.
 */
export {
  type FeeReviewResponse,
  isFeeReviewResponse,
  isTransferReviewResponse,
  type TransferReviewResponse,
} from "./responses-transfer";
/**
 * Re-exported on-chain class-hash verification validator for one import path.
 */
export {
  type ClassHashVerificationResponse,
  isClassHashVerificationResponse,
} from "./responses-verify";

import { isWalletPreferences, type WalletPreferences } from "@bramble/settings/preferences";
import { type AllowanceView, isAllowanceView } from "@bramble/transactions/allowance-discovery";
import { type AccountRef, isAccountId, isAccountRef } from "@bramble/wallet-model/accounts";
import { isReadOnlyReason, type ReadOnlyReason } from "@bramble/wallet-model/recovery";
import type { NetworkOption, WalletStatus } from "@bramble/wallet-protocol/extension-responses";
import { type PendingApprovalsResponse, readPendingApprovals } from "./approvals-responses";
import { isRecoveryState, type RecoveryState } from "./responses-recovery";

/**
 * Shared wallet status and network response shapes after runtime validation.
 */
export type { NetworkOption, WalletStatus } from "@bramble/wallet-protocol/extension-responses";

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
 * Re-authenticated secret reveal accepted only by the extension reveal flow.
 */
export type RevealSecretsResponse = {
  readonly mnemonic: string | null;
  readonly ok: true;
  readonly privateKey: string;
};

/**
 * Popup preferences response accepted from the background boundary.
 */
export type PreferencesResponse = {
  readonly ok: true;
  readonly preferences: WalletPreferences;
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

/** A recoverable account's on-chain recovery state, validated in ./responses-recovery. */
export type { RecoveryState } from "./responses-recovery";

/** The Home flag's input: signable, or read-only with its reason. */
export type SignabilityVerdict =
  | { readonly readOnly: false }
  | {
      readonly readOnly: true;
      readonly reason: ReadOnlyReason;
      readonly recovery?: RecoveryState;
    };

/**
 * Active-account signability verdict for the Home read-only flag. `reason` is
 * present exactly when `readOnly` is true; `recovery` accompanies an account
 * the phrase can recover (Braavos 2FA, Ready guardian).
 */
export type AccountSignabilityResponse = {
  readonly accountId: string;
  readonly ok: true;
  readonly readOnly: boolean;
  readonly reason?: ReadOnlyReason;
  readonly recovery?: RecoveryState;
};

/**
 * Popup approval decision response accepted from the background boundary.
 */
export type ApprovalDecisionResponse = AccountsResponse | PendingApprovalsResponse;

const isNetworkOption = (value: unknown): value is NetworkOption =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["id", "name"]) &&
  isStarknetNetworkId(value["id"]) &&
  typeof value["name"] === "string" &&
  value["name"].length > 0;

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
  typeof value["accountCount"] === "number" &&
  Number.isSafeInteger(value["accountCount"]) &&
  value["accountCount"] >= 0 &&
  (isAccountId(value["activeAccountId"]) || value["activeAccountId"] === null) &&
  Array.isArray(value["accounts"]) &&
  value["accounts"].every(isAccountRef) &&
  hasUniqueStrings(value["accounts"].map((account) => account.id)) &&
  value["accounts"].length === value["accountCount"] &&
  typeof value["hasVault"] === "boolean" &&
  typeof value["locked"] === "boolean" &&
  typeof value["network"] === "string" &&
  value["network"].length > 0 &&
  isStarknetNetworkId(value["networkId"]) &&
  Array.isArray(value["networks"]) &&
  value["networks"].every(isNetworkOption) &&
  hasUniqueStrings(value["networks"].map((network) => network.id)) &&
  typeof value["ready"] === "boolean" &&
  (value["hasVault"] || (value["accountCount"] === 0 && value["activeAccountId"] === null)) &&
  (value["activeAccountId"] === null ||
    value["accounts"].some((account) => account.id === value["activeAccountId"]));

/**
 * Checks account-import responses before rendering.
 */
export const isCreateAccountResponse = (value: unknown): value is CreateAccountResponse =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["account", "ok"]) &&
  value["ok"] === true &&
  isAccountRef(value["account"]);

/**
 * Checks granted-account responses before treating approval decisions as done.
 */
export const isAccountsResponse = (value: unknown): value is AccountsResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["accounts", "ok"]) &&
  value["ok"] === true &&
  Array.isArray(value["accounts"]) &&
  value["accounts"].every(isAccountRef) &&
  hasUniqueStrings(value["accounts"].map((account) => account.id));

/**
 * Checks error responses before displaying text.
 */
export const isErrorResponse = (value: unknown): value is ErrorResponse =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["error"]) &&
  typeof value["error"] === "string" &&
  value["error"].length > 0;

/**
 * Checks generated mnemonic responses before filling import forms.
 */
export const isGenerateMnemonicResponse = (value: unknown): value is GenerateMnemonicResponse =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["mnemonic", "ok"]) &&
  value["ok"] === true &&
  typeof value["mnemonic"] === "string" &&
  value["mnemonic"].trim().split(/\s+/).length >= 12;

/**
 * Checks re-authenticated reveal responses before showing secret material.
 */
export const isRevealSecretsResponse = (value: unknown): value is RevealSecretsResponse =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["mnemonic", "ok", "privateKey"]) &&
  value["ok"] === true &&
  (value["mnemonic"] === null ||
    (typeof value["mnemonic"] === "string" &&
      value["mnemonic"].trim().split(/\s+/).length >= 12)) &&
  typeof value["privateKey"] === "string" &&
  isStarkFieldElement(value["privateKey"]);

/**
 * Checks plain preferences responses before rendering.
 */
export const isPreferencesResponse = (value: unknown): value is PreferencesResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["ok", "preferences"]) &&
  value["ok"] === true &&
  isWalletPreferences(value["preferences"]);

/**
 * Re-exported support-diagnostics validator for one import path.
 */
export { isSupportDiagnosticsResponse, type SupportDiagnostics } from "./responses-diagnostics";

/**
 * Fiat prices keyed by contract address accepted from the background boundary.
 */
export type PricesResponse = {
  readonly asOf?: number | null;
  readonly changes?: Readonly<Record<string, number>>;
  readonly currency: "eur" | "gbp" | "usd";
  readonly ok: true;
  readonly prices: Readonly<Record<string, number>>;
  readonly stale?: boolean;
};

/**
 * Token price series accepted from the background boundary.
 */
export type TokenChartResponse = {
  readonly currency: "eur" | "gbp" | "usd";
  readonly ok: true;
  readonly points: readonly number[];
};

const isDisplayCurrencyValue = (value: unknown): value is "eur" | "gbp" | "usd" =>
  value === "eur" || value === "gbp" || value === "usd";

const isFiniteNumberValue = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isPriceMap = (value: unknown): value is Readonly<Record<string, number>> =>
  isRecord(value) && Object.values(value).every(isFiniteNumberValue);

const isNumberArray = (value: unknown): value is readonly number[] =>
  Array.isArray(value) && value.every(isFiniteNumberValue);

/**
 * Checks fiat price responses before applying values to balances.
 */
export const isPricesResponse = (value: unknown): value is PricesResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["asOf", "changes", "currency", "ok", "prices", "stale"]) &&
  value["ok"] === true &&
  isDisplayCurrencyValue(value["currency"]) &&
  isPriceMap(value["prices"]) &&
  (value["changes"] === undefined || isPriceMap(value["changes"])) &&
  (value["asOf"] === undefined || value["asOf"] === null || isFiniteNumberValue(value["asOf"])) &&
  (value["stale"] === undefined || typeof value["stale"] === "boolean");

/**
 * Checks token chart responses before drawing a sparkline.
 */
export const isTokenChartResponse = (value: unknown): value is TokenChartResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["currency", "ok", "points"]) &&
  value["ok"] === true &&
  isDisplayCurrencyValue(value["currency"]) &&
  isNumberArray(value["points"]);

/**
 * Checks transfer submission responses before rendering.
 */
export const isTransferResponse = (value: unknown): value is TransferResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["ok", "transactionHash"]) &&
  value["ok"] === true &&
  typeof value["transactionHash"] === "string" &&
  isStarkFieldElement(value["transactionHash"]);

/**
 * Checks an approve/deny reply — the granted-account list or a pending-approval
 * envelope — before the caller treats the decision as applied. The pending
 * branch accepts the envelope, not every entry in it: the decision already
 * succeeded, so a malformed prompt still queued behind it must not surface as
 * "approval failed" (MCW-V09-106). A salvaged queue is not exactly a
 * `PendingApprovalsResponse`, so this returns a plain boolean instead of
 * narrowing; use `readPendingApprovals` when the entries are needed.
 */
export const isApprovalDecisionResponse = (value: unknown): boolean =>
  isAccountsResponse(value) ||
  readPendingApprovals(value) !== null ||
  (isRecord(value) &&
    isJson(value) &&
    hasOnlyKnownKeys(value, ["chainId", "ok", "pending"]) &&
    value["ok"] === true &&
    isHexChainId(value["chainId"]) &&
    readPendingApprovals({ ok: true, pending: value["pending"] }) !== null);

/**
 * Activity feed response accepted from the background boundary. The feed merges
 * locally recorded transactions with real on-chain history; `historyUnavailable`
 * is set when the chain-history source could not be reached, so the UI can show
 * the local log with a clear degraded indicator instead of a false empty state.
 */
export type ActivityResponse = {
  readonly activity: readonly ActivityEntry[];
  readonly historyUnavailable?: boolean;
  readonly ok: true;
};

/**
 * Checks activity feed responses before rendering.
 */
export const isActivityResponse = (value: unknown): value is ActivityResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["activity", "historyUnavailable", "ok"]) &&
  value["ok"] === true &&
  Array.isArray(value["activity"]) &&
  value["activity"].every(isActivityEntry) &&
  (value["historyUnavailable"] === undefined || typeof value["historyUnavailable"] === "boolean");

/**
 * Tracked allowances response accepted from the background boundary.
 */
export type AllowancesResponse = {
  readonly allowances: readonly AllowanceView[];
  readonly ok: true;
};

/**
 * Checks allowance manager responses before rendering.
 */
export const isAllowancesResponse = (value: unknown): value is AllowancesResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["allowances", "ok"]) &&
  value["ok"] === true &&
  Array.isArray(value["allowances"]) &&
  value["allowances"].every(isAllowanceView);

/**
 * Checks account deployment status responses before rendering.
 */
export const isDeploymentStatusResponse = (value: unknown): value is DeploymentStatusResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["accountId", "deployed", "ok"]) &&
  value["ok"] === true &&
  isAccountId(value["accountId"]) &&
  typeof value["deployed"] === "boolean";

/** Validates the signability verdict (with any recovery state) before the flag renders. */
export const isAccountSignabilityResponse = (value: unknown): value is AccountSignabilityResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["accountId", "ok", "readOnly", "reason", "recovery"]) &&
  value["ok"] === true &&
  isAccountId(value["accountId"]) &&
  typeof value["readOnly"] === "boolean" &&
  (value["readOnly"] === true
    ? isReadOnlyReason(value["reason"])
    : value["reason"] === undefined) &&
  (value["recovery"] === undefined || isRecoveryState(value["recovery"]));
