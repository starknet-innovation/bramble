/**
 * The vault's capacity check, shared by every path that writes a whole vault so
 * each one names a full vault the same way before anything is stored.
 */
import { RefusedBeforeWrite } from "@bramble/core/errors";
import { isJson, isJsonWithinBudget, JSON_BUDGETS } from "@bramble/core/json";

/**
 * Refusal when a vault no longer fits the JSON budget its validators apply on
 * read as on write. That budget, not an account count, is the vault's capacity:
 * it is shared by accounts, signing keys, imported phrases, retained secrets
 * and connected sites (Sherlock 261, sized in `docs/WALLET_STORE.md`).
 */
export const VAULT_FULL = "Vault storage limit reached";

/**
 * Refuses a vault that is well within the at-rest budget but past the budget
 * its validators apply on read, by name and before any storage is touched.
 * Anything else passes through to the caller's own shape check.
 */
export const requireVaultCapacity = (vault: unknown): void => {
  if (isJsonWithinBudget(vault, JSON_BUDGETS.storage) && !isJson(vault)) {
    throw new RefusedBeforeWrite(VAULT_FULL);
  }
};
