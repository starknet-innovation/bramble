/**
 * Resource-bounded normalization for untrusted provider request parameters.
 */
import { JSON_BUDGETS, type Json, type JsonBudget, normalizeFeltBigints } from "@bramble/core/json";

const budgetForMethod = (method: string): JsonBudget =>
  method === "wallet_addDeclareTransaction"
    ? JSON_BUDGETS.contractClass
    : method === "wallet_addInvokeTransaction"
      ? JSON_BUDGETS.strk20Proof
      : method === "wallet_signTypedData"
        ? JSON_BUDGETS.typedData
        : JSON_BUDGETS.provider;

/**
 * Normalizes bigint felts under the method-specific budget. Legacy methods
 * accept no params; invalid, cyclic, accessor-backed, or oversized values fail
 * closed as `null`.
 */
export const readProviderParams = (method: string, params: unknown): Json | null | undefined => {
  if (params === undefined) {
    return undefined;
  }
  if (method === "mc_accounts" || method === "mc_requestAccounts") {
    return null;
  }
  return normalizeFeltBigints(params, budgetForMethod(method)) ?? null;
};
