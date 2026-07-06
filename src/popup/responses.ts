/**
 * Pure popup response validators for background runtime data.
 */

import { isUuid } from "../shared/ids";
import { hasOnlyKnownKeys, isJson, isRecord } from "../shared/json";
import { isWalletOrigin } from "../shared/origin";
import { type AccountRef, isAccountId, isAccountRef } from "../storage/vault-schema";

/**
 * Popup wallet status response accepted from the background boundary.
 */
export type WalletStatus = {
  readonly accountCount: number;
  readonly activeAccountId: string | null;
  readonly hasVault: boolean;
  readonly locked: boolean;
  readonly network: string;
  readonly ready: boolean;
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
 * Pending dapp approval item shown in the popup.
 */
export type PendingApproval = {
  readonly id: string;
  readonly origin: string;
};

/**
 * Pending approval response accepted from the background boundary.
 */
export type PendingApprovalsResponse = {
  readonly ok: true;
  readonly pending: readonly PendingApproval[];
};

/**
 * Popup approval decision response accepted from the background boundary.
 */
export type ApprovalDecisionResponse = AccountsResponse | PendingApprovalsResponse;

const isPendingApproval = (value: unknown): value is PendingApproval =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["id", "origin"]) &&
  typeof value.id === "string" &&
  isUuid(value.id) &&
  typeof value.origin === "string" &&
  isWalletOrigin(value.origin);

/**
 * Checks popup status responses before rendering.
 */
export const isWalletStatus = (value: unknown): value is WalletStatus =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, [
    "accountCount",
    "activeAccountId",
    "hasVault",
    "locked",
    "network",
    "ready",
  ]) &&
  typeof value.accountCount === "number" &&
  Number.isSafeInteger(value.accountCount) &&
  value.accountCount >= 0 &&
  (isAccountId(value.activeAccountId) || value.activeAccountId === null) &&
  typeof value.hasVault === "boolean" &&
  typeof value.locked === "boolean" &&
  typeof value.network === "string" &&
  value.network.length > 0 &&
  typeof value.ready === "boolean" &&
  (value.hasVault || (value.accountCount === 0 && value.activeAccountId === null)) &&
  (value.activeAccountId === null || value.accountCount > 0);

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
  value.accounts.every(isAccountRef);

/**
 * Checks error responses before displaying text.
 */
export const isErrorResponse = (value: unknown): value is ErrorResponse =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["error"]) &&
  typeof value.error === "string" &&
  value.error.length > 0;

/**
 * Checks pending approval responses before rendering.
 */
export const isPendingApprovalsResponse = (value: unknown): value is PendingApprovalsResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["ok", "pending"]) &&
  value.ok === true &&
  Array.isArray(value.pending) &&
  value.pending.every(isPendingApproval);

/**
 * Checks approval decision responses before updating popup state.
 */
export const isApprovalDecisionResponse = (value: unknown): value is ApprovalDecisionResponse =>
  isAccountsResponse(value) || isPendingApprovalsResponse(value);
