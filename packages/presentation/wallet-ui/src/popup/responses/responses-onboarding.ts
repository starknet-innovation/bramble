/**
 * Onboarding mnemonic-validity response guard. Split from responses.ts to stay
 * within the size budget. The reply carries only a boolean verdict — never the
 * phrase — so an invalid or malformed background reply cannot leak recovery
 * material into the UI.
 */
import { hasOnlyKnownKeys, isRecord } from "@mc-wallet/core/json";

/**
 * Popup mnemonic-validity response accepted from the background boundary.
 * Carries only the boolean verdict — never the phrase.
 */
export type ValidateMnemonicResponse = {
  readonly ok: true;
  readonly valid: boolean;
};

/**
 * Checks mnemonic-validity responses before gating onboarding Continue.
 */
export const isValidateMnemonicResponse = (value: unknown): value is ValidateMnemonicResponse =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["ok", "valid"]) &&
  value["ok"] === true &&
  typeof value["valid"] === "boolean";
