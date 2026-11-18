/**
 * The background's Ready key verdict for the active account, validated before
 * the Home notice renders. Carries an account id and a boolean, never a key.
 */
import { hasOnlyKnownKeys, isJson, isRecord } from "@bramble/core/json";
import { isAccountId } from "@bramble/wallet-model/accounts";

/**
 * Whether the active Ready account holds a key from Krusty's pre-3.0 Argent
 * legacy derivation. `false` also covers "unknown".
 */
export type ReadyKeyStatusResponse = {
  readonly accountId: string;
  readonly ok: true;
  readonly preFixKey: boolean;
};

/** Validates the Ready key verdict; anything else reads as no verdict. */
export const isReadyKeyStatusResponse = (value: unknown): value is ReadyKeyStatusResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["accountId", "ok", "preFixKey"]) &&
  value["ok"] === true &&
  isAccountId(value["accountId"]) &&
  typeof value["preFixKey"] === "boolean";
